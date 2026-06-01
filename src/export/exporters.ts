// ===== 로컬 파일 내보내기: Excel(xlsx) / PDF(인쇄뷰) =====
// CSV는 export/csv.ts. 한 달치(ImportResult + SettlementResult)를 받는다.
import * as XLSX from 'xlsx';
import type { ImportResult, Member, SettlementResult } from '../types';
import { won, isShared, memberOf } from '../util';

function nameMap(members: Member[]): (id: string) => string {
  return (id) => members.find((m) => m.id === id)?.name ?? id;
}

function fileBase(period: string): string {
  return `coupledger_${period.replace(/\./g, '-')}`;
}

/** Excel(.xlsx) 다운로드 — '정산' 시트 + '거래내역' 시트. */
export function exportXLSX(imp: ImportResult, members: Member[], s: SettlementResult): void {
  const nameOf = nameMap(members);
  const wb = XLSX.utils.book_new();

  const sum: (string | number)[][] = [[`${imp.periodLabel} 정산`], []];
  if (!s.solo) {
    for (const o of s.owed) sum.push([`${nameOf(o.memberId)} → ${nameOf(s.payerId)}`, won(o.amount)]);
  }
  sum.push(['카드 총청구(net)', won(s.cardTotalNet)]);
  sum.push(['공용 합계', won(s.sharedTotal)]);
  sum.push([], ['공용 카테고리별']);
  for (const c of s.byCategoryShared) sum.push([c.category, won(c.amount)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), '정산');

  const tx: (string | number)[][] = [
    ['일자', '가맹점', '금액(net)', '분류', '카테고리', '취소', '할부'],
  ];
  for (const it of imp.items) {
    const who = it.excluded ? '제외' : isShared(it.assign) ? '공용' : nameOf(memberOf(it.assign) ?? '');
    tx.push([
      it.date,
      it.merchant,
      it.net,
      who,
      it.category ?? '',
      it.cancel === 'none' ? '' : it.cancel,
      it.installment ? `${it.installmentMonths}개월` : '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tx), '거래내역');

  XLSX.writeFile(wb, `${fileBase(imp.periodLabel)}.xlsx`);
}

/** PDF — 새 창에 정산표를 그려 인쇄(사용자가 "PDF로 저장"). */
export function exportPDF(imp: ImportResult, members: Member[], s: SettlementResult): boolean {
  const nameOf = nameMap(members);
  const esc = (x: string): string =>
    x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

  const owed = s.solo
    ? ''
    : s.owed
        .map(
          (o) =>
            `<tr><td>${esc(nameOf(o.memberId))} → ${esc(nameOf(s.payerId))}</td><td class=r><b>${won(o.amount)}</b></td></tr>`,
        )
        .join('');
  const cats = s.byCategoryShared
    .map((c) => `<tr><td>${esc(c.category)}</td><td class=r>${won(c.amount)}</td></tr>`)
    .join('');
  const txs = imp.items
    .filter((it) => !it.excluded)
    .map((it) => {
      const who = isShared(it.assign) ? '공용' : nameOf(memberOf(it.assign) ?? '');
      return `<tr><td>${it.date}</td><td>${esc(it.merchant)}</td><td class=r>${won(it.net)}</td><td>${esc(who)}${it.category ? ' · ' + esc(it.category) : ''}</td></tr>`;
    })
    .join('');

  const html = `<!doctype html><html lang=ko><head><meta charset=utf-8><title>${imp.periodLabel} 정산</title>
<style>
  body{font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:30px;color:#2a2a2a}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#888;font-size:12px;margin-bottom:18px}
  h2{font-size:13px;margin:22px 0 6px;color:#666}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td{padding:6px 6px;border-bottom:1px solid #eee} .r{text-align:right;font-variant-numeric:tabular-nums}
</style></head><body>
  <h1>coupledger · ${imp.periodLabel} 정산</h1>
  <div class=sub>카드 총청구(net) ${won(s.cardTotalNet)}</div>
  <h2>정산 결과</h2><table>${owed}<tr><td>공용 합계</td><td class=r>${won(s.sharedTotal)}</td></tr></table>
  <h2>공용 카테고리별</h2><table>${cats}</table>
  <h2>거래내역</h2><table><tr><td><b>일자</b></td><td><b>가맹점</b></td><td class=r><b>금액</b></td><td><b>분류</b></td></tr>${txs}</table>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 500);
  return true;
}
