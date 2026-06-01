// ===== 구글시트 동기화 =====
// 구조: 연도 파일(예 '2026') 안에
//   · 숨김 db 탭 '_2026-05'  → 그 달 원천 데이터(불러오기의 source of truth)
//   · 보이는 뷰 탭 '2026-05' → 사람이 보기 좋은 정산표
// 저장 = db/뷰 탭을 clear 후 현재 상태로 다시 씀(잔여 행 없음). 다른 달은 안 건드림.
import type {
  HistoryEntry,
  LineItem,
  Member,
  Assignment,
  ImportResult,
  Split,
  CancelKind,
  SourceId,
} from '../types';
import {
  findOrCreateSheetInFolder,
  ensureTab,
  clearTab,
  writeRange,
  getSheets,
  readRange,
  listFolderSheets,
} from './google';
import { won, isShared, memberOf, uid } from '../util';
import { computeSettlement } from '../settlement/engine';
import { writeCover } from './gsheet-design';
import type { YearOverview, MonthSummary } from './gsheet-design';

function yearOf(period: string): string {
  return period.split('.')[0] || period.slice(0, 4);
}
function dbTab(period: string): string {
  return '_' + period.replace(/\./g, '-'); // 숨김: _2026-05
}
function viewTab(period: string): string {
  return period.replace(/\./g, '-'); // 뷰: 2026-05
}

// db 컬럼 순서(직렬화 키) — 역직렬화(pull) 때 동일 순서로 읽는다.
const DB_HEADER = [
  'date',
  'merchant',
  'approvalNo',
  'gross',
  'canceledAmount',
  'net',
  'installment',
  'installmentMonths',
  'cancel',
  'excluded',
  'category',
  'assign',
  'splits',
  'manual',
] as const;

function assignStr(a: Assignment): string {
  return a === 'shared' ? 'shared' : 'm:' + a.member;
}

function itemRow(it: LineItem): (string | number)[] {
  return [
    it.date,
    it.merchant,
    it.approvalNo ?? '',
    it.gross,
    it.canceledAmount,
    it.net,
    it.installment ? 1 : 0,
    it.installmentMonths,
    it.cancel,
    it.excluded ? 1 : 0,
    it.category ?? '',
    assignStr(it.assign),
    it.splits ? JSON.stringify(it.splits) : '',
    it.manual ? 1 : 0,
  ];
}

/** 한 기록(달)을 시트에 저장: 연도 파일 → 숨김 db 탭 + 뷰 탭(둘 다 clear 후 재작성). spreadsheetId 반환. */
export async function pushEntry(
  folderId: string,
  e: HistoryEntry,
  members: Member[],
): Promise<string> {
  const sid = await findOrCreateSheetInFolder(folderId, yearOf(e.periodLabel));
  const items = e.snapshot?.items ?? [];

  // ---- 숨김 db 탭: 그 달 원천 데이터 ----
  const db = dbTab(e.periodLabel);
  await ensureTab(sid, db, { hidden: true });
  await clearTab(sid, db);
  const meta: (string | number)[][] = [
    ['#period', e.periodLabel],
    ['#savedAt', String(e.savedAt)],
    [
      '#members',
      JSON.stringify(
        members.map((m) => ({ id: m.id, name: m.name, isPayer: m.isPayer, weight: m.weight })),
      ),
    ],
  ];
  await writeRange(sid, `'${db}'!A1`, [...meta, [...DB_HEADER], ...items.map(itemRow)]);

  // ---- 뷰 탭: 보기 좋은 정산표 ----
  await writeView(sid, e, members);

  // ---- 표지/연간 개요 탭 갱신(장식 실패는 저장을 막지 않음) ----
  try {
    const ov = await collectYearOverview(sid, yearOf(e.periodLabel), members.map((m) => m.name));
    await writeCover(sid, ov);
  } catch (err) {
    console.error('표지 갱신 실패(저장은 완료됨):', err);
  }
  return sid;
}

function owedTextOf(e: HistoryEntry): string {
  const s = e.settlement;
  const nameOf = (id: string): string => e.memberNames[id] ?? id;
  if (s.solo || !s.owed.length) return '정산 없음';
  return s.owed.map((o) => `${nameOf(o.memberId)} → ${nameOf(s.payerId)} ${won(o.amount)}`).join(', ');
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 연도 파일의 모든 숨김 db 탭 → 연간 개요(표지 갱신용). */
export async function collectYearOverview(
  spreadsheetId: string,
  year: string,
  fallbackMembers: string[],
): Promise<YearOverview> {
  const sheets = await getSheets(spreadsheetId);
  const dbTitles = sheets.filter((s) => HIDDEN_DB.test(s.title)).map((s) => s.title);
  const entries: HistoryEntry[] = [];
  for (const t of dbTitles) {
    try {
      const rows = await readRange(spreadsheetId, `'${t}'`);
      const e = rowsToEntry(rows);
      if (e) entries.push(e);
    } catch {
      /* 한 탭 실패는 건너뜀 */
    }
  }
  entries.sort((a, b) => b.periodLabel.localeCompare(a.periodLabel)); // 최신 먼저
  const months: MonthSummary[] = entries.map((e) => ({
    period: e.periodLabel,
    savedAt: e.savedAt,
    owedText: owedTextOf(e),
    cardTotalNet: e.settlement.cardTotalNet,
    sharedTotal: e.settlement.sharedTotal,
    itemCount: e.itemCount,
  }));
  const yearTotals = {
    settledSum: entries.reduce((a, e) => a + e.settlement.owed.reduce((x, o) => x + o.amount, 0), 0),
    cardSum: months.reduce((a, m) => a + m.cardTotalNet, 0),
    sharedSum: months.reduce((a, m) => a + m.sharedTotal, 0),
    txCount: months.reduce((a, m) => a + m.itemCount, 0),
  };
  const members = entries[0] ? Object.values(entries[0].memberNames) : fallbackMembers;
  return { year, generatedAt: nowStamp(), members, months, yearTotals };
}

async function writeView(sid: string, e: HistoryEntry, members: Member[]): Promise<void> {
  const v = viewTab(e.periodLabel);
  await ensureTab(sid, v);
  await clearTab(sid, v);

  const s = e.settlement;
  const nameOf = (id: string): string =>
    e.memberNames[id] ?? members.find((m) => m.id === id)?.name ?? id;
  const rows: (string | number)[][] = [];

  rows.push([`${e.periodLabel} 정산`, '', '', '']);
  rows.push(['', '', '', '']);

  if (!s.solo) {
    for (const o of s.owed) {
      rows.push([`${nameOf(o.memberId)} → ${nameOf(s.payerId)}`, won(o.amount), '', '']);
    }
  }
  rows.push(['카드 총청구(net)', won(s.cardTotalNet), '', '']);
  rows.push(['공용 합계', won(s.sharedTotal), '', '']);
  rows.push(['', '', '', '']);

  rows.push(['공용 카테고리별', '', '', '']);
  for (const c of s.byCategoryShared) rows.push([c.category, won(c.amount), '', '']);
  rows.push(['', '', '', '']);

  rows.push(['일자', '가맹점', '금액(net)', '분류']);
  for (const it of (e.snapshot?.items ?? []).filter((x) => !x.excluded)) {
    const who = isShared(it.assign) ? '공용' : nameOf(memberOf(it.assign) ?? '');
    rows.push([it.date, it.merchant, won(it.net), who + (it.category ? ' · ' + it.category : '')]);
  }

  await writeRange(sid, `'${v}'!A1`, rows);
}

/** 로컬 기록 전체를 시트로 올림(스냅샷 있는 것만). 올린 개수 반환. */
export async function pushAll(
  folderId: string,
  entries: HistoryEntry[],
  members: Member[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const targets = entries.filter((e) => e.snapshot);
  let done = 0;
  for (const e of targets) {
    await pushEntry(folderId, e, members);
    done++;
    onProgress?.(done, targets.length);
  }
  return done;
}

/* ─────────────────────────  PULL (시트 → 로컬 기록)  ───────────────────────── */

const HIDDEN_DB = /^_\d{4}-\d{2}$/; // 숨김 db 탭 이름 패턴

function parseAssign(s: string): Assignment {
  return !s || s === 'shared' ? 'shared' : { member: s.replace(/^m:/, '') };
}

/** db 행(DB_HEADER 순서) → LineItem 복원. */
function rowToItem(r: string[]): LineItem {
  const g = (i: number): string => (r[i] ?? '').toString();
  const n = (i: number): number => Number(g(i)) || 0;
  let splits: Split[] | null = null;
  const raw = g(12);
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p) && p.length) splits = p as Split[];
    } catch {
      /* 무시 */
    }
  }
  return {
    id: uid(),
    date: g(0),
    merchant: g(1),
    approvalNo: g(2) || undefined,
    gross: n(3),
    canceledAmount: n(4),
    net: n(5),
    installment: g(6) === '1',
    installmentMonths: n(7),
    cancel: (g(8) || 'none') as CancelKind,
    excluded: g(9) === '1',
    category: g(10) || null,
    categoryAuto: false, // 저장된 확정값
    assign: parseAssign(g(11)),
    splits,
    manual: g(13) === '1' ? true : undefined,
  };
}

/** 기간 라벨/항목으로 시작·끝일 추정. */
function bounds(period: string, items: LineItem[]): { start: string; end: string } {
  const dates = items.map((i) => i.date).filter(Boolean).sort();
  if (dates.length) return { start: dates[0], end: dates[dates.length - 1] };
  const [y, m] = period.split('.').map(Number);
  const last = new Date(y, m, 0).getDate();
  const p = (x: number): string => String(x).padStart(2, '0');
  return { start: `${y}-${p(m)}-01`, end: `${y}-${p(m)}-${p(last)}` };
}

/** 숨김 db 탭 전체 값 → HistoryEntry 복원(멤버/정산 재계산). */
function rowsToEntry(rows: string[][]): HistoryEntry | null {
  let period = '';
  let savedAt = 0;
  let metaMembers: { id: string; name: string; isPayer: boolean; weight: number }[] = [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const key = (rows[i]?.[0] ?? '').toString();
    if (key === '#period') period = (rows[i][1] ?? '').toString();
    else if (key === '#savedAt') savedAt = Number(rows[i][1]) || 0;
    else if (key === '#members') {
      try {
        metaMembers = JSON.parse(rows[i][1]);
      } catch {
        /* 무시 */
      }
    } else if (key === 'date') {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0 || !period) return null;

  const items = rows
    .slice(headerIdx + 1)
    .filter((r) => r && (r[0] ?? '').toString().trim() !== '')
    .map(rowToItem);

  const members: Member[] = metaMembers.map((m) => ({
    id: m.id,
    name: m.name,
    colorVar: 'm1',
    isPayer: !!m.isPayer,
    weight: Number(m.weight) || 1,
  }));

  const settlement = computeSettlement(items, members);
  const memberNames: Record<string, string> = {};
  for (const m of members) memberNames[m.id] = m.name;
  const b = bounds(period, items);
  const snapshot: ImportResult = {
    source: 'samsung' as SourceId,
    periodLabel: period,
    periodStart: b.start,
    periodEnd: b.end,
    rawCount: items.length,
    fileName: `${period} (시트)`,
    items,
  };
  return {
    id: uid(),
    periodLabel: period,
    source: 'samsung' as SourceId,
    savedAt,
    cardTotalNet: settlement.cardTotalNet,
    settlement,
    memberNames,
    itemCount: items.filter((it) => !it.excluded).length,
    snapshot,
  };
}

/** 폴더의 모든 연도 파일에서 숨김 db 탭을 읽어 HistoryEntry[] 복원. */
export async function pullAll(
  folderId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<HistoryEntry[]> {
  const files = await listFolderSheets(folderId);
  const tasks: { sid: string; title: string }[] = [];
  for (const f of files) {
    const sheets = await getSheets(f.id);
    for (const sh of sheets) {
      if (HIDDEN_DB.test(sh.title)) tasks.push({ sid: f.id, title: sh.title });
    }
  }
  const out: HistoryEntry[] = [];
  let done = 0;
  for (const t of tasks) {
    try {
      const rows = await readRange(t.sid, `'${t.title}'`);
      const e = rowsToEntry(rows);
      if (e) out.push(e);
    } catch {
      /* 한 탭 실패는 건너뜀 */
    }
    onProgress?.(++done, tasks.length);
  }
  return out;
}
