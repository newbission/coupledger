// ===== 구글시트 동기화 =====
// 구조: 연도 파일(예 '2026') 안에
//   · 숨김 db 탭 '_2026-05'  → 그 달 원천 데이터(불러오기의 source of truth)
//   · 보이는 뷰 탭 '2026-05' → 사람이 보기 좋은 정산표
// 저장 = db/뷰 탭을 clear 후 현재 상태로 다시 씀(잔여 행 없음). 다른 달은 안 건드림.
import type { HistoryEntry, LineItem, Member, Assignment } from '../types';
import { findOrCreateSheetInFolder, ensureTab, clearTab, writeRange } from './google';
import { won, isShared, memberOf } from '../util';

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

/** 한 기록(달)을 시트에 저장: 연도 파일 → 숨김 db 탭 + 뷰 탭(둘 다 clear 후 재작성). */
export async function pushEntry(
  folderId: string,
  e: HistoryEntry,
  members: Member[],
): Promise<void> {
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
