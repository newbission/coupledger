// ===== 정산 요약 (SettlementSummary + SettlementBar) =====
// 공용 분배 가중치 슬라이더(멤버별 → updateMember weight), 멤버별 결과 카드,
// 보조 숫자(공용합계/멤버 개인/카드총청구net), 공용 카테고리별 막대,
// 저장·내보내기(CSV exportCSV+downloadFile, '이번 달 정산 저장' saveCurrentToHistory).
// 혼자(solo)면 정산 대신 지출 리포트. SettlementBar = 상단 고정 큰 결과 + 저장.
//
// ── base.css 에 없는(이 모듈이 의존하는 레이아웃용) 보조 클래스 ──
//   .settle-grid : settle-panel 2개를 나란히 두는 그리드(아래 인라인 style로 처리, 클래스 미사용)
//   나머지(.settle-bar/.settle-result/.settle-panel/.weight-*/.owed-card/.totals/
//    .bd-row/.bd-divider/.dot/.cat-bar*/.btn 등)는 모두 base.css 고정 클래스.
import type { Member, OwedLine, SettlementResult } from '../types';
import { el, won, downloadFile } from '../util';
import {
  getState,
  getSettlement,
  membersById,
  payer,
  updateMember,
  saveCurrentToHistory,
  findHistoryByPeriod,
} from '../state/store';
import { exportCSV } from '../export/csv';

// ---------- 공통 헬퍼 ----------

/** 멤버 색 var(--m1) 등 */
function memberColor(m: Member): string {
  return `var(--${m.colorVar})`;
}

/** 이름 첫 글자(아바타 라벨) */
function initial(name: string): string {
  return (name || '?').trim().charAt(0) || '?';
}

/** 작은 색 아바타 점(이름 약자). seg-av 스타일 재사용 */
function avatar(color: string, label: string, sizePx = 24): HTMLElement {
  const a = el('span', { class: 'seg-av', text: label });
  a.style.background = color;
  a.style.opacity = '1';
  a.style.width = sizePx + 'px';
  a.style.height = sizePx + 'px';
  a.style.fontSize = Math.round(sizePx * 0.42) + 'px';
  return a;
}

function weightSum(members: Member[]): number {
  const s = members.reduce((acc, m) => acc + (m.weight > 0 ? m.weight : 0), 0);
  return s > 0 ? s : members.length || 1;
}

// ---------- SettlementBar : 상단 고정 큰 결과 + 저장 ----------

export function SettlementBar(): HTMLElement {
  const s = getSettlement();
  const byId = membersById();
  const p = payer();

  const bar = el('div', { class: 'settle-bar' });

  // 큰 결과 숫자
  const result = el('div', { class: 'settle-result num' });

  if (s.solo) {
    result.append(
      el('span', { class: 'label', text: '이번 달 지출' }),
      el('span', { class: 'amt', text: won(s.cardTotalNet) }),
    );
  } else if (s.owed.length === 0 || totalOwed(s) <= 0) {
    result.append(
      el('span', { class: 'label', text: '정산할 금액 없음' }),
    );
  } else {
    // 결제자에게 줄 멤버 중 가장 큰 금액 한 줄로 강조(나머지는 패널에서).
    const top = topOwed(s);
    const who = top ? byId[top.memberId] : undefined;
    result.append(
      el('span', { class: 'label', text: '정산' }),
      el('span', { class: 'who', text: who ? who.name : '멤버' }),
      el('span', { class: 'arrow', text: '→' }),
      el('span', { text: p.name }),
      el('span', { class: 'amt', text: ' ' + won(top ? top.amount : 0) }),
    );
  }

  bar.append(result, el('span', { class: 'spacer' }));

  // 카드 총청구(net)
  bar.append(
    el('div', { class: 'bd-row', style: { fontSize: '12.5px', marginLeft: '0' } },
      el('span', { class: 'k muted', text: '카드 총청구(net)' }),
      el('span', { class: 'v num', text: ' ' + won(s.cardTotalNet), style: { marginLeft: '8px' } }),
    ),
  );

  // 저장 버튼(요약 패널의 저장 흐름과 동일)
  bar.append(
    el('button', { class: 'btn btn-primary', onClick: () => saveFlow() },
      '이번 달 정산 저장',
    ),
  );

  return bar;
}

// ---------- SettlementSummary : 상세 패널 ----------

export function SettlementSummary(): HTMLElement {
  const s = getSettlement();
  const wrap = el('section', { class: 'section' });

  wrap.append(
    el('div', { class: 'sec-head' },
      el('span', { class: 'sec-title', text: s.solo ? '지출 리포트' : '정산 요약' }),
      el('span', {
        class: 'sec-desc',
        text: s.solo
          ? '혼자 모드 — 정산 없이 지출만 정리해요'
          : '공용 분배 비중을 정하면 정산액이 바로 계산돼요',
      }),
    ),
  );

  // 2단 그리드(좌: 비중+결과, 우: 금액구성+카테고리). base.css에 그리드 클래스가 없어 인라인.
  const grid = el('div', {
    class: 'stack',
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,.95fr)',
      gap: '18px',
    },
  });

  grid.append(s.solo ? soloLeftPanel(s) : leftPanel(s));
  grid.append(rightPanel(s));

  wrap.append(grid);
  wrap.append(exportPanel(s));
  return wrap;
}

// ----- 좌측: 공용 분배 비중 + 정산 결과 (다인) -----

function leftPanel(s: SettlementResult): HTMLElement {
  const { members } = getState().config;
  const sum = weightSum(members);
  const panel = el('div', { class: 'settle-panel' });

  panel.append(
    el('h3', { text: '공용 분배 비중' }),
    el('p', { class: 'h-desc', text: '공용 지출을 멤버별로 어떻게 나눌지 정해요 · 기본은 균등' }),
  );

  for (const m of members) {
    const pct = Math.round(((m.weight > 0 ? m.weight : 0) / sum) * 100);
    const row = el('div', { class: 'weight-row' });
    row.append(
      el('span', { class: 'weight-who' },
        avatar(memberColor(m), initial(m.name)),
        el('span', { text: m.name }),
      ),
    );
    const slider = el('input', {
      type: 'range',
      class: 'weight-slider',
      min: '0',
      max: '10',
      step: '1',
      value: String(Math.max(0, Math.min(10, Math.round(m.weight)))),
      'aria-label': `${m.name} 가중치`,
      onInput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        updateMember(m.id, { weight: v });
      },
    });
    row.append(slider);
    row.append(el('span', { class: 'weight-pct num', text: pct + '%' }));
    panel.append(row);
  }

  panel.append(
    el('p', { class: 'h-desc', style: { marginTop: '4px' } },
      el('span', { class: 'tag', text: weightsEqual(members) ? '균등' : '사용자 지정' }),
      ' 멤버가 늘면 비중 슬라이더도 멤버 수만큼 늘어나요',
    ),
  );

  panel.append(el('div', { class: 'bd-divider', style: { margin: '18px 0 16px' } }));

  // 정산 결과
  const p = payer();
  panel.append(
    el('h3', { text: '정산 결과' }),
    el('p', { class: 'h-desc', text: `결제자(${p.name})가 카드값 전액을 결제하고, 나머지가 정산해요` }),
  );

  const byId = membersById();
  const list = el('div', { class: 'stack' });

  for (const line of s.owed) {
    const m = byId[line.memberId];
    if (!m) continue;
    const card = el('div', { class: 'owed-card' });
    card.append(
      el('div', { class: 'flow' },
        avatar(memberColor(m), initial(m.name), 28),
        el('span', { text: m.name }),
        el('span', { class: 'arrow', text: '→' }),
        avatar(memberColor(p), initial(p.name), 28),
        el('span', { text: p.name }),
      ),
      el('div', { class: 'pay' },
        el('div', { class: 'amt num', text: won(line.amount) }),
        el('div', { class: 'k', text: '공용 ' + won(line.sharedShare) + ' + 개인 ' + won(line.personal) }),
      ),
    );
    list.append(card);
  }

  // 결제자 카드
  const payerCard = el('div', { class: 'owed-card is-payer' });
  payerCard.append(
    el('div', { class: 'flow' },
      avatar(memberColor(p), initial(p.name), 28),
      el('span', { text: `${p.name} (결제자)` }),
    ),
    el('div', { class: 'pay' },
      el('div', { class: 'amt num', text: won(s.cardTotalNet) + ' 결제' }),
      el('div', { class: 'k', text: '카드 총청구액 전액' }),
    ),
  );
  list.append(payerCard);

  panel.append(list);
  return panel;
}

// ----- 좌측: 혼자 모드 리포트 -----

function soloLeftPanel(s: SettlementResult): HTMLElement {
  const panel = el('div', { class: 'settle-panel' });
  const p = payer();
  panel.append(
    el('h3', { text: '이번 달 지출' }),
    el('p', { class: 'h-desc', text: '혼자 쓰는 가계부 — 취소 반영(net) 기준 총지출' }),
  );

  const card = el('div', { class: 'owed-card' });
  card.append(
    el('div', { class: 'flow' },
      avatar(memberColor(p), initial(p.name), 28),
      el('span', { text: p.name }),
    ),
    el('div', { class: 'pay' },
      el('div', { class: 'amt num', text: won(s.cardTotalNet) }),
      el('div', { class: 'k', text: '총 지출(net)' }),
    ),
  );
  panel.append(card);
  return panel;
}

// ----- 우측: 금액 구성 + 카테고리별 막대 -----

function rightPanel(s: SettlementResult): HTMLElement {
  const panel = el('div', { class: 'settle-panel' });
  const byId = membersById();
  const { members } = getState().config;
  const sum = weightSum(members);
  const p = payer();

  panel.append(
    el('h3', { text: '금액 구성' }),
    el('p', { class: 'h-desc', text: '취소 반영(net) 기준' }),
  );

  const totals = el('div', { class: 'totals' });

  if (s.solo) {
    // 혼자: 카테고리 합/총지출만(공용/개인 구분 없음)
    totals.append(
      bdRow('var(--shared)', '총 지출(net)', won(s.cardTotalNet), true),
    );
  } else {
    // 공용 합계
    totals.append(bdRow('var(--shared)', '공용 합계', won(s.sharedTotal)));

    // 각 비결제자 몫(공용 분담)
    for (const line of s.owed) {
      const m = byId[line.memberId];
      if (!m) continue;
      const pct = Math.round(((m.weight > 0 ? m.weight : 0) / sum) * 100);
      const row = el('div', { class: 'bd-row', style: { paddingLeft: '17px' } },
        el('span', { class: 'k sub', text: `↳ ${m.name} 몫 (${pct}%)` }),
        el('span', { class: 'v sub num', text: won(line.sharedShare) }),
      );
      totals.append(row);
    }

    // 멤버별 개인
    for (const m of members) {
      const personal = s.perMemberPersonal[m.id] ?? 0;
      if (personal === 0) continue;
      totals.append(bdRow(memberColor(m), `${m.name} 개인`, won(personal)));
    }

    totals.append(el('div', { class: 'bd-divider' }));
    totals.append(bdRow(null, '카드 총청구 (net)', won(s.cardTotalNet), true));

    // 각 비결제자 정산액 = 공용 몫 + 개인
    for (const line of s.owed) {
      const m = byId[line.memberId];
      if (!m) continue;
      const row = el('div', { class: 'bd-row' },
        el('span', { class: 'k sub', text: `${m.name} → ${p.name} = 공용 몫 + 개인` }),
        el('span', { class: 'v num', text: won(line.amount), style: { color: memberColor(m) } }),
      );
      totals.append(row);
    }
  }

  panel.append(totals);

  // 카테고리별 막대
  panel.append(el('div', { class: 'bd-divider', style: { margin: '18px 0 16px' } }));
  panel.append(
    el('h3', { text: s.solo ? '카테고리별 합계' : '공용 카테고리별 합계' }),
    el('p', { class: 'h-desc', text: s.solo ? '지출이 어디에 쓰였는지 한눈에' : '공용 지출이 어디에 쓰였는지 한눈에' }),
  );

  const cats = s.byCategoryShared;
  if (cats.length === 0) {
    panel.append(el('p', { class: 'h-desc muted', text: '아직 분류된 공용 지출이 없어요' }));
  } else {
    const max = cats[0].amount || 1;
    const bars = el('div', { class: 'cat-bars' });
    for (const c of cats) {
      const width = Math.max(2, Math.round((c.amount / max) * 100));
      const fill = el('span', { class: 'cat-bar-fill' });
      fill.style.width = width + '%';
      bars.append(
        el('div', { class: 'cat-bar' },
          el('span', { class: 'cat-bar-name', text: c.category }),
          el('span', { class: 'cat-bar-track' }, fill),
          el('span', { class: 'cat-bar-amt num', text: won(c.amount) }),
        ),
      );
    }
    panel.append(bars);
  }

  return panel;
}

function bdRow(
  dotColor: string | null,
  label: string,
  value: string,
  total = false,
): HTMLElement {
  const k = el('span', { class: 'k' });
  if (dotColor) {
    const dot = el('span', { class: 'dot' });
    dot.style.background = dotColor;
    k.append(dot);
  }
  k.append(el('span', { text: label }));
  return el('div', { class: total ? 'bd-row total' : 'bd-row' },
    k,
    el('span', { class: 'v num', text: value }),
  );
}

// ----- 저장 & 내보내기 패널 -----

function exportPanel(s: SettlementResult): HTMLElement {
  const panel = el('div', {
    class: 'settle-panel',
    style: { marginTop: '14px' },
  });

  const row = el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '12px' } });

  row.append(
    el('button', { class: 'btn btn-primary', onClick: () => csvExport() },
      'CSV 내보내기',
    ),
    el('button', { class: 'btn btn-ghost', onClick: () => saveFlow() },
      s.solo ? '이번 달 기록 저장 (로컬)' : '이번 달 정산 저장 (로컬)',
    ),
    el('span', { class: 'spacer' }),
    el('span', { class: 'sec-desc', text: '기록은 이 브라우저에만 저장돼요' }),
  );

  panel.append(row);
  return panel;
}

// ---------- 액션 ----------

function csvExport(): void {
  const imp = getState().session.import;
  if (!imp) return;
  const members = getState().config.members;
  const s = getSettlement();
  const csv = exportCSV(imp, members, s);
  const name = `coupledger_${imp.periodLabel.replace(/\./g, '-')}.csv`;
  downloadFile(name, csv, 'text/csv;charset=utf-8');
}

function saveFlow(): void {
  const imp = getState().session.import;
  if (!imp) return;
  const existing = findHistoryByPeriod(imp.periodLabel);
  if (existing) {
    const replace = window.confirm(
      `${imp.periodLabel} 기록이 이미 있어요.\n확인 = 덮어쓰기 / 취소 = 새 기록으로 추가`,
    );
    saveCurrentToHistory(replace ? 'replace' : 'add');
  } else {
    saveCurrentToHistory('add');
  }
}

// ---------- 작은 계산 헬퍼 ----------

function totalOwed(s: SettlementResult): number {
  return s.owed.reduce((acc, o) => acc + o.amount, 0);
}

function topOwed(s: SettlementResult): OwedLine | null {
  let best: OwedLine | null = null;
  for (const o of s.owed) {
    if (!best || o.amount > best.amount) best = o;
  }
  return best;
}

function weightsEqual(members: Member[]): boolean {
  if (members.length <= 1) return true;
  const first = members[0].weight;
  return members.every((m) => m.weight === first);
}
