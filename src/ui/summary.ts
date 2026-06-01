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
import type { HistoryEntry, Member, OwedLine, SettlementResult } from '../types';
import { el, won, toast } from '../util';
import {
  getState,
  getSettlement,
  membersById,
  payer,
  updateMember,
  saveCurrentToHistory,
  findHistoryByPeriod,
  syncEntry,
  isSyncing,
  connectGoogle,
  setRoute,
} from '../state/store';
import { exportBar } from './exportbar';

// 작은 stroke 아이콘(현재색 상속).
function ico(d: string, size = 14): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = d;
  return svg;
}
const ICON = {
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  cloudOff: '<path d="M2 2l20 20M5.8 5.8A6 6 0 0 0 8 17h9a4 4 0 0 0 1.8-7.6"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  open: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  spin: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
};

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

  // 카드 총청구(취소 반영) — 결과 옆 보조 지표
  bar.append(
    el('div', { class: 'settle-bar-metric' },
      el('span', { class: 'k', text: '카드 총청구' }),
      el('span', { class: 'v num', text: won(s.cardTotalNet) }),
    ),
  );

  // 저장 상태 칩(저장됨/동기화/미저장)
  const imp = getState().session.import;
  if (imp) bar.append(statusChip(findHistoryByPeriod(imp.periodLabel)));

  return bar;
}

/** 상단 바의 작은 저장/동기화 상태 칩. */
function statusChip(entry: HistoryEntry | null): HTMLElement {
  if (!entry) return el('span', { class: 'sync-chip is-none' }, '미저장');
  if (isSyncing(entry.id)) return el('span', { class: 'sync-chip is-flight' }, ico(ICON.spin, 12), '동기화 중');
  if (entry.syncError) return el('span', { class: 'sync-chip is-fail' }, ico(ICON.alert, 12), '동기화 실패');
  if (entry.syncedAt) return el('span', { class: 'sync-chip is-ok' }, ico(ICON.check, 12), '시트 저장됨');
  return el('span', { class: 'sync-chip is-saved' }, ico(ICON.check, 12), '저장됨');
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
  const panel = el('div', { class: 'settle-panel save-panel' });
  const imp = getState().session.import;
  const members = getState().config.members;
  const gdrive = getState().config.gdrive;
  const entry = imp ? findHistoryByPeriod(imp.periodLabel) : null;

  // 연결됨: 자동 백업 칩 / 미연결: (아래 invite 카드)
  if (gdrive) {
    panel.append(
      el('div', { class: 'connect-chip' },
        ico(ICON.sheet, 14),
        el('span', { text: '구글 시트 자동 백업 · ' }),
        el('a', { href: 'https://drive.google.com/drive/folders/' + gdrive.folderId, target: '_blank', class: 'cc-folder' }, gdrive.folderName),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn btn-ghost btn-xs', onClick: () => setRoute('settings') }, '연결 관리'),
      ),
    );
  }

  // 단일 1차 액션 — 확정(저장 + 연결 시 자동 동기화)
  panel.append(
    el('button', { class: 'btn btn-primary btn-block', onClick: () => saveFlow() },
      s.solo ? '이번 달 가계부 확정' : '이번 달 정산 확정',
    ),
  );

  // 저장/동기화 상태 줄
  panel.append(statusLine(entry, !!gdrive));

  // 미연결: 연결 유도 카드
  if (!gdrive) panel.append(connectInvite());

  // 파일 내보내기 (Excel · CSV · PDF)
  if (imp) {
    panel.append(el('div', { class: 'export-row' }, exportBar(imp, members, s)));
  }
  return panel;
}

/** 버튼 아래 한 줄 상태(동기화 중/저장됨+열기/로컬전용/실패+재시도). */
function statusLine(entry: HistoryEntry | null, connected: boolean): HTMLElement {
  const line = el('div', { class: 'status-line' });
  if (!entry) {
    line.classList.add('is-hint');
    line.append('확정하면 이번 달 정산이 기록돼요');
    return line;
  }
  if (isSyncing(entry.id)) {
    line.classList.add('is-flight');
    line.append(ico(ICON.spin, 13), '구글 시트에 동기화 중…');
    return line;
  }
  if (entry.syncError) {
    line.classList.add('is-fail');
    line.append(
      ico(ICON.alert, 13),
      '시트 동기화 실패',
      el('button', { class: 'btn btn-ghost btn-xs', onClick: () => { void syncEntry(entry.id); } }, '다시 시도'),
    );
    return line;
  }
  if (entry.syncedAt && entry.sheetUrl) {
    line.classList.add('is-ok');
    line.append(
      ico(ICON.check, 13),
      '구글 시트에 저장됨',
      el('a', { href: entry.sheetUrl, target: '_blank', class: 'sl-open' }, '시트 열기', ico(ICON.open, 11)),
    );
    return line;
  }
  if (!connected) {
    line.classList.add('is-local');
    line.append(ico(ICON.cloudOff, 13), '이 브라우저에 저장됨 · 구글 연결 시 자동 백업');
    return line;
  }
  line.classList.add('is-ok');
  line.append(ico(ICON.check, 13), '저장됨 · 동기화 준비 중');
  return line;
}

/** 미연결 상태에서 보여주는 연결 유도 카드. */
function connectInvite(): HTMLElement {
  return el('div', { class: 'connect-invite' },
    el('div', { class: 'ci-head' }, ico(ICON.sheet, 16), el('strong', { text: '구글 시트에 자동 백업하기' })),
    el('p', { class: 'ci-desc', text: '확정한 정산이 자동으로 구글 시트에 저장돼요. 둘이 같은 폴더를 공유하면 함께 볼 수 있어요.' }),
    el('button', { class: 'btn btn-primary btn-sm', onClick: () => { void connectFlow(); } }, '구글 연결'),
  );
}

// ---------- 액션 ----------

async function connectFlow(): Promise<void> {
  try {
    const r = await connectGoogle();
    if (!r) return;
    let msg = '구글 연결됨 · ' + r.folderName;
    if (r.added + r.updated) msg += ` · 기록 ${r.added + r.updated}개 가져옴`;
    toast(msg);
    // 이번 달이 이미 저장돼 있으면 바로 동기화
    const imp = getState().session.import;
    if (imp) {
      const e = findHistoryByPeriod(imp.periodLabel);
      if (e) void syncEntry(e.id).catch(() => {});
    }
  } catch (e) {
    toast('연결 실패: ' + (e instanceof Error ? e.message : ''), 'info');
  }
}

async function saveFlow(): Promise<void> {
  const imp = getState().session.import;
  if (!imp) return;
  const s = getSettlement();
  let mode: 'add' | 'replace' = 'add';
  if (findHistoryByPeriod(imp.periodLabel)) {
    const choice = await overwriteModal(imp.periodLabel);
    if (!choice) return;
    mode = choice;
  }
  const id = saveCurrentToHistory(mode); // 즉시 로컬 저장 → 재렌더
  if (!id) return;
  toast(s.solo ? '이번 달 가계부를 확정했어요' : '이번 달 정산을 확정했어요');
  // 연결돼 있으면 백그라운드로 시트 동기화(블로킹 안 함)
  if (getState().config.gdrive) {
    syncEntry(id)
      .then(() => toast('구글 시트에도 저장했어요'))
      .catch(() => toast('정산은 저장됐고 시트 동기화만 실패했어요', 'info'));
  }
}

/** 같은 달 기록이 있을 때 인앱 선택 모달(덮어쓰기/추가/취소). */
function overwriteModal(period: string): Promise<'replace' | 'add' | null> {
  return new Promise((resolve) => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') close('replace');
      else if (e.key === 'Escape') close(null);
    };
    const close = (v: 'replace' | 'add' | null): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const overlay = el('div', {
      class: 'modal-overlay',
      onClick: (e: Event) => { if (e.target === overlay) close(null); },
    },
      el('div', { class: 'modal-card' },
        el('h3', { text: `${period} 기록이 이미 있어요` }),
        el('p', { class: 'h-desc', text: '이번 달 정산을 어떻게 저장할까요?' }),
        el('div', { class: 'modal-actions' },
          el('button', { class: 'btn btn-ghost btn-sm', onClick: () => close(null) }, '취소'),
          el('button', { class: 'btn btn-ghost btn-sm', onClick: () => close('add') }, '새 기록으로 추가'),
          el('button', { class: 'btn btn-primary btn-sm', onClick: () => close('replace') }, '덮어쓰기'),
        ),
      ),
    );
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
  });
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
