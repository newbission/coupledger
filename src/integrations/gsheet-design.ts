// ===== 구글 시트 서식(브랜드 팔레트 + 표지/대시보드 탭) =====
// Sheets API v4 batchUpdate 서식 요청을 만든다. 색은 0..1 float, *Style.rgbColor 사용.
// 표지 스펙은 디자인 워크플로우에서 적대적 검증 완료(두 리뷰어 PASS) 후 반영.
import { batchUpdate, getSheets, ensureTab } from './google';

/* ---------- 팔레트(공용: 표지/뷰탭) ---------- */
// 미니멀(그레이스케일) 팔레트 — 색 최소, 레이아웃/여백/계층으로 승부. indigo/coral은 워드마크에만.
export const C = {
  indigo: { red: 0.31, green: 0.275, blue: 0.898 }, // 워드마크 'l' 전용
  coral: { red: 0.984, green: 0.443, blue: 0.522 }, // 워드마크 'e' 전용
  ink: { red: 0.114, green: 0.125, blue: 0.157 }, // #1D2028 본문
  white: { red: 1, green: 1, blue: 1 },
  head: { red: 0.953, green: 0.957, blue: 0.965 }, // #F3F4F6 헤더/섹션 연회색
  headInk: { red: 0.18, green: 0.196, blue: 0.235 }, // 헤더 텍스트(짙은 회색)
  zebra: { red: 0.98, green: 0.984, blue: 0.988 }, // 아주 옅은 줄무늬
  line: { red: 0.898, green: 0.91, blue: 0.925 }, // #E5E8EB 헤어라인
  rule: { red: 0.514, green: 0.553, blue: 0.612 }, // 진한 구분선(거래표 헤더 밑)
  mute: { red: 0.612, green: 0.639, blue: 0.686 },
  gray: { red: 0.42, green: 0.447, blue: 0.502 },
  bar: { red: 0.741, green: 0.768, blue: 0.804 }, // 막대 단색 회색
  ghost: { red: 0.45, green: 0.475, blue: 0.522 }, // 부제(헤더 위 보조)
};
export const FONT = 'Arial';
export const CUR = { type: 'NUMBER', pattern: '₩#,##0' };
export const INT = { type: 'NUMBER', pattern: '#,##0' };

export type Color = { red: number; green: number; blue: number };
type Fmt = Record<string, unknown>;
type Cell = Record<string, unknown>;

export const txt = (s: string | number, fmt: Fmt): Cell => ({
  userEnteredValue: { stringValue: String(s) },
  userEnteredFormat: fmt,
});
export const num = (n: number, fmt: Fmt): Cell => ({
  userEnteredValue: { numberValue: Number(n) },
  userEnteredFormat: fmt,
});
export const fmtCell = (fmt: Fmt): Cell => ({ userEnteredFormat: fmt });
export const tf = (color: Color, opts: Fmt = {}): Fmt => ({
  foregroundColorStyle: { rgbColor: color },
  fontFamily: FONT,
  ...opts,
});

/* ---------- 표지/연간 개요 데이터 ---------- */
export interface MonthSummary {
  period: string; // '2026.05'
  savedAt: number;
  owedText: string; // '준명 → 혜령 ₩1,120,701' | '정산 없음'
  cardTotalNet: number;
  sharedTotal: number;
  itemCount: number;
}
export interface YearOverview {
  year: string;
  generatedAt: string;
  members: string[];
  months: MonthSummary[]; // 최신 달 먼저(desc)
  yearTotals: { settledSum: number; cardSum: number; sharedSum: number; txCount: number };
}

/** 멤버 색(공용=indigo, 멤버는 인덱스로 순환) — 시트/엑셀 공용 의미색. */
export const MEMBER_RGB: Color[] = [
  { red: 0.231, green: 0.51, blue: 0.965 }, // blue
  { red: 0.024, green: 0.588, blue: 0.412 }, // green
  { red: 0.851, green: 0.467, blue: 0.024 }, // amber
  { red: 0.859, green: 0.157, blue: 0.467 }, // pink
  { red: 0.486, green: 0.227, blue: 0.929 }, // violet
  { red: 0.031, green: 0.569, blue: 0.698 }, // cyan
];
const PCT = { type: 'NUMBER', pattern: '0%' };

const isDb = (t: string): boolean => /^_\d{4}-\d{2}$/.test(t);
const isView = (t: string): boolean => /^\d{4}-\d{2}$/.test(t);
function savedAtMMDD(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** 연도 파일의 첫 탭을 '📊 {year} 개요' 표지/대시보드로 꾸민다(있으면 갱신). */
export async function writeCover(spreadsheetId: string, ov: YearOverview): Promise<void> {
  const coverTitle = `📊 ${ov.year} 개요`;

  // ----- COVER_SID 결정: 기본 '시트1'/'Sheet1' → 기존 표지 → 월탭 아닌 최소 sheetId. 없으면 새 탭. -----
  const sheets = await getSheets(spreadsheetId);
  const found =
    sheets.find((s) => s.title === '시트1' || s.title === 'Sheet1') ||
    sheets.find((s) => s.title === coverTitle) ||
    sheets
      .filter((s) => !s.hidden && !isDb(s.title) && !isView(s.title))
      .sort((a, b) => a.sheetId - b.sheetId)[0];
  const sid = found ? found.sheetId : await ensureTab(spreadsheetId, coverTitle);

  const M = ov.months.length;
  const DATA_START = 8;
  const TOTAL_ROW = 8 + M;
  const FOOTER_ROW = 10 + M;
  const ROW_COUNT = FOOTER_ROW + 1;
  const COLS = 7;
  const range = (r0: number, r1: number, c0: number, c1: number): Fmt => ({
    sheetId: sid,
    startRowIndex: r0,
    endRowIndex: r1,
    startColumnIndex: c0,
    endColumnIndex: c1,
  });
  const merge = (r0: number, r1: number, c0: number, c1: number): Fmt => ({
    mergeCells: { range: range(r0, r1, c0, c1), mergeType: 'MERGE_ALL' },
  });

  const R: unknown[] = [];

  // 1a. 전체 병합 해제(재실행 시 병합 충돌 방지) — 반드시 첫 요청.
  R.push({ unmergeCells: { range: { sheetId: sid } } });
  // 1b. 이름/맨앞이동/탭색/격자숨김/그리드크기/고정행.
  R.push({
    updateSheetProperties: {
      properties: {
        sheetId: sid,
        title: coverTitle,
        index: 0,
        tabColorStyle: { rgbColor: C.rule },
        gridProperties: {
          rowCount: ROW_COUNT,
          columnCount: COLS,
          frozenRowCount: 7,
          frozenColumnCount: 0,
          hideGridlines: true,
        },
      },
      fields:
        'title,index,tabColorStyle,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount,hideGridlines)',
    },
  });
  // 1c. 전체 클리어(값+서식) → 멱등 갱신.
  R.push({ repeatCell: { range: range(0, ROW_COUNT, 0, COLS), cell: {}, fields: '*' } });
  // 1d. 열 너비.
  [28, 110, 210, 140, 140, 90, 70].forEach((px, c) =>
    R.push({
      updateDimensionProperties: {
        range: { sheetId: sid, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    }),
  );
  // 1e. 행 높이(0..7) + 데이터블록 26 + 푸터 20.
  [14, 40, 22, 10, 16, 34, 12, 30].forEach((px, r) =>
    R.push({
      updateDimensionProperties: {
        range: { sheetId: sid, dimension: 'ROWS', startIndex: r, endIndex: r + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    }),
  );
  R.push({
    updateDimensionProperties: {
      range: { sheetId: sid, dimension: 'ROWS', startIndex: DATA_START, endIndex: TOTAL_ROW + 1 },
      properties: { pixelSize: 26 },
      fields: 'pixelSize',
    },
  });
  R.push({
    updateDimensionProperties: {
      range: { sheetId: sid, dimension: 'ROWS', startIndex: FOOTER_ROW, endIndex: FOOTER_ROW + 1 },
      properties: { pixelSize: 20 },
      fields: 'pixelSize',
    },
  });
  // 1f. 마스트헤드 밴드 채움(rows 1..2). padding 유지(GROUP2 mask에서 padding 제외).
  R.push({
    repeatCell: {
      range: range(1, 3, 1, 7),
      cell: {
        userEnteredFormat: {
          backgroundColorStyle: { rgbColor: C.head },
          verticalAlignment: 'MIDDLE',
          padding: { top: 2, right: 14, bottom: 2, left: 14 },
        },
      },
      fields: 'userEnteredFormat(backgroundColorStyle,verticalAlignment,padding)',
    },
  });
  // 1g. 병합(마스트헤드는 두 병합으로: 워드마크 B2:E2 + 캡션 F2:G2).
  R.push(
    merge(1, 2, 1, 5),
    merge(1, 2, 5, 7),
    merge(2, 3, 1, 7),
    merge(4, 5, 1, 3),
    merge(4, 5, 3, 5),
    merge(4, 5, 5, 7),
    merge(5, 6, 1, 3),
    merge(5, 6, 3, 5),
    merge(5, 6, 5, 7),
    merge(FOOTER_ROW, FOOTER_ROW + 1, 1, 7),
  );
  if (M === 0) R.push(merge(DATA_START, DATA_START + 1, 1, 7));

  // ----- GROUP2: 값+서식(단일 updateCells) -----
  const rows: { values: Cell[] }[] = [];
  for (let i = 0; i < ROW_COUNT; i++) rows.push({ values: Array.from({ length: COLS }, () => ({})) });

  const wordRun = (color: Color): Fmt => ({
    foregroundColorStyle: { rgbColor: color },
    bold: true,
    fontSize: 22,
    fontFamily: FONT,
  });
  // 마스트헤드: coupledger (le=coral) + 우측 캡션
  rows[1].values[1] = {
    userEnteredValue: { stringValue: 'coupledger' },
    textFormatRuns: [
      { startIndex: 0, format: wordRun(C.ink) }, // coup
      { startIndex: 4, format: wordRun(C.indigo) }, // l
      { startIndex: 5, format: wordRun(C.coral) }, // e
      { startIndex: 6, format: wordRun(C.ink) }, // dger
    ],
    userEnteredFormat: {
      backgroundColorStyle: { rgbColor: C.head },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      textFormat: tf(C.ink, { bold: true, fontSize: 22 }),
    },
  };
  rows[1].values[5] = txt('🧾 우리 카드 정산', {
    backgroundColorStyle: { rgbColor: C.head },
    horizontalAlignment: 'RIGHT',
    verticalAlignment: 'MIDDLE',
    textFormat: tf(C.gray, { fontSize: 9 }),
  });
  rows[2].values[1] = txt(`${ov.year} 정산 개요 · 12개월 중 ${M}개월 저장됨`, {
    backgroundColorStyle: { rgbColor: C.head },
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'MIDDLE',
    textFormat: tf(C.gray, { fontSize: 11 }),
  });

  const fKlabel: Fmt = {
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'BOTTOM',
    textFormat: tf(C.gray, { fontSize: 9, bold: true }),
  };
  rows[4].values[1] = txt('올해 정산 합계', fKlabel);
  rows[4].values[3] = txt('카드 총청구', fKlabel);
  rows[4].values[5] = txt('거래', fKlabel);

  const fKnum: Fmt = {
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'TOP',
    numberFormat: CUR,
    textFormat: tf(C.ink, { fontSize: 18, bold: true }),
  };
  rows[5].values[1] = num(ov.yearTotals.settledSum, fKnum);
  rows[5].values[3] = num(ov.yearTotals.cardSum, fKnum);
  rows[5].values[5] = txt(`${ov.yearTotals.txCount}건`, {
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'TOP',
    textFormat: tf(C.ink, { fontSize: 18, bold: true }),
  });

  const fHead = (align: string): Fmt => ({
    backgroundColorStyle: { rgbColor: C.head },
    horizontalAlignment: align,
    verticalAlignment: 'MIDDLE',
    textFormat: tf(C.headInk, { bold: true, fontSize: 10 }),
  });
  rows[7].values[1] = txt('월', fHead('LEFT'));
  rows[7].values[2] = txt('정산 결과', fHead('LEFT'));
  rows[7].values[3] = txt('카드 총청구', fHead('RIGHT'));
  rows[7].values[4] = txt('공용 합계', fHead('RIGHT'));
  rows[7].values[5] = txt('건수', fHead('CENTER'));
  rows[7].values[6] = txt('저장일', fHead('CENTER'));

  const base = (bg: Color, align: string): Fmt => ({
    backgroundColorStyle: { rgbColor: bg },
    horizontalAlignment: align,
    verticalAlignment: 'MIDDLE',
    textFormat: tf(C.ink, { fontSize: 10 }),
  });
  if (M === 0) {
    rows[DATA_START].values[1] = txt('아직 저장된 달이 없어요', {
      horizontalAlignment: 'CENTER',
      verticalAlignment: 'MIDDLE',
      textFormat: tf(C.mute, { italic: true, fontSize: 10 }),
    });
  } else {
    ov.months.forEach((m, i) => {
      const r = DATA_START + i;
      const bg = i % 2 === 1 ? C.zebra : C.white;
      rows[r].values[0] = fmtCell(base(bg, 'LEFT'));
      rows[r].values[1] = txt(m.period, base(bg, 'LEFT'));
      rows[r].values[2] = txt(m.owedText, { ...base(bg, 'LEFT'), wrapStrategy: 'CLIP' });
      rows[r].values[3] = num(m.cardTotalNet, { ...base(bg, 'RIGHT'), numberFormat: CUR });
      rows[r].values[4] = num(m.sharedTotal, { ...base(bg, 'RIGHT'), numberFormat: CUR });
      rows[r].values[5] = num(m.itemCount, { ...base(bg, 'CENTER'), numberFormat: INT });
      rows[r].values[6] = txt(savedAtMMDD(m.savedAt), base(bg, 'CENTER'));
    });
    const fT = (align: string, nf?: Fmt): Fmt => ({
      backgroundColorStyle: { rgbColor: C.head },
      horizontalAlignment: align,
      verticalAlignment: 'MIDDLE',
      ...(nf ? { numberFormat: nf } : {}),
      textFormat: tf(C.headInk, { bold: true, fontSize: 10 }),
    });
    rows[TOTAL_ROW].values[0] = fmtCell(fT('LEFT'));
    rows[TOTAL_ROW].values[1] = txt('합계', fT('LEFT'));
    rows[TOTAL_ROW].values[2] = txt(`${M}개월`, fT('LEFT'));
    rows[TOTAL_ROW].values[3] = num(ov.yearTotals.cardSum, fT('RIGHT', CUR));
    rows[TOTAL_ROW].values[4] = num(ov.yearTotals.sharedSum, fT('RIGHT', CUR));
    rows[TOTAL_ROW].values[5] = num(ov.yearTotals.txCount, fT('CENTER', INT));
    rows[TOTAL_ROW].values[6] = txt('—', fT('CENTER'));
  }
  rows[FOOTER_ROW].values[1] = txt(
    `마지막 업데이트 ${ov.generatedAt} · ${ov.members.join(', ')} · 다시 푸시하면 갱신됩니다`,
    {
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      textFormat: tf(C.mute, { italic: true, fontSize: 9 }),
    },
  );

  R.push({
    updateCells: {
      start: { sheetId: sid, rowIndex: 0, columnIndex: 0 },
      rows,
      fields:
        'userEnteredValue,userEnteredFormat(backgroundColorStyle,horizontalAlignment,verticalAlignment,wrapStrategy,numberFormat,textFormat),textFormatRuns',
    },
  });

  // ----- GROUP3: 테두리(맨 끝; updateBorders는 fields 마스크 없음, style이 두께 결정) -----
  R.push({ updateBorders: { range: range(5, 6, 1, 7), bottom: { style: 'SOLID', colorStyle: { rgbColor: C.line } } } });
  R.push({ updateBorders: { range: range(7, 8, 1, 7), bottom: { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: C.rule } } } });
  if (M > 0) {
    R.push({ updateBorders: { range: range(DATA_START, TOTAL_ROW, 1, 7), innerHorizontal: { style: 'SOLID', colorStyle: { rgbColor: C.line } } } });
    R.push({
      updateBorders: {
        range: range(TOTAL_ROW, TOTAL_ROW + 1, 1, 7),
        top: { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: C.rule } },
        bottom: { style: 'SOLID', colorStyle: { rgbColor: C.line } },
      },
    });
  }

  await batchUpdate(spreadsheetId, R);
}

/* ---------- 월 뷰 탭(가계부 스타일) ---------- */
export interface MonthViewItem {
  date: string;
  merchant: string;
  category: string;
  who: string;
  whoColor: Color;
  net: number;
  installmentMonths: number;
  cancel: string;
}
export interface MonthViewData {
  vid: number; // 뷰 탭 sheetId
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  solo: boolean;
  cardTotalNet: number;
  sharedTotal: number;
  personalTotal: number;
  owed: { name: string; amount: number }[];
  payerName: string;
  categories: { name: string; amount: number; pct: number }[];
  items: MonthViewItem[];
  txCount: number;
  netSum: number;
}

/** 월 뷰 탭을 가계부 스타일로 작성: KPI · 정산 콜아웃 · 카테고리 막대 · 줄무늬 거래표. */
export async function writeMonthView(spreadsheetId: string, d: MonthViewData): Promise<void> {
  const sid = d.vid;
  const COLS = 7;
  const rows: { values: Cell[] }[] = [];
  const merges: unknown[] = [];
  const borders: unknown[] = [];
  const rng = (r0: number, r1: number, c0: number, c1: number): Fmt => ({
    sheetId: sid,
    startRowIndex: r0,
    endRowIndex: r1,
    startColumnIndex: c0,
    endColumnIndex: c1,
  });
  const mrg = (r0: number, r1: number, c0: number, c1: number): void => {
    merges.push({ mergeCells: { range: rng(r0, r1, c0, c1), mergeType: 'MERGE_ALL' } });
  };
  const row = (cells: Record<number, Cell>): number => {
    const vals: Cell[] = [];
    for (let c = 0; c < COLS; c++) vals.push(cells[c] ?? {});
    rows.push({ values: vals });
    return rows.length - 1;
  };
  const blankRow = (): void => {
    rows.push({ values: Array.from({ length: COLS }, () => ({})) });
  };

  const pad = (extra: Fmt): Fmt => ({
    verticalAlignment: 'MIDDLE',
    padding: { top: 1, right: 12, bottom: 1, left: 12 },
    ...extra,
  });
  const titleFmt = pad({ horizontalAlignment: 'LEFT', textFormat: tf(C.ink, { bold: true, fontSize: 16 }) });
  const subFmt = pad({ horizontalAlignment: 'LEFT', textFormat: tf(C.ghost, { fontSize: 10 }) });
  const sectionFmt = pad({ backgroundColorStyle: { rgbColor: C.head }, horizontalAlignment: 'LEFT', textFormat: tf(C.headInk, { bold: true, fontSize: 11 }) });
  const kLabel: Fmt = { horizontalAlignment: 'LEFT', verticalAlignment: 'BOTTOM', textFormat: tf(C.gray, { fontSize: 9, bold: true }) };
  const kVal: Fmt = { horizontalAlignment: 'LEFT', verticalAlignment: 'TOP', numberFormat: CUR, textFormat: tf(C.ink, { fontSize: 15, bold: true }) };
  const thF = (align: string): Fmt => ({
    backgroundColorStyle: { rgbColor: C.head },
    horizontalAlignment: align,
    verticalAlignment: 'MIDDLE',
    textFormat: tf(C.headInk, { bold: true, fontSize: 10 }),
  });
  const cF = (bg: Color, align: string, color: Color = C.ink, extra: Fmt = {}): Fmt => ({
    backgroundColorStyle: { rgbColor: bg },
    horizontalAlignment: align,
    verticalAlignment: 'MIDDLE',
    textFormat: tf(color, { fontSize: 10 }),
    ...extra,
  });

  // 제목 / 부제
  mrg(0, 1, 1, 7);
  row({ 1: txt(`🧾 ${d.periodLabel} 가계부`, titleFmt) });
  mrg(1, 2, 1, 7);
  const sub = `${d.periodStart}${d.periodStart ? ' ~ ' : ''}${d.periodEnd} · 최종 수정 ${d.generatedAt}`;
  row({ 1: txt(sub, subFmt) });
  blankRow();

  // KPI 3장
  mrg(3, 4, 1, 3); mrg(3, 4, 3, 5); mrg(3, 4, 5, 7);
  row({ 1: txt('카드 총청구', kLabel), 3: txt(d.solo ? '총 지출' : '공용 합계', kLabel), 5: txt(d.solo ? '거래 건수' : '개인 합계', kLabel) });
  mrg(4, 5, 1, 3); mrg(4, 5, 3, 5); mrg(4, 5, 5, 7);
  row({
    1: num(d.cardTotalNet, kVal),
    3: num(d.solo ? d.cardTotalNet : d.sharedTotal, kVal),
    5: d.solo
      ? txt(`${d.txCount}건`, { horizontalAlignment: 'LEFT', verticalAlignment: 'TOP', textFormat: tf(C.ink, { fontSize: 15, bold: true }) })
      : num(d.personalTotal, kVal),
  });
  borders.push({ updateBorders: { range: rng(4, 5, 1, 7), bottom: { style: 'SOLID', colorStyle: { rgbColor: C.line } } } });
  blankRow();

  // 정산 콜아웃(다인)
  if (!d.solo) {
    mrg(rows.length, rows.length + 1, 1, 7);
    row({ 1: txt('🤝 정산 결과', sectionFmt) });
    if (!d.owed.length) {
      mrg(rows.length, rows.length + 1, 1, 7);
      row({ 1: txt('정산할 금액이 없어요 ✅', cF(C.head, 'LEFT', C.headInk, { textFormat: tf(C.headInk, { fontSize: 11, bold: true }) })) });
    } else {
      for (const o of d.owed) {
        const r = rows.length;
        mrg(r, r + 1, 1, 5);
        mrg(r, r + 1, 5, 7);
        row({
          1: txt(`${o.name} → ${d.payerName} 보내기`, cF(C.head, 'LEFT', C.ink, { textFormat: tf(C.ink, { fontSize: 11, bold: true }) })),
          5: num(o.amount, cF(C.head, 'RIGHT', C.headInk, { numberFormat: CUR, textFormat: tf(C.headInk, { fontSize: 13, bold: true }) })),
        });
      }
    }
    blankRow();
  }

  // 카테고리
  mrg(rows.length, rows.length + 1, 1, 7);
  row({ 1: txt(d.solo ? '🏷️ 카테고리별 지출' : '🏷️ 공용 카테고리별 지출', sectionFmt) });
  mrg(rows.length, rows.length + 1, 4, 7);
  const catHdr = row({ 1: txt('카테고리', thF('LEFT')), 2: txt('금액', thF('RIGHT')), 3: txt('비중', thF('CENTER')), 4: txt('분포', thF('LEFT')) });
  if (!d.categories.length) {
    mrg(rows.length, rows.length + 1, 1, 7);
    row({ 1: txt('분류된 지출이 없어요', cF(C.white, 'LEFT', C.mute, { textFormat: tf(C.mute, { italic: true, fontSize: 10 }) })) });
  } else {
    d.categories.forEach((c, i) => {
      const bg = i % 2 ? C.zebra : C.white;
      const r = rows.length;
      mrg(r, r + 1, 4, 7);
      row({
        1: txt(c.name, cF(bg, 'LEFT')),
        2: num(c.amount, cF(bg, 'RIGHT', C.ink, { numberFormat: CUR })),
        3: num(c.pct, cF(bg, 'CENTER', C.gray, { numberFormat: PCT })),
        4: txt('█'.repeat(Math.max(1, Math.round(c.pct * 18))), cF(bg, 'LEFT', C.bar)),
      });
    });
    const r = rows.length;
    mrg(r, r + 1, 4, 7);
    row({
      1: txt('합계', cF(C.head, 'LEFT', C.headInk, { textFormat: tf(C.headInk, { bold: true, fontSize: 10 }) })),
      2: num(d.sharedTotal, cF(C.head, 'RIGHT', C.headInk, { numberFormat: CUR, textFormat: tf(C.headInk, { bold: true, fontSize: 10 }) })),
      3: num(1, cF(C.head, 'CENTER', C.headInk, { numberFormat: PCT, textFormat: tf(C.headInk, { bold: true, fontSize: 10 }) })),
      4: fmtCell(cF(C.head, 'LEFT')),
    });
    borders.push({ updateBorders: { range: rng(catHdr + 1, r, 1, 7), innerHorizontal: { style: 'SOLID', colorStyle: { rgbColor: C.line } } } });
  }
  blankRow();

  // 거래내역
  mrg(rows.length, rows.length + 1, 1, 7);
  row({ 1: txt(`🧾 거래 내역 · ${d.txCount}건`, sectionFmt) });
  const ledHdr = row({
    1: txt('일자', thF('LEFT')),
    2: txt('가맹점', thF('LEFT')),
    3: txt('카테고리', thF('LEFT')),
    4: txt('분류', thF('CENTER')),
    5: txt('금액', thF('RIGHT')),
    6: txt('비고', thF('CENTER')),
  });
  d.items.forEach((it, i) => {
    const bg = i % 2 ? C.zebra : C.white;
    const amtColor = it.net < 0 ? C.coral : C.ink;
    const note = it.installmentMonths ? `${it.installmentMonths}개월` : it.cancel && it.cancel !== 'none' ? '취소' : '';
    row({
      1: txt(it.date, cF(bg, 'LEFT', C.gray)),
      2: txt(it.merchant, cF(bg, 'LEFT')),
      3: txt(it.category, cF(bg, 'LEFT', C.gray)),
      4: txt(it.who, cF(bg, 'CENTER', it.whoColor, { textFormat: tf(it.whoColor, { bold: true, fontSize: 10 }) })),
      5: num(it.net, cF(bg, 'RIGHT', amtColor, { numberFormat: CUR, textFormat: tf(amtColor, { bold: true, fontSize: 10 }) })),
      6: txt(note, cF(bg, 'CENTER', C.mute, { textFormat: tf(C.mute, { fontSize: 9 }) })),
    });
  });
  const ledEnd = rows.length;
  mrg(ledEnd, ledEnd + 1, 1, 5);
  row({
    1: txt(`합계 (${d.txCount}건)`, cF(C.head, 'LEFT', C.headInk, { textFormat: tf(C.headInk, { bold: true, fontSize: 10 }) })),
    5: num(d.netSum, cF(C.head, 'RIGHT', C.headInk, { numberFormat: CUR, textFormat: tf(C.headInk, { bold: true, fontSize: 10 }) })),
    6: fmtCell(cF(C.head, 'LEFT')),
  });
  borders.push({ updateBorders: { range: rng(ledHdr, ledHdr + 1, 1, 7), bottom: { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: C.rule } } } });
  borders.push({ updateBorders: { range: rng(ledHdr + 1, ledEnd, 1, 7), innerHorizontal: { style: 'SOLID', colorStyle: { rgbColor: C.line } } } });
  borders.push({ updateBorders: { range: rng(ledEnd, ledEnd + 1, 1, 7), top: { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: C.rule } } } });

  const ROW_COUNT = rows.length;
  const R: unknown[] = [];
  R.push({ unmergeCells: { range: { sheetId: sid } } });
  R.push({
    updateSheetProperties: {
      properties: {
        sheetId: sid,
        tabColorStyle: { rgbColor: C.rule },
        gridProperties: { rowCount: ROW_COUNT, columnCount: COLS, frozenRowCount: 2, hideGridlines: true },
      },
      fields: 'tabColorStyle,gridProperties(rowCount,columnCount,frozenRowCount,hideGridlines)',
    },
  });
  R.push({ repeatCell: { range: rng(0, ROW_COUNT, 0, COLS), cell: {}, fields: '*' } });
  [24, 92, 210, 120, 88, 120, 70].forEach((px, c) =>
    R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }),
  );
  [[0, 36], [1, 20], [4, 34]].forEach(([r, px]) =>
    R.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }),
  );
  R.push({
    updateCells: {
      start: { sheetId: sid, rowIndex: 0, columnIndex: 0 },
      rows,
      fields: 'userEnteredValue,userEnteredFormat(backgroundColorStyle,horizontalAlignment,verticalAlignment,numberFormat,textFormat,padding),textFormatRuns',
    },
  });
  R.push(...merges, ...borders);
  await batchUpdate(spreadsheetId, R);
}
