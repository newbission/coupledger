// ===== CSV 내보내기 =====
// 거래 내역 + 정산 요약을 하나의 CSV로 직렬화한다(엑셀 호환, UTF-8 BOM).
import type { ImportResult, Member, SettlementResult, LineItem } from '../types';
import { comma, shortDate, isShared, memberOf } from '../util';

const BOM = '﻿';

/** 한 셀 값을 CSV 규격으로 이스케이프(쉼표/따옴표/개행 → 큰따옴표 감싸기, 내부 " → "") */
function cell(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function row(cells: Array<string | number>): string {
  return cells.map(cell).join(',');
}

/** 취소 종류 → 한글 라벨 */
function cancelLabel(item: LineItem): string {
  switch (item.cancel) {
    case 'partial':
      return '부분취소';
    case 'full':
      return '전체취소';
    default:
      return '';
  }
}

/** 할부 라벨('3개월' / '일시불') */
function installmentLabel(item: LineItem): string {
  if (!item.installment) return '일시불';
  return item.installmentMonths > 0 ? `${item.installmentMonths}개월` : '할부';
}

/** 분류(공용 / 멤버 이름) 라벨 */
function assignLabel(item: LineItem, nameById: Map<string, string>): string {
  if (isShared(item.assign)) return '공용';
  const mid = memberOf(item.assign);
  return (mid && nameById.get(mid)) || '개인';
}

/** 거래의 카테고리 표시: splits 있으면 'A / B' 결합, 없으면 category, 둘 다 없으면 '미분류' */
function categoryLabel(item: LineItem): string {
  if (item.splits && item.splits.length > 0) {
    return item.splits.map((sp) => sp.category).join(' / ');
  }
  return item.category ?? '미분류';
}

/**
 * 거래 행 + 정산 요약을 담은 CSV 문자열을 만든다.
 * - 헤더: 일자,가맹점,카테고리,금액(net),분류,취소,할부
 * - 제외(excluded) 거래도 포함하되 취소 열로 식별 가능
 * - 빈 줄 후 정산 요약(멤버별 줄 금액, 공용 합계, 카드 총청구) 부가
 */
export function exportCSV(imp: ImportResult, members: Member[], s: SettlementResult): string {
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const lines: string[] = [];

  // --- 거래 내역 ---
  lines.push(row(['일자', '가맹점', '카테고리', '금액(net)', '분류', '취소', '할부']));
  for (const item of imp.items) {
    lines.push(
      row([
        shortDate(item.date),
        item.merchant,
        categoryLabel(item),
        comma(item.net),
        assignLabel(item, nameById),
        cancelLabel(item),
        installmentLabel(item),
      ]),
    );
  }

  // --- 정산 요약 ---
  lines.push('');
  lines.push(row(['정산 요약', imp.periodLabel]));
  lines.push(row(['파일', imp.fileName]));

  const payerName = nameById.get(s.payerId) ?? s.payerId;
  lines.push(row(['결제자', payerName]));

  if (!s.solo) {
    // 멤버별 결제자에게 줄 금액(공용 분담 + 개인 분담)
    lines.push('');
    lines.push(row(['멤버', '공용 분담', '개인 분담', '줄 금액']));
    for (const o of s.owed) {
      const name = nameById.get(o.memberId) ?? o.memberId;
      lines.push(row([name, comma(o.sharedShare), comma(o.personal), comma(o.amount)]));
    }
  }

  // 공용 카테고리별 합계
  if (s.byCategoryShared.length > 0) {
    lines.push('');
    lines.push(row(['공용 카테고리', '금액']));
    for (const c of s.byCategoryShared) {
      lines.push(row([c.category, comma(c.amount)]));
    }
  }

  lines.push('');
  lines.push(row(['공용 합계', comma(s.sharedTotal)]));
  lines.push(row(['카드 총청구(net)', comma(s.cardTotalNet)]));
  lines.push(row(['제외 건수', comma(s.excludedCount)]));

  return BOM + lines.join('\r\n') + '\r\n';
}
