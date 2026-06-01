// ===== 삼성카드 '카드이용내역' .xlsx 어댑터 =====
// 흐름: .xlsx 파싱 → 행별 RawTxn → 승인번호로 병합 → LineItem → ImportResult
//  - 상세시트 '■ 국내이용내역' 의 데이터행을 RawTxn 으로 변환.
//  - 같은 승인번호(approvalNo)의 원거래/취소행을 하나의 LineItem 으로 netting.
//  - 요약시트 '■ 카드이용내역' 의 조회기간이 있으면 기간 라벨/범위로 우선 사용.
import * as XLSX from 'xlsx';
import type {
  CancelKind,
  ImportResult,
  LineItem,
  RawTxn,
} from '../types';
import { periodOf, uid } from '../util';

const DETAIL_SHEET = '■ 국내이용내역';
const SUMMARY_SHEET = '■ 카드이용내역';

// 상세시트 헤더(1행) 라벨 — 인덱스가 아니라 라벨로 컬럼을 찾는다(열 순서 변화 대비).
const COL = {
  date: '승인일자',
  time: '승인시각',
  merchant: '가맹점명',
  amount: '승인금액(원)',
  instKind: '일시불할부구분',
  instMonths: '할부개월',
  approvalNo: '승인번호',
  cancel: '취소여부',
  paymentDate: '결제일',
} as const;

type Row = Array<string | number>;

/** 삼성카드 .xlsx 파일 → ImportResult */
export async function parseSamsung(file: File): Promise<ImportResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });

  const detail = wb.Sheets[DETAIL_SHEET];
  if (!detail) {
    throw new Error(`상세시트 '${DETAIL_SHEET}' 를 찾을 수 없습니다.`);
  }

  const rows = XLSX.utils.sheet_to_json<Row>(detail, {
    header: 1,
    raw: false,
    defval: '',
  });
  if (rows.length < 1) {
    throw new Error('상세시트에 데이터가 없습니다.');
  }

  // 헤더행 → 라벨→컬럼인덱스 매핑.
  const header = rows[0].map((c) => String(c).trim());
  const idx = (label: string): number => header.indexOf(label);
  const iDate = idx(COL.date);
  const iTime = idx(COL.time);
  const iMerchant = idx(COL.merchant);
  const iAmount = idx(COL.amount);
  const iInstKind = idx(COL.instKind);
  const iInstMonths = idx(COL.instMonths);
  const iApprovalNo = idx(COL.approvalNo);
  const iCancel = idx(COL.cancel);
  const iPaymentDate = idx(COL.paymentDate);

  if (iDate < 0 || iAmount < 0 || iApprovalNo < 0) {
    throw new Error('삼성카드 이용내역 형식이 아닙니다(필수 컬럼 누락).');
  }

  // ----- 행 → RawTxn -----
  const raws: RawTxn[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const date = toISODate(cell(row, iDate));
    const approvalNo = cell(row, iApprovalNo);
    // 날짜·승인번호가 모두 없으면 데이터행이 아님(빈 줄 등) → 건너뜀.
    if (!date && !approvalNo) continue;

    raws.push({
      date,
      time: iTime >= 0 ? cell(row, iTime) || undefined : undefined,
      merchant: iMerchant >= 0 ? cell(row, iMerchant) : '',
      amount: toAmount(cell(row, iAmount)),
      installment:
        iInstKind >= 0 ? cell(row, iInstKind) === '할부' : false,
      installmentMonths:
        iInstMonths >= 0 ? toInt(cell(row, iInstMonths)) : 0,
      approvalNo,
      cancel: toCancelKind(iCancel >= 0 ? cell(row, iCancel) : ''),
      paymentDate:
        iPaymentDate >= 0 ? toISODate(cell(row, iPaymentDate)) || undefined : undefined,
      source: 'samsung',
    });
  }

  const rawCount = raws.length;
  const items = mergeByApproval(raws);

  // ----- 기간 산정: 요약시트 조회기간 우선, 없으면 item 날짜 min/max -----
  const range = readSummaryRange(wb.Sheets[SUMMARY_SHEET]);
  const dates = items.map((it) => it.date).filter(Boolean).sort();
  const periodStart = range?.start || dates[0] || '';
  const periodEnd = range?.end || dates[dates.length - 1] || '';
  const periodLabel = periodStart ? periodOf(periodStart) : '';

  return {
    source: 'samsung',
    periodLabel,
    periodStart,
    periodEnd,
    rawCount,
    fileName: file.name,
    items,
  };
}

// ===== 병합: 승인번호로 원거래/취소 netting =====
function mergeByApproval(raws: RawTxn[]): LineItem[] {
  // 승인번호별로 그룹. 첫 등장 순서를 보존.
  const groups = new Map<string, RawTxn[]>();
  const order: string[] = [];
  for (const t of raws) {
    // 승인번호가 비면 단독 항목으로 처리(병합 대상에서 분리, 충돌 방지).
    const key = t.approvalNo || `__solo_${order.length}_${uid()}`;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
      order.push(key);
    }
    g.push(t);
  }

  const items: LineItem[] = [];
  for (const key of order) {
    const g = groups.get(key)!;

    let gross = 0; // 양수 합(원거래)
    let canceledAmount = 0; // 음수 합(취소)
    let cancel: CancelKind = 'none';
    let installment = false;
    let installmentMonths = 0;

    for (const t of g) {
      if (t.amount >= 0) gross += t.amount;
      else canceledAmount += t.amount;
      cancel = strongerCancel(cancel, t.cancel);
      if (t.installment) {
        installment = true;
        if (t.installmentMonths > installmentMonths) {
          installmentMonths = t.installmentMonths;
        }
      }
    }

    const net = gross + canceledAmount;
    // 대표 메타(원거래 우선): 양수 금액행을 우선, 없으면 첫 행.
    const rep = g.find((t) => t.amount >= 0) ?? g[0];

    items.push({
      id: uid(),
      date: rep.date,
      merchant: rep.merchant,
      approvalNo: rep.approvalNo || undefined,
      gross,
      canceledAmount,
      net,
      installment,
      installmentMonths,
      cancel,
      excluded: cancel === 'full' || net <= 0,
      category: null,
      categoryAuto: false,
      assign: 'shared',
      splits: null,
    });
  }

  return items;
}

// ===== 변환 헬퍼 =====

function cell(row: Row, i: number): string {
  if (i < 0 || i >= row.length) return '';
  const v = row[i];
  return v == null ? '' : String(v).trim();
}

/** '2026.05.29' / '20260529' / '2026-05-29' → '2026-05-29'. 인식 불가 시 ''. */
function toISODate(s: string): string {
  const v = s.trim();
  if (!v) return '';
  // 2026.05.29 또는 2026-05-29 또는 2026/05/29
  const m = v.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) {
    return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  }
  // 20260529 (결제일 형식)
  const m2 = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) {
    return `${m2[1]}-${m2[2]}-${m2[3]}`;
  }
  return '';
}

function pad2(s: string): string {
  return s.length === 1 ? '0' + s : s;
}

/** '88,870' / '-17,030' / '₩1,234' → number(부호 보존). */
function toAmount(s: string): number {
  const cleaned = s.replace(/[^\d.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** '0' / '3' → int. 인식 불가 시 0. */
function toInt(s: string): number {
  const n = parseInt(s.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/** '부분취소'→'partial', '전체취소'→'full', 그 외→'none'. */
function toCancelKind(s: string): CancelKind {
  const v = s.trim();
  if (v === '부분취소') return 'partial';
  if (v === '전체취소') return 'full';
  return 'none';
}

/** 두 취소 종류 중 더 강한 쪽(full > partial > none). */
function strongerCancel(a: CancelKind, b: CancelKind): CancelKind {
  const rank: Record<CancelKind, number> = { none: 0, partial: 1, full: 2 };
  return rank[b] > rank[a] ? b : a;
}

// ===== 요약시트 조회기간 =====

/** 요약시트 '■ 카드이용내역' 의 조회기간('2026.05.01 ~ 2026.05.30') → {start,end} ISO. */
function readSummaryRange(
  sheet: XLSX.WorkSheet | undefined,
): { start: string; end: string } | null {
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  });
  if (rows.length < 1) return null;

  const header = rows[0].map((c) => String(c).trim());
  let col = header.indexOf('조회기간');
  // 헤더에 없으면 전체 셀에서 'YYYY.MM.DD ~ YYYY.MM.DD' 패턴을 탐색.
  for (const row of rows) {
    const candidates =
      col >= 0 && col < row.length ? [String(row[col])] : row.map((c) => String(c));
    for (const text of candidates) {
      const m = text.match(
        /(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})\s*~\s*(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/,
      );
      if (m) {
        const start = toISODate(m[1]);
        const end = toISODate(m[2]);
        if (start && end) return { start, end };
      }
    }
    // 첫 데이터행에서 못 찾았고 헤더 컬럼 탐색이었다면 한 번만 전체로 폴백.
    if (col >= 0) col = -1;
  }
  return null;
}
