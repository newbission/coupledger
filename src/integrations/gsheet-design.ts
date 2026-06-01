// ===== 구글 시트 서식(브랜드 팔레트 + 표지/대시보드 탭) =====
// Sheets API v4 batchUpdate 서식 요청을 만든다. 색은 0..1 float, *Style.rgbColor 사용.
// 표지 스펙은 디자인 워크플로우에서 적대적 검증 완료(두 리뷰어 PASS) 후 반영.
import { batchUpdate, getSheets, ensureTab } from './google';

/* ---------- 팔레트(공용: 표지/뷰탭) ---------- */
export const C = {
  indigo: { red: 0.31, green: 0.275, blue: 0.898 }, // #4F46E5
  indigoLite: { red: 0.953, green: 0.953, blue: 0.984 }, // #F3F3FB
  coral: { red: 0.984, green: 0.443, blue: 0.522 }, // #FB7185
  ink: { red: 0.102, green: 0.102, blue: 0.102 }, // #1A1A1A
  white: { red: 1, green: 1, blue: 1 },
  ghost: { red: 0.867, green: 0.878, blue: 0.961 }, // #DDE0F5
  zebra: { red: 0.957, green: 0.961, blue: 0.984 }, // #F4F5FB
  line: { red: 0.914, green: 0.922, blue: 0.937 }, // #E9EBEF
  mute: { red: 0.612, green: 0.639, blue: 0.686 },
  gray: { red: 0.42, green: 0.447, blue: 0.502 },
};
export const FONT = 'Arial';
export const CUR = { type: 'NUMBER', pattern: '₩#,##0' };
export const INT = { type: 'NUMBER', pattern: '#,##0' };

type Color = { red: number; green: number; blue: number };
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
        tabColorStyle: { rgbColor: C.indigo },
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
          backgroundColorStyle: { rgbColor: C.indigo },
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
      { startIndex: 0, format: wordRun(C.white) },
      { startIndex: 4, format: wordRun(C.coral) },
      { startIndex: 6, format: wordRun(C.white) },
    ],
    userEnteredFormat: {
      backgroundColorStyle: { rgbColor: C.indigo },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      textFormat: tf(C.white, { bold: true, fontSize: 22 }),
    },
  };
  rows[1].values[5] = txt('🧾 우리 카드 정산', {
    backgroundColorStyle: { rgbColor: C.indigo },
    horizontalAlignment: 'RIGHT',
    verticalAlignment: 'MIDDLE',
    textFormat: tf(C.white, { fontSize: 9 }),
  });
  rows[2].values[1] = txt(`${ov.year} 정산 개요 · 12개월 중 ${M}개월 저장됨`, {
    backgroundColorStyle: { rgbColor: C.indigo },
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'MIDDLE',
    textFormat: tf(C.ghost, { fontSize: 11 }),
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
    textFormat: tf(C.indigo, { fontSize: 18, bold: true }),
  };
  rows[5].values[1] = num(ov.yearTotals.settledSum, fKnum);
  rows[5].values[3] = num(ov.yearTotals.cardSum, fKnum);
  rows[5].values[5] = txt(`${ov.yearTotals.txCount}건`, {
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'TOP',
    textFormat: tf(C.ink, { fontSize: 18, bold: true }),
  });

  const fHead = (align: string): Fmt => ({
    backgroundColorStyle: { rgbColor: C.indigo },
    horizontalAlignment: align,
    verticalAlignment: 'MIDDLE',
    textFormat: tf(C.white, { bold: true, fontSize: 10 }),
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
      backgroundColorStyle: { rgbColor: C.indigoLite },
      horizontalAlignment: align,
      verticalAlignment: 'MIDDLE',
      ...(nf ? { numberFormat: nf } : {}),
      textFormat: tf(C.indigo, { bold: true, fontSize: 10 }),
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
  R.push({ updateBorders: { range: range(7, 8, 1, 7), bottom: { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: C.indigo } } } });
  if (M > 0) {
    R.push({ updateBorders: { range: range(DATA_START, TOTAL_ROW, 1, 7), innerHorizontal: { style: 'SOLID', colorStyle: { rgbColor: C.line } } } });
    R.push({
      updateBorders: {
        range: range(TOTAL_ROW, TOTAL_ROW + 1, 1, 7),
        top: { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: C.indigo } },
        bottom: { style: 'SOLID', colorStyle: { rgbColor: C.line } },
      },
    });
  }

  await batchUpdate(spreadsheetId, R);
}
