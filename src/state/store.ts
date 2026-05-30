// ===== coupledger 중앙 스토어 =====
// 모든 상태 읽기는 getState(), 모든 변경은 이 모듈의 액션 함수로만.
// 변경 후 persist + notify → 루트 재렌더.
import type {
  AppConfig,
  AppState,
  Assignment,
  Backup,
  HistoryEntry,
  ImportResult,
  LineItem,
  Member,
  MerchantRule,
  Route,
  SettlementResult,
  Split,
  ThemeId,
} from '../types';
import { assignKey, periodOf, uid } from '../util';
import { computeSettlement } from '../settlement/engine';

// ---------- 상수 ----------

export const DEFAULT_CATEGORIES: string[] = [
  '식료품·마트',
  '외식·배달',
  '생활용품',
  '공과금·관리비',
  '구독·서비스',
  '패션·의류',
  '카페·간식',
  '교통',
  '의료·건강',
  '문화·여가',
  '기타',
];

const SCHEMA = 1;
const CONFIG_KEY = 'coupledger.config.v1';
const HISTORY_KEY = 'coupledger.history.v1';

// ---------- 기본값 ----------

function defaultMembers(): Member[] {
  return [
    { id: uid(), name: '나', colorVar: 'm1', isPayer: true, weight: 1 },
    { id: uid(), name: '여자친구', colorVar: 'm2', isPayer: false, weight: 1 },
  ];
}

export function defaultConfig(): AppConfig {
  return {
    schema: SCHEMA,
    onboarded: false,
    theme: 'warm',
    members: defaultMembers(),
    defaultSource: 'samsung',
    categories: [...DEFAULT_CATEGORIES],
    rules: {},
    appLabel: 'coupledger',
  };
}

// ---------- 영속화 ----------

function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultConfig();
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const base = defaultConfig();
    // 누락 필드는 기본값으로 보강(스키마 진화 대비).
    return {
      ...base,
      ...parsed,
      members:
        Array.isArray(parsed.members) && parsed.members.length
          ? parsed.members
          : base.members,
      categories:
        Array.isArray(parsed.categories) && parsed.categories.length
          ? parsed.categories
          : base.categories,
      rules: parsed.rules && typeof parsed.rules === 'object' ? parsed.rules : {},
    };
  } catch {
    return defaultConfig();
  }
}

function persistConfig(): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  } catch {
    /* 저장 실패는 무시(용량 초과 등) */
  }
}

function persistHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* 무시 */
  }
}

// ---------- 상태 ----------

const state: AppState = {
  config: loadConfig(),
  session: { import: null },
  route: 'app',
};

// 온보딩 미완료면 온보딩 라우트로 진입.
state.route = state.config.onboarded ? 'app' : 'onboarding';

let history: HistoryEntry[] = loadHistory();

export function getState(): AppState {
  return state;
}

// ---------- 구독/통지 ----------

const subscribers = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function notify(): void {
  for (const fn of subscribers) fn();
}

// ---------- 테마 ----------

export function applyThemeFromConfig(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', state.config.theme);
  }
}

export function setTheme(theme: ThemeId): void {
  setConfig({ theme });
}

// ---------- 설정 ----------

export function setConfig(patch: Partial<AppConfig>): void {
  const themeChanged = patch.theme != null && patch.theme !== state.config.theme;
  state.config = { ...state.config, ...patch };
  persistConfig();
  if (themeChanged) applyThemeFromConfig();
  notify();
}

export function setRoute(r: Route): void {
  state.route = r;
  notify();
}

// ---------- 가맹점 정규화 / 빈도학습 ----------

/** 가맹점명 정규화: 공백정리 + 끝쪽 지점/숫자 토큰 제거 → 빈도 집계 키 */
function normalizeMerchant(merchant: string): string {
  let s = (merchant || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  // 끝에 붙은 점포번호/지점 토큰을 반복 제거.
  //  예: '스타벅스 강남2호점' → '스타벅스', 'GS25 역삼점 123' → 'GS25'
  let prev: string;
  do {
    prev = s;
    s = s
      // 끝의 순수 숫자 토큰 ('... 123')
      .replace(/\s+\d+$/u, '')
      // 끝의 '○○점' / '○○지점' (한글/영문/숫자 라벨 포함)
      .replace(/\s*\S*(지점|점)$/u, '')
      // 끝의 'N호' / 'N호점' 잔여
      .replace(/\s*\d+호$/u, '')
      .trim();
  } while (s !== prev && s.length > 0);
  // 모두 깎여나갔으면 원본 트림본으로 복구.
  if (!s) s = (merchant || '').trim().replace(/\s+/g, ' ');
  return s;
}

export function suggestFor(merchant: string): {
  category: string | null;
  assign: Assignment | null;
} {
  const key = normalizeMerchant(merchant);
  const rule = key ? state.config.rules[key] : undefined;
  if (!rule) return { category: null, assign: null };

  const category = topKey(rule.cat);
  const assignK = topKey(rule.assign);
  let assign: Assignment | null = null;
  if (assignK != null) {
    assign = assignK === 'shared' ? 'shared' : { member: assignK };
  }
  return { category, assign };
}

/** Record<string, number>에서 최다 빈도 키. 동률은 먼저 등록된 키 우선. */
function topKey(rec: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = -1;
  for (const [k, n] of Object.entries(rec)) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

export function learn(
  merchant: string,
  category: string | null,
  assign: Assignment,
): void {
  const key = normalizeMerchant(merchant);
  if (!key) return;
  const rules = state.config.rules;
  const rule: MerchantRule = rules[key] ?? { cat: {}, assign: {} };
  if (category) rule.cat[category] = (rule.cat[category] ?? 0) + 1;
  const ak = assignKey(assign);
  rule.assign[ak] = (rule.assign[ak] ?? 0) + 1;
  rules[key] = rule;
  persistConfig();
}

// ---------- import 세션 ----------

export function setImport(r: ImportResult | null): void {
  if (r) {
    // 각 item에 자동 제안 적용(아직 사용자 확정 전).
    for (const item of r.items) {
      const s = suggestFor(item.merchant);
      if (s.category != null && item.category == null) {
        item.category = s.category;
        item.categoryAuto = true;
      }
      if (s.assign != null) {
        item.assign = s.assign;
      }
    }
  }
  state.session.import = r;
  notify();
}

function currentItems(): LineItem[] {
  return state.session.import ? state.session.import.items : [];
}

function findItem(id: string): LineItem | undefined {
  return currentItems().find((it) => it.id === id);
}

export function setItemAssign(id: string, a: Assignment): void {
  const it = findItem(id);
  if (!it) return;
  it.assign = a;
  learn(it.merchant, it.category, a);
  notify();
}

export function setItemCategory(
  id: string,
  category: string | null,
  opts?: { auto?: boolean },
): void {
  const it = findItem(id);
  if (!it) return;
  it.category = category;
  it.categoryAuto = opts?.auto === true;
  // 사용자가 확정한 카테고리는 학습.
  if (category && !it.categoryAuto) learn(it.merchant, category, it.assign);
  notify();
}

export function setItemSplits(id: string, splits: Split[] | null): void {
  const it = findItem(id);
  if (!it) return;
  it.splits = splits;
  notify();
}

export function toggleExcluded(id: string): void {
  const it = findItem(id);
  if (!it) return;
  it.excluded = !it.excluded;
  notify();
}

// ---------- 정산 ----------

export function getSettlement(): SettlementResult {
  return computeSettlement(currentItems(), state.config.members);
}

// ---------- 멤버 ----------

export function payer(): Member {
  const { members } = state.config;
  return members.find((m) => m.isPayer) ?? members[0];
}

export function membersById(): Record<string, Member> {
  const map: Record<string, Member> = {};
  for (const m of state.config.members) map[m.id] = m;
  return map;
}

/** 다음 빈 멤버 색 슬롯(m1..m6, 부족하면 순환). */
function nextColorVar(members: Member[]): string {
  const used = new Set(members.map((m) => m.colorVar));
  for (let i = 1; i <= 6; i++) {
    const slot = 'm' + i;
    if (!used.has(slot)) return slot;
  }
  return 'm' + ((members.length % 6) + 1);
}

export function addMember(name: string): void {
  const members = state.config.members;
  const m: Member = {
    id: uid(),
    name: name.trim() || `멤버 ${members.length + 1}`,
    colorVar: nextColorVar(members),
    isPayer: members.length === 0,
    weight: 1,
  };
  setConfig({ members: [...members, m] });
}

export function removeMember(id: string): void {
  const members = state.config.members.filter((m) => m.id !== id);
  // 결제자가 사라졌으면 첫 멤버를 결제자로.
  if (members.length && !members.some((m) => m.isPayer)) {
    members[0] = { ...members[0], isPayer: true };
  }
  setConfig({ members });
}

export function updateMember(id: string, patch: Partial<Member>): void {
  const members = state.config.members.map((m) =>
    m.id === id ? { ...m, ...patch } : m,
  );
  setConfig({ members });
}

export function setPayer(id: string): void {
  const members = state.config.members.map((m) => ({
    ...m,
    isPayer: m.id === id,
  }));
  setConfig({ members });
}

// ---------- 히스토리 ----------

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveCurrentToHistory(mode: 'add' | 'replace' = 'add'): void {
  const imp = state.session.import;
  if (!imp) return;
  const settlement = getSettlement();
  const memberNames: Record<string, string> = {};
  for (const m of state.config.members) memberNames[m.id] = m.name;
  const itemCount = imp.items.filter((it) => !it.excluded).length;

  const entry: HistoryEntry = {
    id: uid(),
    periodLabel: imp.periodLabel,
    source: imp.source,
    savedAt: Date.now(),
    cardTotalNet: settlement.cardTotalNet,
    settlement,
    memberNames,
    itemCount,
  };

  if (mode === 'replace') {
    history = history.filter((h) => h.periodLabel !== imp.periodLabel);
  }
  history = [entry, ...history];
  persistHistory();
  notify();
}

export function findHistoryByPeriod(label: string): HistoryEntry | null {
  return history.find((h) => h.periodLabel === label) ?? null;
}

export function deleteHistory(id: string): void {
  history = history.filter((h) => h.id !== id);
  persistHistory();
  notify();
}

// ---------- 백업 ----------

export function exportBackupJSON(): string {
  const backup: Backup = {
    app: 'coupledger',
    schema: SCHEMA,
    exportedAt: Date.now(),
    config: state.config,
    history,
  };
  return JSON.stringify(backup, null, 2);
}

export function importBackupJSON(json: string): void {
  const parsed = JSON.parse(json) as Partial<Backup>;
  if (!parsed || parsed.app !== 'coupledger' || !parsed.config) {
    throw new Error('유효하지 않은 백업 파일입니다.');
  }
  const base = defaultConfig();
  state.config = {
    ...base,
    ...parsed.config,
    members:
      Array.isArray(parsed.config.members) && parsed.config.members.length
        ? parsed.config.members
        : base.members,
    categories:
      Array.isArray(parsed.config.categories) && parsed.config.categories.length
        ? parsed.config.categories
        : base.categories,
    rules:
      parsed.config.rules && typeof parsed.config.rules === 'object'
        ? parsed.config.rules
        : {},
  };
  history = Array.isArray(parsed.history) ? parsed.history : [];
  persistConfig();
  persistHistory();
  applyThemeFromConfig();
  notify();
}

export function resetAll(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* 무시 */
  }
  state.config = defaultConfig();
  state.session.import = null;
  state.route = 'onboarding';
  history = [];
  applyThemeFromConfig();
  notify();
}

// 평기간 라벨 유틸 재노출(필요 모듈 대비, periodOf 직접 사용 가능).
export { periodOf };

// ---------- 모듈 로드 시 1회: 테마 적용 ----------
applyThemeFromConfig();
