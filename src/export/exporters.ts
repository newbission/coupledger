// ===== 로컬 파일 내보내기: Excel(xlsx) / PDF(인쇄뷰) — 브랜드 디자인 =====
// CSV는 export/csv.ts. 한 달치(ImportResult + SettlementResult)를 받는다.
import * as XLSX from 'xlsx-js-style';
import type { ImportResult, Member, SettlementResult } from '../types';
import { won, isShared, memberOf } from '../util';

function nameMap(members: Member[]): (id: string) => string {
  return (id) => members.find((m) => m.id === id)?.name ?? id;
}
function fileBase(period: string): string {
  return `coupledger_${period.replace(/\./g, '-')}`;
}
function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 멤버별 색(공용은 항상 indigo) — Excel/PDF 공용 팔레트.
const MEMBER_COLORS = ['2563EB', '059669', 'D97706', 'DB2777', '7C3AED', '0891B2'];
function memberColor(members: Member[], id: string): string {
  const i = members.findIndex((m) => m.id === id);
  return MEMBER_COLORS[(i < 0 ? 0 : i) % MEMBER_COLORS.length];
}

/* ─────────────────────────  Excel  ───────────────────────── */

const KRW = '"₩"#,##0';
const XC = {
  ink: '111827',
  sub: '6B7280',
  line: 'E5E7EB',
  accent: '4F46E5',
  accentDk: '3730A3',
  accentBg: 'EEF2FF',
  heroBg: 'E0E7FF',
  zebra: 'F8FAFC',
  white: 'FFFFFF',
};
const XFONT = 'Apple SD Gothic Neo';

type Sty = Record<string, unknown>;
type XCell = { v: string | number; s?: Sty; z?: string };

const line = { style: 'thin', color: { rgb: XC.line } };
function bord(sides: string): Sty {
  const b: Record<string, unknown> = {};
  if (sides.includes('t')) b.top = line;
  if (sides.includes('b')) b.bottom = line;
  if (sides.includes('l')) b.left = line;
  if (sides.includes('r')) b.right = line;
  return b;
}
const S = {
  title: { font: { name: XFONT, bold: true, sz: 18, color: { rgb: XC.accentDk } }, alignment: { vertical: 'center' } } as Sty,
  sub: { font: { name: XFONT, sz: 10, color: { rgb: XC.sub } }, alignment: { vertical: 'center' } } as Sty,
  section: {
    font: { name: XFONT, bold: true, sz: 11, color: { rgb: XC.white } },
    fill: { patternType: 'solid', fgColor: { rgb: XC.accent } },
    alignment: { vertical: 'center', horizontal: 'left' },
  } as Sty,
  label: { font: { name: XFONT, sz: 11, color: { rgb: '374151' } }, alignment: { vertical: 'center' }, border: bord('b') } as Sty,
  amount: { font: { name: XFONT, sz: 11, color: { rgb: XC.ink } }, alignment: { vertical: 'center', horizontal: 'right' }, border: bord('b'), } as Sty,
  heroL: {
    font: { name: XFONT, bold: true, sz: 13, color: { rgb: XC.ink } },
    fill: { patternType: 'solid', fgColor: { rgb: XC.heroBg } },
    alignment: { vertical: 'center' },
  } as Sty,
  heroR: {
    font: { name: XFONT, bold: true, sz: 14, color: { rgb: XC.accentDk } },
    fill: { patternType: 'solid', fgColor: { rgb: XC.heroBg } },
    alignment: { vertical: 'center', horizontal: 'right' },
  } as Sty,
  totalL: { font: { name: XFONT, bold: true, sz: 11, color: { rgb: XC.ink } }, alignment: { vertical: 'center' }, border: bord('b') } as Sty,
  totalR: { font: { name: XFONT, bold: true, sz: 11, color: { rgb: XC.accentDk } }, alignment: { vertical: 'center', horizontal: 'right' }, border: bord('b') } as Sty,
  th: {
    font: { name: XFONT, bold: true, sz: 10.5, color: { rgb: XC.white } },
    fill: { patternType: 'solid', fgColor: { rgb: XC.accent } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: bord('tblr'),
  } as Sty,
};
const td = (zebra: boolean, extra?: Sty): Sty => ({
  font: { name: XFONT, sz: 10, color: { rgb: XC.ink } },
  alignment: { vertical: 'center' },
  border: bord('blr'),
  ...(zebra ? { fill: { patternType: 'solid', fgColor: { rgb: XC.zebra } } } : {}),
  ...extra,
});

/** 셀 배열 → 워크시트(스타일/서식 보존). */
function makeSheet(rows: XCell[][], cols: number[], merges?: XLSX.Range[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxC = cols.length - 1;
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      ws[addr] = {
        v: cell.v,
        t: typeof cell.v === 'number' ? 'n' : 's',
        ...(cell.s ? { s: cell.s } : {}),
        ...(cell.z ? { z: cell.z } : {}),
      };
      if (c > maxC) maxC = c;
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: maxC } });
  ws['!cols'] = cols.map((w) => ({ wch: w }));
  if (merges) ws['!merges'] = merges;
  return ws;
}

/** Excel(.xlsx) 다운로드 — '정산' + '거래내역' 두 시트, 풀 스타일. */
export function exportXLSX(imp: ImportResult, members: Member[], s: SettlementResult): void {
  const nameOf = nameMap(members);
  const wb = XLSX.utils.book_new();
  const pad = (n: number): XCell[] => Array.from({ length: n }, () => ({ v: '' }));

  /* ── 시트1: 정산 ── */
  const R: XCell[][] = [];
  R.push([{ v: `coupledger · ${imp.periodLabel} 정산`, s: S.title }, ...pad(2)]);
  R.push([{ v: `생성 ${stamp()}`, s: S.sub }, ...pad(2)]);
  R.push(pad(3));
  R.push([{ v: '  정산 결과', s: S.section }, { v: '', s: S.section }, { v: '', s: S.section }]);
  if (!s.solo) {
    for (const o of s.owed) {
      R.push([
        { v: `${nameOf(o.memberId)} → ${nameOf(s.payerId)} 보내기`, s: S.heroL },
        { v: o.amount, s: S.heroR, z: KRW },
        { v: '', s: S.heroR },
      ]);
    }
  }
  R.push([{ v: '카드 총청구 (net)', s: S.label }, { v: s.cardTotalNet, s: S.amount, z: KRW }, { v: '', s: S.amount }]);
  R.push([{ v: '공용 합계', s: S.totalL }, { v: s.sharedTotal, s: S.totalR, z: KRW }, { v: '', s: S.totalR }]);
  R.push(pad(3));
  R.push([{ v: '  공용 카테고리별', s: S.section }, { v: '', s: S.section }, { v: '', s: S.section }]);
  s.byCategoryShared.forEach((c, i) => {
    const z = i % 2 === 1;
    R.push([
      { v: c.category, s: td(z) },
      { v: c.amount, s: td(z, { alignment: { vertical: 'center', horizontal: 'right' } }), z: KRW },
      { v: '', s: td(z) },
    ]);
  });
  const ws1 = makeSheet(R, [26, 18, 4], [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } },
  ]);
  ws1['!rows'] = [{ hpt: 26 }, { hpt: 16 }];
  XLSX.utils.book_append_sheet(wb, ws1, '정산');

  /* ── 시트2: 거래내역 ── */
  const heads = ['일자', '가맹점', '금액(net)', '분류', '카테고리', '취소', '할부'];
  const T: XCell[][] = [];
  T.push([{ v: `${imp.periodLabel} 거래내역`, s: S.title }, ...pad(6)]);
  T.push(heads.map((h) => ({ v: h, s: S.th })));
  imp.items.forEach((it, i) => {
    const z = i % 2 === 1;
    const shared = isShared(it.assign);
    const whoName = it.excluded ? '제외' : shared ? '공용' : nameOf(memberOf(it.assign) ?? '');
    const whoColor = it.excluded ? XC.sub : shared ? XC.accent : memberColor(members, memberOf(it.assign) ?? '');
    T.push([
      { v: it.date, s: td(z) },
      { v: it.merchant, s: td(z) },
      { v: it.net, s: td(z, { alignment: { vertical: 'center', horizontal: 'right' }, font: { name: XFONT, sz: 10, bold: true, color: { rgb: XC.ink } } }), z: KRW },
      { v: whoName, s: td(z, { font: { name: XFONT, sz: 10, bold: true, color: { rgb: whoColor } }, alignment: { vertical: 'center', horizontal: 'center' } }) },
      { v: it.category ?? '', s: td(z) },
      { v: it.cancel === 'none' ? '' : it.cancel, s: td(z, { alignment: { vertical: 'center', horizontal: 'center' } }) },
      { v: it.installment ? `${it.installmentMonths}개월` : '', s: td(z, { alignment: { vertical: 'center', horizontal: 'center' } }) },
    ]);
  });
  const ws2 = makeSheet(T, [13, 32, 14, 9, 15, 8, 9], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }]);
  ws2['!rows'] = [{ hpt: 24 }, { hpt: 20 }];
  ws2['!autofilter'] = { ref: `A2:G${T.length}` };
  XLSX.utils.book_append_sheet(wb, ws2, '거래내역');

  XLSX.writeFile(wb, `${fileBase(imp.periodLabel)}.xlsx`);
}

/* ─────────────────────────  PDF (인쇄뷰)  ───────────────────────── */

const esc = (x: string): string =>
  x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** PDF — 새 창에 브랜드 정산표를 그려 인쇄(사용자가 "PDF로 저장"). */
export function exportPDF(imp: ImportResult, members: Member[], s: SettlementResult): boolean {
  const nameOf = nameMap(members);

  const owedHtml = s.solo
    ? `<div class="hero solo"><div class="hero-cap">이번 달 공용 합계</div><div class="hero-amt">${won(s.sharedTotal)}</div></div>`
    : `<div class="hero">` +
      s.owed
        .map(
          (o) => `<div class="owe">
            <div class="owe-flow"><span class="who pay">${esc(nameOf(o.memberId))}</span>
              <span class="arrow">→</span>
              <span class="who get">${esc(nameOf(s.payerId))}</span></div>
            <div class="owe-amt">${won(o.amount)}</div>
          </div>`,
        )
        .join('') +
      `</div>`;

  const stats = `<div class="stats">
      <div class="stat"><div class="stat-cap">카드 총청구 (net)</div><div class="stat-val">${won(s.cardTotalNet)}</div></div>
      <div class="stat"><div class="stat-cap">공용 합계</div><div class="stat-val accent">${won(s.sharedTotal)}</div></div>
      <div class="stat"><div class="stat-cap">거래 건수</div><div class="stat-val">${imp.items.filter((i) => !i.excluded).length}건</div></div>
    </div>`;

  const maxCat = Math.max(1, ...s.byCategoryShared.map((c) => c.amount));
  const bars = s.byCategoryShared.length
    ? `<h2>공용 카테고리별</h2><div class="bars">` +
      s.byCategoryShared
        .map(
          (c) => `<div class="bar-row">
            <div class="bar-name">${esc(c.category)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (c.amount / maxCat) * 100)}%"></div></div>
            <div class="bar-amt">${won(c.amount)}</div>
          </div>`,
        )
        .join('') +
      `</div>`
    : '';

  const txRows = imp.items
    .filter((it) => !it.excluded)
    .map((it) => {
      const shared = isShared(it.assign);
      const who = shared ? '공용' : nameOf(memberOf(it.assign) ?? '');
      const color = shared ? '4F46E5' : memberColor(members, memberOf(it.assign) ?? '');
      return `<tr>
        <td class="c-date">${esc(it.date)}</td>
        <td>${esc(it.merchant)}${it.installment ? `<span class="tag">${it.installmentMonths}개월</span>` : ''}</td>
        <td class="r num">${won(it.net)}</td>
        <td><span class="chip" style="--c:#${color}">${esc(who)}</span>${it.category ? `<span class="cat">${esc(it.category)}</span>` : ''}</td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${esc(imp.periodLabel)} 정산 · coupledger</title>
<style>
  :root{ --accent:#4F46E5; --accent-dk:#3730A3; --ink:#111827; --sub:#6b7280; --line:#eef0f4; }
  *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @page{ margin:14mm; }
  body{ font-family:-apple-system,'Apple SD Gothic Neo','Pretendard','Malgun Gothic',sans-serif;
        color:var(--ink); margin:0; font-size:12.5px; line-height:1.5; }
  .wm{ font-size:22px; font-weight:800; letter-spacing:-.5px; display:flex; align-items:center; gap:1px; }
  .wm .b{ color:#1f2937; }
  .wm .chipx{ display:inline-flex; align-items:center; justify-content:center; width:23px; height:23px;
        border-radius:7px; color:#fff; font-weight:800; margin:0 1px; }
  .wm .c1{ background:var(--accent); } .wm .c2{ background:#FB7185; margin-left:-7px; }
  .top{ display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid var(--ink); padding-bottom:10px; margin-bottom:18px; }
  .top .meta{ text-align:right; color:var(--sub); font-size:11px; }
  .top .period{ font-size:15px; font-weight:700; color:var(--ink); }

  .hero{ display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px; }
  .owe{ flex:1; min-width:200px; background:linear-gradient(135deg,#EEF2FF,#E0E7FF); border:1px solid #C7D2FE;
        border-radius:14px; padding:16px 18px; }
  .owe-flow{ display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; margin-bottom:6px; }
  .who{ padding:2px 9px; border-radius:999px; background:#fff; border:1px solid #C7D2FE; }
  .who.get{ background:var(--accent); color:#fff; border-color:var(--accent); }
  .arrow{ color:var(--accent); font-weight:800; }
  .owe-amt{ font-size:26px; font-weight:800; color:var(--accent-dk); letter-spacing:-.5px; }
  .hero.solo .hero-cap{ color:var(--sub); font-size:12px; }
  .hero.solo .hero-amt{ font-size:26px; font-weight:800; color:var(--accent-dk); }
  .hero.solo{ background:linear-gradient(135deg,#EEF2FF,#E0E7FF); border:1px solid #C7D2FE; border-radius:14px; padding:16px 18px; width:100%; }

  .stats{ display:flex; gap:10px; margin-bottom:22px; }
  .stat{ flex:1; border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:#fafbfc; }
  .stat-cap{ color:var(--sub); font-size:11px; margin-bottom:3px; }
  .stat-val{ font-size:17px; font-weight:700; letter-spacing:-.3px; }
  .stat-val.accent{ color:var(--accent-dk); }

  h2{ font-size:12px; font-weight:700; color:var(--sub); text-transform:none; margin:0 0 9px; letter-spacing:.2px; }
  .bars{ display:flex; flex-direction:column; gap:7px; margin-bottom:22px; }
  .bar-row{ display:grid; grid-template-columns:96px 1fr 96px; align-items:center; gap:10px; }
  .bar-name{ font-size:11.5px; color:#374151; }
  .bar-track{ height:9px; background:#EEF2FF; border-radius:999px; overflow:hidden; }
  .bar-fill{ height:100%; background:linear-gradient(90deg,#818CF8,#4F46E5); border-radius:999px; }
  .bar-amt{ text-align:right; font-size:11.5px; font-variant-numeric:tabular-nums; color:var(--ink); }

  table{ width:100%; border-collapse:collapse; font-size:11.5px; }
  thead th{ background:var(--accent); color:#fff; font-weight:700; padding:8px 9px; text-align:left; }
  thead th:first-child{ border-radius:8px 0 0 8px; } thead th:last-child{ border-radius:0 8px 8px 0; text-align:right; }
  tbody td{ padding:7px 9px; border-bottom:1px solid var(--line); vertical-align:middle; }
  tbody tr:nth-child(even){ background:#fafbfc; }
  .c-date{ color:var(--sub); white-space:nowrap; font-variant-numeric:tabular-nums; }
  .num{ font-variant-numeric:tabular-nums; font-weight:600; }
  td.r{ text-align:right; }
  .chip{ display:inline-block; padding:1.5px 8px; border-radius:999px; font-size:10.5px; font-weight:700;
        color:var(--c); background:color-mix(in srgb, var(--c) 12%, #fff); border:1px solid color-mix(in srgb, var(--c) 30%, #fff); }
  .cat{ color:var(--sub); font-size:10.5px; margin-left:6px; }
  .tag{ display:inline-block; margin-left:6px; padding:1px 6px; border-radius:6px; background:#F1F5F9; color:#64748B; font-size:10px; font-weight:600; }
  tr{ break-inside:avoid; }
  .foot{ margin-top:18px; text-align:center; color:#aab; font-size:10px; }
</style></head><body>
  <div class="top">
    <div>
      <div class="wm"><span class="b">coup</span><span class="chipx c1">l</span><span class="chipx c2">e</span><span class="b">dger</span></div>
    </div>
    <div class="meta"><div class="period">${esc(imp.periodLabel)} 정산</div>생성 ${stamp()}</div>
  </div>
  ${owedHtml}
  ${stats}
  ${bars}
  <h2>거래내역 · ${imp.items.filter((i) => !i.excluded).length}건</h2>
  <table><thead><tr><th>일자</th><th>가맹점</th><th style="text-align:right">금액(net)</th><th>분류</th></tr></thead>
  <tbody>${txRows}</tbody></table>
  <div class="foot">coupledger — 함께 쓰는 생활비, 깔끔하게 정산</div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 450);
  return true;
}
