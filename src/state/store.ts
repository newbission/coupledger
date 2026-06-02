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
import { pushEntry, pullAll } from '../integrations/gsync';
import { pickFolder, isConnected, requestToken, disconnect } from '../integrations/google';

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
  // 첫 멤버 1명만 — 나머지는 온보딩/설정에서 직접 추가(이름 가정 안 함).
  return [{ id: uid(), name: '나', colorVar: 'm1', isPayer: true, weight: 1 }];
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

interface PriorClass {
  assign: Assignment;
  category: string | null;
  categoryAuto: boolean;
  splits: Split[] | null;
  excluded: boolean;
}

/** 이전에 '분류된' 거래를 승인번호 → 분류로 모음(저장 기록 스냅샷 + 현재 세션). 최근 것이 우선. */
function priorClassifications(): Map<string, PriorClass> {
  const map = new Map<string, PriorClass>();
  const meaningful = (it: LineItem): boolean =>
    it.category != null ||
    it.assign !== 'shared' ||
    (it.splits != null && it.splits.length > 0) ||
    (it.excluded && it.cancel !== 'full');
  const add = (items: LineItem[]) => {
    for (const it of items) {
      if (!it.approvalNo || !meaningful(it)) continue;
      map.set(it.approvalNo, {
        assign: it.assign,
        category: it.category,
        categoryAuto: it.categoryAuto,
        splits: it.splits,
        excluded: it.excluded,
      });
    }
  };
  for (const h of history) if (h.snapshot) add(h.snapshot.items); // 오래된 것 먼저
  if (state.session.import) add(state.session.import.items); // 최근(세션)이 덮어씀
  return map;
}

export function setImport(r: ImportResult | null): void {
  if (r) {
    const prior = priorClassifications();
    for (const item of r.items) {
      const p = item.approvalNo ? prior.get(item.approvalNo) : undefined;
      if (p) {
        // 재업로드 시 기존 분류 보존(공용/개인·카테고리·분할·수동제외).
        item.assign = p.assign;
        item.category = p.category;
        item.categoryAuto = p.categoryAuto;
        item.splits = p.splits;
        if (p.excluded) item.excluded = true;
      } else {
        // 새 거래 → 자동 제안.
        const s = suggestFor(item.merchant);
        if (s.category != null && item.category == null) {
          item.category = s.category;
          item.categoryAuto = true;
        }
        if (s.assign != null) item.assign = s.assign;
      }
    }
  }
  state.session.import = r;
  state.session.loadedHistoryId = null; // 새 업로드 → 기록과 연결 해제
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

/** 거래를 직접 추가. 업로드 내역이 없으면 빈 내역을 만들어 시작(엑셀 없이도 가계부 가능). */
export function addManualItem(data: {
  date: string;
  merchant: string;
  amount: number;
  category: string | null;
  assign: Assignment;
}): void {
  let imp = state.session.import;
  if (!imp) {
    imp = {
      source: state.config.defaultSource,
      periodLabel: periodOf(data.date),
      periodStart: data.date,
      periodEnd: data.date,
      rawCount: 0,
      fileName: '직접 입력',
      items: [],
    };
    state.session.import = imp;
  }
  const item: LineItem = {
    id: uid(),
    date: data.date,
    merchant: data.merchant,
    gross: data.amount,
    canceledAmount: 0,
    net: data.amount,
    installment: false,
    installmentMonths: 0,
    cancel: 'none',
    excluded: false,
    category: data.category,
    categoryAuto: false,
    assign: data.assign,
    splits: null,
    manual: true,
  };
  imp.items.unshift(item);
  if (data.date < imp.periodStart) imp.periodStart = data.date;
  if (data.date > imp.periodEnd) imp.periodEnd = data.date;
  imp.periodLabel = periodOf(imp.periodStart);
  if (data.category) learn(data.merchant, data.category, data.assign);
  notify();
}

/** 항목 삭제(주로 직접 추가 항목). */
export function removeItem(id: string): void {
  const imp = state.session.import;
  if (!imp) return;
  imp.items = imp.items.filter((it) => it.id !== id);
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

export function saveCurrentToHistory(mode: 'add' | 'replace' = 'add'): string | null {
  const imp = state.session.import;
  if (!imp) return null;
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
    snapshot: structuredClone(imp),
    syncedAt: null,
    sheetUrl: null,
    syncError: null,
  };

  if (mode === 'replace') {
    history = history.filter((h) => h.periodLabel !== imp.periodLabel);
  }
  history = [entry, ...history];
  state.session.loadedHistoryId = entry.id;
  persistHistory();
  notify();
  return entry.id;
}

/** 시트 URL(열기 링크). */
export function sheetUrlOf(spreadsheetId: string): string {
  return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId;
}

const syncingIds = new Set<string>();
/** 해당 기록이 시트 동기화 진행 중인지(UI 인플라이트 표시용). */
export function isSyncing(id: string): boolean {
  return syncingIds.has(id);
}

/** 토큰이 만료됐는지(자동 동기화가 팝업에서 멈추는 것 방지용). */
function setSyncError(id: string, msg: string): void {
  const i = history.findIndex((h) => h.id === id);
  if (i >= 0) {
    history[i] = { ...history[i], syncError: msg };
    persistHistory();
    notify();
  }
}

/** 한 기록을 구글 시트에 동기화하고 성공/실패 상태를 기록. 실패 시 throw. */
export async function syncEntry(id: string): Promise<void> {
  const e = history.find((h) => h.id === id);
  const gdrive = state.config.gdrive;
  if (!e || !e.snapshot || !gdrive) return;
  // 토큰 만료 시 자동 팝업(차단되면 무한 '동기화 중')으로 멈추지 않게 빠르게 실패.
  if (!isConnected()) {
    setSyncError(id, '구글 연결이 만료됐어요 · 다시 연결해 주세요');
    throw new Error('reauth-required');
  }
  syncingIds.add(id);
  notify();
  try {
    const sid = await pushEntry(gdrive.folderId, e, state.config.members);
    syncingIds.delete(id);
    const i = history.findIndex((h) => h.id === id);
    if (i >= 0) {
      history[i] = { ...history[i], syncedAt: Date.now(), sheetUrl: sheetUrlOf(sid), syncError: null };
      persistHistory();
    }
    notify();
  } catch (err) {
    syncingIds.delete(id);
    const i = history.findIndex((h) => h.id === id);
    if (i >= 0) {
      history[i] = { ...history[i], syncError: err instanceof Error ? err.message : String(err) };
      persistHistory();
    }
    notify();
    throw err;
  }
}

/** 구글 로그아웃: 토큰 폐기 + 폴더 연결 해제(로컬 기록은 유지). */
export function signOut(): void {
  disconnect();
  setConfig({ gdrive: null });
}

/** 연결 상태(폴더 링크 기준). */
export function isGoogleLinked(): boolean {
  return !!state.config.gdrive;
}

/** 만료된 토큰 재발급(사용자 제스처에서 호출) 후 동기화 재시도. */
export async function retrySync(id: string): Promise<void> {
  if (!isConnected()) {
    await requestToken(true); // 클릭 제스처 안에서 호출 → 팝업 허용됨
  }
  await syncEntry(id);
}

/** 폴더 선택 → 시트 기록 자동 불러오기 → 연결 저장. 취소 시 null. */
export async function connectGoogle(): Promise<{
  folderName: string;
  added: number;
  updated: number;
} | null> {
  const folder = await pickFolder();
  if (!folder) return null;
  let added = 0;
  let updated = 0;
  try {
    const pulled = await pullAll(folder.id);
    if (pulled.length) {
      const r = mergeHistoryEntries(pulled);
      added = r.added;
      updated = r.updated;
    }
  } catch {
    /* 자동 불러오기 실패는 연결을 막지 않음 */
  }
  setConfig({ gdrive: { folderId: folder.id, folderName: folder.name } });
  return { folderName: folder.name, added, updated };
}

export function findHistoryByPeriod(label: string): HistoryEntry | null {
  return history.find((h) => h.periodLabel === label) ?? null;
}

/** 외부(시트)에서 가져온 기록을 로컬에 병합. 같은 달은 savedAt 최신본 우선(last-write-wins). */
/** 시트에서 온 기록의 멤버를 이름으로 현재 설정에 맞춤(없으면 추가). */
function reconcileMembersFromEntries(entries: HistoryEntry[]): void {
  const names = new Set<string>();
  for (const e of entries) {
    for (const id of Object.keys(e.memberNames || {})) {
      const nm = e.memberNames[id];
      if (nm) names.add(nm);
    }
  }
  let changed = false;
  for (const name of names) {
    if (!state.config.members.some((m) => m.name === name)) {
      state.config.members.push({
        id: uid(),
        name,
        colorVar: nextColorVar(state.config.members),
        isPayer: false,
        weight: 1,
      });
      changed = true;
    }
  }
  if (changed) {
    if (!state.config.members.some((m) => m.isPayer)) state.config.members[0].isPayer = true;
    persistConfig();
  }
}

/** 기록의 멤버 ID(저장 당시)를 현재 멤버 ID로 이름 기준 재매핑 + 정산 재계산. */
function remapEntryMembers(e: HistoryEntry, idByName: Map<string, string>): void {
  if (!e.snapshot) return;
  const remap = (savedId: string): string => {
    const nm = e.memberNames[savedId];
    return (nm && idByName.get(nm)) || savedId;
  };
  for (const it of e.snapshot.items) {
    if (it.assign !== 'shared') it.assign = { member: remap(it.assign.member) };
  }
  const nn: Record<string, string> = {};
  for (const sid of Object.keys(e.memberNames)) nn[remap(sid)] = e.memberNames[sid];
  e.memberNames = nn;
  e.settlement = computeSettlement(e.snapshot.items, state.config.members);
  e.cardTotalNet = e.settlement.cardTotalNet;
  e.itemCount = e.snapshot.items.filter((it) => !it.excluded).length;
}

export function mergeHistoryEntries(
  incoming: HistoryEntry[],
): { added: number; updated: number; skipped: number } {
  // 멤버 정합성: 시트의 멤버를 현재 설정에 맞춰 ID 재매핑(다른 기기/재설치에서 분류 유지).
  reconcileMembersFromEntries(incoming);
  const idByName = new Map(state.config.members.map((m) => [m.name, m.id]));
  for (const e of incoming) remapEntryMembers(e, idByName);

  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const e of incoming) {
    const idx = history.findIndex((h) => h.periodLabel === e.periodLabel);
    if (idx < 0) {
      history.unshift(e);
      added++;
    } else if ((e.savedAt || 0) > (history[idx].savedAt || 0)) {
      history[idx] = { ...e, id: history[idx].id }; // 로컬 id 유지
      updated++;
    } else {
      skipped++;
    }
  }
  history.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  persistHistory();
  notify();
  return { added, updated, skipped };
}

export function deleteHistory(id: string): void {
  history = history.filter((h) => h.id !== id);
  persistHistory();
  notify();
}

/** 저장된 기록을 현재 세션으로 불러오기(복원). 스냅샷을 그대로 사용(자동제안 재적용 안 함). */
export function loadHistoryEntry(id: string): void {
  const e = history.find((h) => h.id === id);
  if (!e || !e.snapshot) return;
  state.session.import = structuredClone(e.snapshot);
  state.session.loadedHistoryId = id;
  state.route = 'app';
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
