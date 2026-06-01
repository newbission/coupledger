// ===== History: 과거 정산 기록 (월별 카드) =====
// loadHistory()로 저장된 HistoryEntry 목록을 월별 카드로. 최신 1건 강조(is-current),
// 나머지는 placeholder 느낌. 비었으면 안내. 카드 클릭 시 직전(최신) 기록과 비교(간단).
//
// 대표 정산결과: settlement.owed 중 가장 큰 1건(없으면 solo → 총지출 리포트).
// 카드별로 카드총청구 / 대표 정산 / 공용·개인 비율(공용 vs 개인 비중) 표기.
//
// 사용 클래스: base.css(.section/.sec-head/.sec-title/.sec-desc/.history/.history-card/
//   .history-card.is-current/.history-card.is-placeholder/.mo/.big/.small/.num/.muted/
//   .card/.center/.badge/.tag/.row/.spacer/.btn/.btn-sm/.btn-ghost/.cat-bar-track/.cat-bar-fill)
// 모듈 고유(base.css에 없음, 인라인으로 처리): 비교 패널의 막대(.cat-bar-track 재사용),
//   trend 표시는 .badge/.tag 토큰 클래스로 대체(별도 .trend 클래스 신설 안 함).
import { el, won, comma, toast } from '../util';
import type { HistoryEntry, SettlementResult } from '../types';
import { loadHistory, deleteHistory, loadHistoryEntry } from '../state/store';

// 카드 클릭 → 비교 대상으로 펼친 항목 id(모듈 로컬, 재렌더 간 유지). null이면 닫힘.
let comparedId: string | null = null;

/** 대표 정산결과: owed 중 최대 금액 1건. 받는 사람(결제자) 이름과 함께. */
function headlineOwed(e: HistoryEntry): { fromName: string; toName: string; amount: number } | null {
  const s = e.settlement;
  if (s.solo || !s.owed.length) return null;
  let best = s.owed[0];
  for (const o of s.owed) if (o.amount > best.amount) best = o;
  const fromName = e.memberNames[best.memberId] ?? '멤버';
  const toName = e.memberNames[s.payerId] ?? '결제자';
  return { fromName, toName, amount: best.amount };
}

/** 공용 합계 vs 개인 합계(전 멤버) — 비율 막대용. */
function sharedVsPersonal(s: SettlementResult): { shared: number; personal: number } {
  const shared = s.sharedTotal;
  let personal = 0;
  for (const v of Object.values(s.perMemberPersonal)) personal += v;
  return { shared, personal };
}

/** 0~100(%) 정수. 분모 0이면 0. */
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** 'YYYY.MM' 두 라벨 비교용 정렬키(내림차순=최신우선). */
function periodKey(label: string): number {
  return Number(label.replace(/\D/g, '')); // '2026.05' → 202605
}

export function History(): HTMLElement {
  const entries = loadHistory();

  const head = el(
    'div',
    { class: 'sec-head' },
    el('div', { class: 'sec-title', text: '지난 기록' }),
    el('div', {
      class: 'sec-desc',
      text: '월별로 저장한 정산이에요 · 이 브라우저에만 남아요',
    }),
  );

  const section = el('section', { class: 'section' }, head);

  // ---------- 비어있을 때 ----------
  if (!entries.length) {
    section.append(
      el(
        'div',
        { class: 'card center', style: { padding: '34px 20px' } },
        el('div', {
          class: 'big',
          style: { fontSize: '15px', fontWeight: '800', marginBottom: '6px' },
          text: '아직 저장된 기록이 없어요',
        }),
        el('div', {
          class: 'muted',
          style: { fontSize: '12.5px' },
          text: '정산을 마치고 «이번 달 정산 저장»을 누르면 여기 쌓여요',
        }),
      ),
    );
    return section;
  }

  // 최신순 정렬(같은 기간이 여러 번 저장될 수 있으니 savedAt 보조).
  const sorted = [...entries].sort((a, b) => {
    const pk = periodKey(b.periodLabel) - periodKey(a.periodLabel);
    return pk !== 0 ? pk : b.savedAt - a.savedAt;
  });

  const latest = sorted[0];
  const grid = el('div', { class: 'history' });

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const isCurrent = i === 0;
    // 직전(더 과거) 기록과 카드총청구 비교.
    const prev = sorted[i + 1] ?? null;
    grid.append(card(e, isCurrent, prev, latest));
  }

  section.append(grid);
  return section;
}

/** 월별 카드 1장. */
function card(
  e: HistoryEntry,
  isCurrent: boolean,
  prev: HistoryEntry | null,
  latest: HistoryEntry,
): HTMLElement {
  const head = headlineOwed(e);

  // 월 라벨 + (최신이면) '이번 달' 태그.
  const mo = el(
    'div',
    { class: 'mo num' },
    e.periodLabel,
    isCurrent && el('span', { class: 'tag', style: { fontSize: '9.5px', padding: '1px 7px' }, text: '최신' }),
  );

  // 대표 정산결과(있으면) / solo면 총지출.
  const big = head
    ? el(
        'div',
        { class: 'big num' },
        `${head.fromName} → ${head.toName} ${won(head.amount)}`,
      )
    : el('div', { class: 'big num', text: `총지출 ${won(e.cardTotalNet)}` });

  // 보조: 카드총청구 · 건수.
  const small = el('div', {
    class: 'small num',
    text: `카드 총청구 ${won(e.cardTotalNet)} · ${comma(e.itemCount)}건`,
  });

  // 전월 대비 추세(카드총청구 기준).
  const trend = prev ? trendEl(e.cardTotalNet, prev.cardTotalNet) : null;

  // 자세히보기/접기 토글 라인(썸네일 하단).
  const detailToggle = el('div', {
    class: 'small muted',
    style: { marginTop: '9px', fontWeight: '700', cursor: 'pointer' },
    text: '자세히보기 ▾',
  });

  const c = el(
    'button',
    {
      class: 'history-card' + (isCurrent ? ' is-current' : ' is-placeholder'),
      type: 'button',
      style: { textAlign: 'left', display: 'block', width: '100%' },
      title: '자세히보기',
      onClick: () => {
        const expanded = toggleCompare(c, e, latest);
        detailToggle.textContent = expanded ? '접기 ▴' : '자세히보기 ▾';
      },
    },
    mo,
    big,
    small,
    trend,
    detailToggle,
  );

  // 초기 펼침 상태 복원.
  if (comparedId === e.id) {
    toggleCompare(c, e, latest);
    detailToggle.textContent = '접기 ▴';
  }

  return c;
}

/** 카드총청구 추세 배지(이번 ↔ 직전). */
function trendEl(cur: number, prev: number): HTMLElement | null {
  if (prev <= 0) return null;
  const diff = cur - prev;
  if (diff === 0) {
    return el('div', { class: 'small muted', text: '지난달과 비슷해요' });
  }
  const ratio = Math.round((Math.abs(diff) / prev) * 100);
  const down = diff < 0;
  // .badge-warn(증가=주의)·기본 badge(감소)로 색만 구분. 화살표는 텍스트.
  return el(
    'div',
    {
      class: down ? 'badge' : 'badge badge-warn',
      style: { marginTop: '7px' },
    },
    el('span', { text: down ? '▾' : '▴' }),
    `지난달 대비 ${ratio}%${down ? ' 줄었어요' : ' 늘었어요'}`,
  );
}

/** 카드 내부에 비교 패널 토글(append/remove). latest와의 카드총청구 막대 비교. */
function toggleCompare(host: HTMLElement, e: HistoryEntry, latest: HistoryEntry): boolean {
  const existing = host.querySelector('[data-compare]');
  if (existing) {
    existing.remove();
    if (comparedId === e.id) comparedId = null;
    return false;
  }
  comparedId = e.id;
  host.append(comparePanel(e, latest));
  return true;
}

/** 비교 패널: 이 기록 vs 최신 기록의 카드총청구 + 공용/개인 비율 막대. */
function comparePanel(e: HistoryEntry, latest: HistoryEntry): HTMLElement {
  const isSelf = e.id === latest.id;
  const max = Math.max(e.cardTotalNet, latest.cardTotalNet, 1);

  const panel = el('div', {
    'data-compare': '1',
    class: 'stack',
    style: {
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid var(--line)',
      gap: '10px',
    },
  });

  // 카드총청구 비교(두 막대).
  panel.append(
    compareBar(e.periodLabel, e.cardTotalNet, max, 'var(--accent2)'),
    isSelf
      ? el('div', { class: 'muted', style: { fontSize: '11.5px' }, text: '최신 기록이라 비교 대상이 자신이에요' })
      : compareBar(latest.periodLabel + ' (최신)', latest.cardTotalNet, max, 'var(--shared)'),
  );

  // 공용/개인 비율(이 기록 기준).
  const sp = sharedVsPersonal(e.settlement);
  const tot = sp.shared + sp.personal;
  const sharedPct = pct(sp.shared, tot);
  panel.append(
    el(
      'div',
      { class: 'row', style: { fontSize: '11.5px', marginTop: '2px' } },
      el('span', { class: 'muted', text: '공용 / 개인' }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'num', style: { fontWeight: '800' }, text: `${sharedPct}% / ${100 - sharedPct}%` }),
    ),
    ratioTrack(sharedPct),
    el(
      'div',
      { class: 'row', style: { fontSize: '11px', marginTop: '4px' } },
      el('span', { class: 'muted num', text: `공용 ${won(sp.shared)}` }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted num', text: `개인 ${won(sp.personal)}` }),
    ),
  );

  // 불러오기(스냅샷 복원) + 이 기록 삭제. (최신도 동일하게 허용.)
  panel.append(
    el(
      'div',
      { class: 'row', style: { marginTop: '4px' } },
      el(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onClick: (ev: Event) => {
            ev.stopPropagation();
            if (!e.snapshot) {
              toast('예전에 저장된 기록이라 불러올 수 없어요 (다시 저장하면 가능)');
              return;
            }
            loadHistoryEntry(e.id);
            toast(`「${e.periodLabel}」 불러왔어요`);
          },
        },
        '불러오기',
      ),
      el('span', { class: 'spacer' }),
      el(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onClick: (ev: Event) => {
            ev.stopPropagation();
            if (window.confirm(`${e.periodLabel} 기록을 삭제할까요?`)) {
              if (comparedId === e.id) comparedId = null;
              deleteHistory(e.id);
            }
          },
        },
        '이 기록 삭제',
      ),
    ),
  );

  // 패널 내부 클릭이 카드 토글로 버블링되지 않도록.
  panel.addEventListener('click', (ev) => ev.stopPropagation());
  return panel;
}

/** 라벨 + 금액 + 막대(상대 길이). */
function compareBar(label: string, amount: number, max: number, fill: string): HTMLElement {
  const w = Math.max(2, Math.round((amount / max) * 100));
  const fillEl = el('div', { class: 'cat-bar-fill' });
  fillEl.style.width = w + '%';
  fillEl.style.background = fill;
  const track = el('div', { class: 'cat-bar-track' });
  track.append(fillEl);
  return el(
    'div',
    { class: 'stack', style: { gap: '5px' } },
    el(
      'div',
      { class: 'row', style: { fontSize: '11.5px' } },
      el('span', { class: 'muted num', text: label }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'num', style: { fontWeight: '800' }, text: won(amount) }),
    ),
    track,
  );
}

/** 공용 비중(%) 단일 막대(공용=accent2, 개인=잔여 surface-2). */
function ratioTrack(sharedPct: number): HTMLElement {
  const fill = el('div', { class: 'cat-bar-fill' });
  fill.style.width = sharedPct + '%';
  const track = el('div', { class: 'cat-bar-track' });
  track.append(fill);
  return track;
}
