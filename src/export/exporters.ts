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


/* ─────────────────────────  Excel  ───────────────────────── */

const KRW = '"₩"#,##0';
// 미니멀 그레이스케일 — 색 최소, 레이아웃으로 승부.
const XC = {
  ink: '1D2028',
  sub: '6B7280',
  faint: '9CA3AF',
  line: 'E5E8EB',
  head: 'F3F4F6', // 헤더/섹션 연회색 채움
  headInk: '2E323B', // 헤더 텍스트
  rule: '838B98', // 막대/중간 구분
  zebra: 'FAFBFC',
  white: 'FFFFFF',
};
const XFONT = 'Malgun Gothic';
const KRWNEG = '"₩"#,##0;[Red]-"₩"#,##0'; // 환불/음수는 빨강
const PCTZ = '0.0%';

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
const headFill = { patternType: 'solid', fgColor: { rgb: XC.head } };
const S = {
  title: { font: { name: XFONT, bold: true, sz: 18, color: { rgb: XC.ink } }, alignment: { vertical: 'center' } } as Sty,
  sub: { font: { name: XFONT, sz: 10, color: { rgb: XC.sub } }, alignment: { vertical: 'center' } } as Sty,
  section: {
    font: { name: XFONT, bold: true, sz: 11, color: { rgb: XC.headInk } },
    fill: headFill,
    alignment: { vertical: 'center', horizontal: 'left' },
  } as Sty,
  label: { font: { name: XFONT, sz: 11, color: { rgb: XC.sub } }, alignment: { vertical: 'center' }, border: bord('b') } as Sty,
  amount: { font: { name: XFONT, sz: 11, color: { rgb: XC.ink } }, alignment: { vertical: 'center', horizontal: 'right' }, border: bord('b') } as Sty,
  heroL: {
    font: { name: XFONT, bold: true, sz: 13, color: { rgb: XC.ink } },
    fill: headFill,
    alignment: { vertical: 'center' },
    border: bord('tblr'),
  } as Sty,
  heroR: {
    font: { name: XFONT, bold: true, sz: 14, color: { rgb: XC.ink } },
    fill: headFill,
    alignment: { vertical: 'center', horizontal: 'right' },
    border: bord('tblr'),
  } as Sty,
  totalL: { font: { name: XFONT, bold: true, sz: 11, color: { rgb: XC.ink } }, alignment: { vertical: 'center' }, border: bord('t') } as Sty,
  totalR: { font: { name: XFONT, bold: true, sz: 11, color: { rgb: XC.ink } }, alignment: { vertical: 'center', horizontal: 'right' }, border: bord('t') } as Sty,
  th: {
    font: { name: XFONT, bold: true, sz: 10.5, color: { rgb: XC.headInk } },
    fill: headFill,
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

// KPI/분담/막대용 보조 스타일.
const kpiLabel: Sty = { font: { name: XFONT, sz: 9.5, color: { rgb: XC.sub } }, alignment: { vertical: 'center' }, border: bord('b') };
const kpiVal: Sty = { font: { name: XFONT, sz: 12, bold: true, color: { rgb: XC.ink } }, alignment: { vertical: 'center', horizontal: 'right' }, border: bord('b') };
const kpiSub: Sty = { font: { name: XFONT, sz: 9.5, color: { rgb: XC.sub } }, alignment: { vertical: 'center', horizontal: 'right' }, border: bord('b') };
const barSty = (z: boolean): Sty => td(z, { font: { name: XFONT, sz: 9, color: { rgb: XC.rule } }, alignment: { vertical: 'center', horizontal: 'left' } });

/** Excel(.xlsx) 다운로드 — '가계부 대시보드' + '거래내역', 가계부 스타일. */
export function exportXLSX(imp: ImportResult, members: Member[], s: SettlementResult): void {
  const nameOf = nameMap(members);
  const wb = XLSX.utils.book_new();
  const pad = (n: number): XCell[] => Array.from({ length: n }, () => ({ v: '' }));
  const section = (label: string): XCell[] => [
    { v: label, s: S.section },
    { v: '', s: S.section },
    { v: '', s: S.section },
    { v: '', s: S.section },
    { v: '', s: S.section },
  ];

  // ── 지표 계산(PDF와 동일) ──
  const active = imp.items.filter((it) => !it.excluded);
  const txCount = active.length;
  const personalTotal = Object.values(s.perMemberPersonal).reduce((a, b) => a + b, 0);
  const avgTx = txCount ? Math.round(s.cardTotalNet / txCount) : 0;
  const installCount = active.filter((it) => it.installment).length;
  const top = s.byCategoryShared[0];
  const totalW = members.reduce((a, m) => a + (m.weight || 1), 0) || 1;
  const owedByMember = new Map(s.owed.map((o) => [o.memberId, o]));
  const pctOf = (n: number): number => (s.cardTotalNet ? n / s.cardTotalNet : 0);

  /* ── 시트1: 가계부 대시보드 ── */
  const R: XCell[][] = [];
  const merges: XLSX.Range[] = [];
  const mergeRow = (r: number): void => {
    merges.push({ s: { r, c: 0 }, e: { r, c: 4 } });
  };

  mergeRow(0); R.push([{ v: `coupledger · ${imp.periodLabel} 가계부`, s: S.title }, ...pad(4)]);
  mergeRow(1); R.push([{ v: `${imp.periodStart} ~ ${imp.periodEnd} · 생성 ${stamp()}`, s: S.sub }, ...pad(4)]);
  R.push(pad(5));

  // 정산 결과(히어로)
  mergeRow(R.length); R.push(section('  🤝 정산 결과'));
  if (s.solo) {
    R.push([{ v: '이번 달 총지출', s: S.heroL }, { v: s.cardTotalNet, s: S.heroR, z: KRW }, ...pad(3)]);
  } else if (!s.owed.length) {
    R.push([{ v: '정산할 금액이 없어요 ✅', s: S.heroL }, ...pad(4)]);
  } else {
    for (const o of s.owed) {
      merges.push({ s: { r: R.length, c: 1 }, e: { r: R.length, c: 4 } });
      R.push([
        { v: `${nameOf(o.memberId)} → ${nameOf(s.payerId)} 보내기`, s: S.heroL },
        { v: o.amount, s: S.heroR, z: KRW },
        ...pad(3),
      ]);
    }
  }
  R.push(pad(5));

  // KPI
  mergeRow(R.length); R.push(section('  📊 한눈에 보기'));
  const kpi = (label: string, value: number | string, sub: string): void => {
    R.push([
      { v: label, s: kpiLabel },
      { v: value, s: kpiVal, z: typeof value === 'number' ? KRW : undefined },
      { v: sub, s: kpiSub },
      { v: '', s: kpiLabel },
      { v: '', s: kpiLabel },
    ]);
  };
  kpi('카드 총청구', s.cardTotalNet, `${txCount}건`);
  if (!s.solo) {
    kpi('공용 합계', s.sharedTotal, `${Math.round(pctOf(s.sharedTotal) * 100)}%`);
    kpi('개인 합계', personalTotal, `${Math.round(pctOf(personalTotal) * 100)}%`);
  }
  kpi('평균 거래액', avgTx, '');
  kpi('할부', `${installCount}건`, '');
  kpi('최다 카테고리', top ? top.category : '—', top ? wonCompact(top.amount) : '');
  R.push(pad(5));

  // 멤버별 분담(다인)
  if (!s.solo && members.length >= 2) {
    mergeRow(R.length); R.push(section('  👥 멤버별 분담'));
    R.push(['멤버', '공용 분담', '개인', '합계', ''].map((h) => ({ v: h, s: S.th })));
    members.forEach((m, i) => {
      const z = i % 2 === 1;
      const o = owedByMember.get(m.id);
      const personal = s.perMemberPersonal[m.id] ?? 0;
      const shared = o ? o.sharedShare : Math.round((s.sharedTotal * (m.weight || 1)) / totalW);
      const isPayer = m.id === s.payerId;
      const nameSty = td(z, { font: { name: XFONT, sz: 10, bold: true, color: { rgb: XC.ink } } });
      R.push([
        { v: m.name + (isPayer ? ' (결제자)' : ''), s: nameSty },
        { v: shared, s: td(z, { alignment: { vertical: 'center', horizontal: 'right' } }), z: KRW },
        { v: personal, s: td(z, { alignment: { vertical: 'center', horizontal: 'right' } }), z: KRW },
        isPayer
          ? { v: '— 선결제', s: td(z, { alignment: { vertical: 'center', horizontal: 'right' }, font: { name: XFONT, sz: 10, color: { rgb: XC.sub } } }) }
          : { v: o ? o.amount : shared + personal, s: td(z, { alignment: { vertical: 'center', horizontal: 'right' }, font: { name: XFONT, sz: 10, bold: true, color: { rgb: XC.ink } } }), z: KRW },
        { v: '', s: td(z) },
      ]);
    });
    R.push(pad(5));
  }

  // 카테고리 + 막대 + 비중
  mergeRow(R.length); R.push(section(s.solo ? '  🏷️ 카테고리별 지출' : '  🏷️ 공용 카테고리별 지출'));
  R.push(['카테고리', '금액', '비중', '분포', ''].map((h) => ({ v: h, s: S.th })));
  const catBase = s.byCategoryShared.reduce((a, c) => a + c.amount, 0) || 1;
  s.byCategoryShared.forEach((c, i) => {
    const z = i % 2 === 1;
    const pct = c.amount / catBase;
    R.push([
      { v: c.category, s: td(z) },
      { v: c.amount, s: td(z, { alignment: { vertical: 'center', horizontal: 'right' } }), z: KRW },
      { v: pct, s: td(z, { alignment: { vertical: 'center', horizontal: 'center' } }), z: PCTZ },
      { v: '█'.repeat(Math.max(1, Math.round(pct * 16))), s: barSty(z) },
      { v: '', s: td(z) },
    ]);
  });
  R.push([
    { v: '합계', s: S.totalL },
    { v: s.sharedTotal, s: S.totalR, z: KRW },
    { v: 1, s: S.totalR, z: PCTZ },
    { v: '', s: S.totalR },
    { v: '', s: S.totalR },
  ]);

  const ws1 = makeSheet(R, [22, 16, 9, 22, 4], merges);
  ws1['!rows'] = [{ hpt: 26 }, { hpt: 16 }];
  XLSX.utils.book_append_sheet(wb, ws1, '가계부');

  /* ── 시트2: 거래내역 ── */
  const heads = ['일자', '가맹점', '금액(net)', '분류', '카테고리', '취소', '할부'];
  const T: XCell[][] = [];
  T.push([{ v: `${imp.periodLabel} 거래내역`, s: S.title }, ...pad(6)]);
  T.push(heads.map((h) => ({ v: h, s: S.th })));
  imp.items.forEach((it, i) => {
    const z = i % 2 === 1;
    const shared = isShared(it.assign);
    const whoName = it.excluded ? '제외' : shared ? '공용' : nameOf(memberOf(it.assign) ?? '');
    const whoColor = it.excluded ? XC.faint : shared ? XC.ink : XC.sub;
    T.push([
      { v: it.date, s: td(z, { font: { name: XFONT, sz: 10, color: { rgb: XC.sub } } }) },
      { v: it.merchant, s: td(z) },
      { v: it.net, s: td(z, { alignment: { vertical: 'center', horizontal: 'right' }, font: { name: XFONT, sz: 10, bold: true, color: { rgb: XC.ink } } }), z: KRWNEG },
      { v: whoName, s: td(z, { font: { name: XFONT, sz: 10, bold: true, color: { rgb: whoColor } }, alignment: { vertical: 'center', horizontal: 'center' } }) },
      { v: it.category ?? '', s: td(z, { font: { name: XFONT, sz: 10, color: { rgb: XC.sub } } }) },
      { v: it.cancel === 'none' ? '' : it.cancel, s: td(z, { alignment: { vertical: 'center', horizontal: 'center' } }) },
      { v: it.installment ? `${it.installmentMonths}개월` : '', s: td(z, { alignment: { vertical: 'center', horizontal: 'center' } }) },
    ]);
  });
  // 합계 행
  const sumRow = T.length;
  T.push([
    { v: `합계 (${txCount}건)`, s: S.totalL },
    { v: '', s: S.totalL },
    { v: active.reduce((a, it) => a + it.net, 0), s: S.totalR, z: KRWNEG },
    { v: '', s: S.totalR },
    { v: '', s: S.totalR },
    { v: '', s: S.totalR },
    { v: '', s: S.totalR },
  ]);
  const ws2 = makeSheet(T, [13, 32, 14, 9, 15, 8, 9], [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: sumRow, c: 0 }, e: { r: sumRow, c: 1 } },
  ]);
  ws2['!rows'] = [{ hpt: 24 }, { hpt: 20 }];
  ws2['!autofilter'] = { ref: `A2:G${T.length - 1}` };
  XLSX.utils.book_append_sheet(wb, ws2, '거래내역');

  XLSX.writeFile(wb, `${fileBase(imp.periodLabel)}.xlsx`);
}

/* ─────────────────────────  PDF (인쇄뷰)  ───────────────────────── */

const esc = (x: string): string =>
  x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

const wonCompact = (n: number): string => {
  if (Math.abs(n) >= 10000) {
    const man = n / 10000;
    return `${man % 1 === 0 ? man : man.toFixed(1)}만`;
  }
  return won(n);
};

/** PDF — 새 창에 깔끔한 정산 리포트를 그려 인쇄(사용자가 "PDF로 저장"). */
export function exportPDF(imp: ImportResult, members: Member[], s: SettlementResult): boolean {
  const nameOf = nameMap(members);
  const active = imp.items.filter((it) => !it.excluded);
  const txCount = active.length;
  const avgTx = txCount ? Math.round(s.cardTotalNet / txCount) : 0;
  const installCount = active.filter((it) => it.installment).length;
  const personalTotal = Object.values(s.perMemberPersonal).reduce((a, b) => a + b, 0);
  const biggest = active.reduce<(typeof active)[number] | null>(
    (mx, it) => (!mx || it.net > mx.net ? it : mx),
    null,
  );
  const top = s.byCategoryShared[0];

  // ── 정산 결과(누가 누구에게) — 색 최소, 큰 숫자 중심 ──
  const resultHtml = s.solo
    ? `<div class="result"><div class="r-cap">이번 달 공용 합계</div><div class="r-amt">${won(s.sharedTotal)}</div></div>`
    : s.owed
        .map(
          (o) => `<div class="result">
            <div class="r-flow"><b>${esc(nameOf(o.memberId))}</b><span class="ar">→</span><b>${esc(nameOf(s.payerId))}</b> 에게 보내기</div>
            <div class="r-amt">${won(o.amount)}</div>
          </div>`,
        )
        .join('');

  // ── 통계 그리드(핵심 숫자들) ──
  const stat = (cap: string, val: string, sub?: string): string =>
    `<div class="stat"><div class="s-cap">${cap}</div><div class="s-val">${val}</div>${sub ? `<div class="s-sub">${sub}</div>` : ''}</div>`;
  const statsHtml = `<div class="stats">
    ${stat('카드 총청구', won(s.cardTotalNet), `${txCount}건`)}
    ${stat('공용 합계', won(s.sharedTotal), s.cardTotalNet ? `${Math.round((s.sharedTotal / s.cardTotalNet) * 100)}%` : '')}
    ${stat('개인 합계', won(personalTotal), s.cardTotalNet ? `${Math.round((personalTotal / s.cardTotalNet) * 100)}%` : '')}
    ${stat('평균 거래액', won(avgTx))}
    ${stat('할부', `${installCount}건`)}
    ${stat('최다 카테고리', top ? esc(top.category) : '—', top ? wonCompact(top.amount) : '')}
  </div>`;

  // ── 멤버별 분담(공용 분담 + 개인 = 보낼 금액) ──
  const owedByMember = new Map(s.owed.map((o) => [o.memberId, o]));
  const totalW = members.reduce((a, m) => a + (m.weight || 1), 0) || 1;
  const memberHtml =
    s.solo || members.length < 2
      ? ''
      : `<section><h2>멤버별 분담</h2><table class="tbl">
        <thead><tr><th>멤버</th><th class="r">공용 분담</th><th class="r">개인</th><th class="r">합계</th></tr></thead>
        <tbody>${members
          .map((m) => {
            const o = owedByMember.get(m.id);
            const personal = s.perMemberPersonal[m.id] ?? 0;
            const shared = o ? o.sharedShare : Math.round(s.sharedTotal * (m.weight || 1) / totalW);
            const isPayer = m.id === s.payerId;
            const total = o ? o.amount : shared + personal;
            return `<tr>
              <td>${esc(m.name)}${isPayer ? '<span class="pill">결제자</span>' : ''}</td>
              <td class="r num">${won(shared)}</td>
              <td class="r num">${won(personal)}</td>
              <td class="r num ${isPayer ? 'muted' : 'strong'}">${isPayer ? '— 선결제' : won(total)}</td>
            </tr>`;
          })
          .join('')}</tbody></table></section>`;

  // ── 공용 카테고리별(미니멀 막대 — 단색 회색) ──
  const maxCat = Math.max(1, ...s.byCategoryShared.map((c) => c.amount));
  const catHtml = s.byCategoryShared.length
    ? `<section><h2>공용 카테고리별</h2><div class="bars">${s.byCategoryShared
        .map((c) => {
          const pct = s.sharedTotal ? Math.round((c.amount / s.sharedTotal) * 100) : 0;
          return `<div class="bar-row">
            <div class="bar-name">${esc(c.category)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, (c.amount / maxCat) * 100)}%"></div></div>
            <div class="bar-amt"><b>${won(c.amount)}</b> <span class="pct">${pct}%</span></div>
          </div>`;
        })
        .join('')}</div></section>`
    : '';

  // ── 거래내역(깔끔한 표, 색 없음) ──
  const txRows = active
    .map((it) => {
      const who = isShared(it.assign) ? '공용' : nameOf(memberOf(it.assign) ?? '');
      return `<tr>
        <td class="c-date">${esc(it.date)}</td>
        <td>${esc(it.merchant)}${it.installment ? `<span class="tag">${it.installmentMonths}개월</span>` : ''}</td>
        <td class="r num">${won(it.net)}</td>
        <td class="c-who">${esc(who)}${it.category ? `<span class="cat">${esc(it.category)}</span>` : ''}</td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${esc(imp.periodLabel)} 정산 · coupledger</title>
<style>
  :root{ --accent:#4F46E5; --ink:#1a1a1a; --sub:#8b8f98; --line:#e9ebef; --soft:#f6f7f9; }
  *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @page{ margin:15mm; }
  body{ font-family:-apple-system,'Apple SD Gothic Neo','Pretendard','Malgun Gothic',sans-serif;
        color:var(--ink); margin:0; font-size:12px; line-height:1.5; }

  /* 헤더 — 워드마크 칩만 색 */
  .top{ display:flex; justify-content:space-between; align-items:flex-end; padding-bottom:12px;
        border-bottom:1.5px solid var(--ink); margin-bottom:22px; }
  .wm{ font-size:21px; font-weight:800; letter-spacing:-.5px; display:flex; align-items:center; }
  .wm .b{ color:var(--ink); }
  .wm .chipx{ display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px;
        border-radius:7px; color:#fff; font-weight:800; }
  .wm .c1{ background:var(--accent); } .wm .c2{ background:#FB7185; margin-left:-7px; }
  .top .meta{ text-align:right; }
  .top .period{ font-size:15px; font-weight:700; }
  .top .date{ color:var(--sub); font-size:10.5px; margin-top:2px; }

  /* 정산 결과 — 큰 숫자, 박스는 hairline */
  .results{ display:flex; flex-wrap:wrap; gap:12px; margin-bottom:24px; }
  .result{ flex:1; min-width:210px; border:1px solid var(--line); border-left:3px solid var(--accent);
        border-radius:10px; padding:14px 16px; }
  .r-cap,.r-flow{ font-size:12px; color:#555; margin-bottom:6px; }
  .r-flow b{ color:var(--ink); } .r-flow .ar{ color:var(--accent); font-weight:800; margin:0 6px; }
  .r-amt{ font-size:27px; font-weight:800; letter-spacing:-.6px; }

  /* 통계 그리드 */
  .stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:0; border:1px solid var(--line);
        border-radius:10px; overflow:hidden; margin-bottom:26px; }
  .stat{ padding:13px 15px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); }
  .stat:nth-child(3n){ border-right:0; } .stat:nth-child(n+4){ border-bottom:0; }
  .s-cap{ color:var(--sub); font-size:10.5px; margin-bottom:4px; }
  .s-val{ font-size:16px; font-weight:700; letter-spacing:-.3px; }
  .s-sub{ color:var(--sub); font-size:10.5px; margin-top:1px; }

  section{ margin-bottom:26px; break-inside:avoid; }
  h2{ font-size:11px; font-weight:700; color:var(--sub); margin:0 0 10px; padding-bottom:5px;
        border-bottom:1px solid var(--line); letter-spacing:.3px; }

  /* 막대 — 단색 회색(색 떡칠 X) */
  .bars{ display:flex; flex-direction:column; gap:8px; }
  .bar-row{ display:grid; grid-template-columns:110px 1fr 130px; align-items:center; gap:12px; }
  .bar-name{ font-size:11.5px; color:#444; }
  .bar-track{ height:7px; background:var(--soft); border-radius:999px; overflow:hidden; }
  .bar-fill{ height:100%; background:#9aa0aa; border-radius:999px; }
  .bar-amt{ text-align:right; font-size:11.5px; font-variant-numeric:tabular-nums; }
  .bar-amt .pct{ color:var(--sub); margin-left:5px; }

  /* 표 공통 */
  .tbl, table.tx{ width:100%; border-collapse:collapse; font-size:11.5px; }
  thead th{ text-align:left; color:var(--sub); font-weight:700; font-size:10.5px; padding:6px 9px;
        border-bottom:1.5px solid var(--ink); }
  tbody td{ padding:7px 9px; border-bottom:1px solid var(--line); vertical-align:middle; }
  .r{ text-align:right; } .num{ font-variant-numeric:tabular-nums; }
  .strong{ font-weight:700; } .muted{ color:var(--sub); }
  .pill{ display:inline-block; margin-left:6px; padding:1px 6px; border-radius:5px; background:var(--soft);
        color:#777; font-size:9.5px; font-weight:600; }
  .c-date{ color:var(--sub); white-space:nowrap; font-variant-numeric:tabular-nums; }
  .c-who{ color:#555; }
  .cat{ color:var(--sub); font-size:10.5px; margin-left:6px; }
  .tag{ display:inline-block; margin-left:6px; padding:1px 6px; border-radius:5px; background:var(--soft);
        color:#777; font-size:9.5px; font-weight:600; }
  tbody tr{ break-inside:avoid; }
  .foot{ margin-top:8px; padding-top:10px; border-top:1px solid var(--line); text-align:center;
        color:#b8bcc4; font-size:9.5px; }
</style></head><body>
  <div class="top">
    <div class="wm"><span class="b">coup</span><span class="chipx c1">l</span><span class="chipx c2">e</span><span class="b">dger</span></div>
    <div class="meta"><div class="period">${esc(imp.periodLabel)} 정산</div><div class="date">생성 ${stamp()} · ${esc(imp.periodStart)} ~ ${esc(imp.periodEnd)}</div></div>
  </div>

  <div class="results">${resultHtml}</div>
  ${statsHtml}
  ${memberHtml}
  ${catHtml}

  <section>
    <h2>거래내역 · ${txCount}건${biggest ? ` · 최대 ${won(biggest.net)} (${esc(biggest.merchant)})` : ''}</h2>
    <table class="tx"><thead><tr><th>일자</th><th>가맹점</th><th class="r">금액(net)</th><th>분류</th></tr></thead>
    <tbody>${txRows}</tbody></table>
  </section>

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
