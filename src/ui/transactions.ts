// ===== 거래 내역 (TransactionList) =====
// getState().session.import.items 를 렌더. 필터탭(전체/공용/개인/제외) + 검색 +
// 행: 일자 / 가맹점(배지) / 카테고리 select(자동제안 흐리게) /
//     금액(net, 부분취소시 원금액 취소선+취소액) / 분류 세그먼트(공용 + 멤버칩) / 분할.
// 전체취소·제외 행은 흐림+정산 제외. 카테고리/분류 변경은 store 액션이 학습까지 처리.
//
// ── base.css 에 없는(이 모듈이 새로 쓰는) 보조 클래스 안내 ──
//   .txn-toolbar      : 필터탭 + 검색 묶음 행 (margin/flex; 인라인 스타일로 처리, 새 CSS 불필요)
//   .split-foot, .split-add, .split-balance : 분할 패널 하단(추가/합계). base.css 미정의 →
//                       기존 .split-row / .split-btn / .muted 토큰 클래스로 대체 구성하여 새 클래스 회피.
// 위 외 모든 클래스는 base.css 정의 클래스(.txn-* / .seg* / .cat-* / .badge-* / .split-* 등)를 사용.

import type { Assignment, LineItem, Member, Split } from '../types';
import { el, won, isShared, memberOf, shortDate, todayISO, toast } from '../util';
import {
  getState,
  setItemAssign,
  setItemCategory,
  setItemSplits,
  addManualItem,
  removeItem,
  toggleExcluded,
} from '../state/store';

// ---------- 모듈 상태(스토어 재렌더 사이에 유지) ----------

type Filter = 'all' | 'shared' | 'personal' | 'excluded';

let activeFilter: Filter = 'all';
let searchText = '';
/** 분할 패널이 펼쳐진 행 id 집합 */
const expanded = new Set<string>();
/** '직접 추가' 인라인 폼 펼침 여부(재렌더 사이 유지) */
let manualFormOpen = false;

// ---------- 정렬(헤더 클릭) ----------

type SortKey = 'date' | 'merchant' | 'category' | 'amount';
/** null = 원본 순서(엑셀 그대로, 보통 최신순) */
let sortKey: SortKey | null = null;
let sortDir: 'asc' | 'desc' = 'desc';

function sortItems(arr: LineItem[]): LineItem[] {
  if (!sortKey) return arr;
  const key = sortKey;
  const dir = sortDir === 'asc' ? 1 : -1;
  const val = (it: LineItem): string | number => {
    switch (key) {
      case 'date':
        return it.date;
      case 'merchant':
        return it.merchant;
      case 'category':
        return it.category ?? '￿'; // 미분류는 맨 뒤로
      case 'amount':
        return it.net;
    }
  };
  return [...arr].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    const c =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'ko');
    return c * dir;
  });
}

// ---------- 분류 판정 헬퍼 ----------

function isPersonal(it: LineItem): boolean {
  return !it.excluded && !isShared(it.assign);
}
function isSharedItem(it: LineItem): boolean {
  return !it.excluded && isShared(it.assign);
}

function matchesFilter(it: LineItem): boolean {
  switch (activeFilter) {
    case 'shared':
      return isSharedItem(it);
    case 'personal':
      return isPersonal(it);
    case 'excluded':
      return it.excluded;
    default:
      return true;
  }
}

function matchesSearch(it: LineItem): boolean {
  const q = searchText.trim().toLowerCase();
  if (!q) return true;
  return it.merchant.toLowerCase().includes(q);
}

// ---------- 작은 빌더들 ----------

/** 멤버 머리글자(아바타용) */
function initial(name: string): string {
  return name.trim().charAt(0) || '?';
}

/** lucide 류 인라인 아이콘(stroke=currentColor) */
function icon(path: string, size = 13, opts?: { fill?: boolean }): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', opts?.fill ? 'currentColor' : 'none');
  if (!opts?.fill) {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  svg.innerHTML = path;
  return svg;
}

const ICON_CHECK = "<path d='M20 6 9 17l-5-5'/>";
const ICON_WARN = "<path d='M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'/><path d='M12 9v4M12 17h.01'/>";
const ICON_SEARCH = "<circle cx='11' cy='11' r='7'/><path d='m21 21-4.3-4.3'/>";

// ---------- 카테고리 select ----------

function categorySelect(it: LineItem): HTMLElement {
  const { categories } = getState().config;
  const current = it.category;

  // 자동제안 강도: categoryAuto && 학습 흔적 없는(처음 보는) 가맹점은 '약한 제안'으로 흐리게.
  // 학습 규칙이 있으면 확신 제안. (store.suggestFor 가 채운 categoryAuto 기준)
  const suggestClass = it.categoryAuto
    ? hasRule(it.merchant)
      ? 'cat-suggest'
      : 'cat-suggest-weak'
    : '';

  const options: HTMLOptionElement[] = [];
  // 미분류(아직 카테고리 없음)면 플레이스홀더를 선택 상태로 표시.
  if (current == null) {
    options.push(el('option', { value: '', selected: true }, '미분류'));
  }
  // 현재 카테고리가 목록에 없으면(분할 등) 첫 옵션으로 보강.
  const list = current && !categories.includes(current) ? [current, ...categories] : categories;
  for (const c of list) {
    options.push(el('option', { value: c, selected: c === current }, c));
  }

  const select = el(
    'select',
    {
      class: ['cat-select', suggestClass].filter(Boolean).join(' '),
      disabled: it.excluded,
      'aria-label': '카테고리',
      onChange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        if (!v) return;
        // 사용자 확정 → auto 해제 + 학습.
        setItemCategory(it.id, v, { auto: false });
      },
    },
    ...options,
  );

  const wrap = el('div', { class: 'txn-cat' }, el('div', { class: 'cat-wrap' }, select));

  // 자동제안 플래그(확정 전에만 표시).
  if (it.categoryAuto && current) {
    if (hasRule(it.merchant)) {
      wrap.append(
        el('span', { class: 'suggest-flag ok' }, icon(ICON_CHECK, 11), '자동제안'),
      );
    } else {
      wrap.append(
        el('span', { class: 'suggest-flag' }, icon(ICON_WARN, 11), '제안 약함 · 확인'),
      );
    }
  } else if (it.category == null && !it.excluded) {
    wrap.append(
      el('span', { class: 'suggest-flag' }, icon(ICON_WARN, 11), '처음 보는 가맹점'),
    );
  }

  return wrap;
}

/** 가맹점에 학습 규칙(빈도)이 있는지 — 제안 강도 판정용 */
function hasRule(merchant: string): boolean {
  const rules = getState().config.rules;
  // store.normalizeMerchant 는 비공개이므로 느슨하게: trim 키 + 부분 일치 추정.
  const trimmed = merchant.trim().replace(/\s+/g, ' ');
  if (rules[trimmed]) return true;
  // 정규화 키가 끝 토큰을 깎으므로, 등록 키 중 가맹점 시작과 일치하는 게 있으면 규칙 존재로 간주.
  return Object.keys(rules).some((k) => k.length > 0 && trimmed.startsWith(k));
}

// ---------- 금액 셀 ----------

function amountCell(it: LineItem): HTMLElement {
  // 전체취소: net<=0 → 음수 강조.
  if (it.cancel === 'full' || it.net <= 0) {
    const neg = it.net < 0 ? it.net : -it.gross;
    return el('div', { class: 'txn-amount neg num' }, won(neg));
  }
  // 부분취소: 원금액 취소선 + net + 취소액 보조줄.
  if (it.cancel === 'partial' && it.canceledAmount < 0) {
    return el(
      'div',
      { class: 'txn-amount num' },
      el('span', { class: 'strike' }, won(it.gross)),
      el('br'),
      won(it.net),
      el('div', { class: 'net-line num' }, `취소 ${won(it.canceledAmount)} 반영`),
    );
  }
  return el('div', { class: 'txn-amount num' }, won(it.net));
}

// ---------- 분류 세그먼트(공용 + 멤버 칩) ----------

function segOption(
  label: string,
  on: boolean,
  colorVar: string,
  shared: boolean,
  onClick: () => void,
  disabled: boolean,
): HTMLElement {
  const cls = ['seg-opt'];
  if (shared) cls.push('seg-shared');
  if (on) cls.push('is-on');
  const av = el('span', { class: 'seg-av' }, label);
  if (!shared) av.style.background = `var(--${colorVar})`;
  return el(
    'button',
    {
      class: cls.join(' '),
      disabled,
      'aria-pressed': on ? 'true' : 'false',
      title: shared ? '공용' : label,
      onClick: (e: Event) => {
        e.preventDefault();
        if (!disabled) onClick();
      },
    },
    av,
  );
}

function assignSegment(it: LineItem, members: Member[]): HTMLElement {
  const disabled = it.excluded;
  const seg = el('div', { class: 'seg' });

  // 공용
  seg.append(
    segOption(
      '공',
      isShared(it.assign),
      'shared',
      true,
      () => setItemAssign(it.id, 'shared'),
      disabled,
    ),
  );

  // 각 멤버. 너무 많으면(>4) 처음 4명 + '+' 더보기로 압축.
  const MAX_INLINE = 4;
  const inline = members.length > MAX_INLINE ? members.slice(0, MAX_INLINE) : members;
  const current = memberOf(it.assign);

  for (const m of inline) {
    seg.append(
      segOption(
        initial(m.name),
        current === m.id,
        m.colorVar,
        false,
        () => setItemAssign(it.id, { member: m.id }),
        disabled,
      ),
    );
  }

  if (members.length > MAX_INLINE) {
    // 더보기: 나머지 멤버를 순환(클릭 시 다음 미표시 멤버로 지정).
    const rest = members.slice(MAX_INLINE);
    const restOn = rest.some((m) => m.id === current);
    const more = el(
      'button',
      {
        class: ['seg-opt', 'seg-more', restOn ? 'is-on' : ''].filter(Boolean).join(' '),
        disabled,
        title: '다른 멤버',
        onClick: (e: Event) => {
          e.preventDefault();
          if (disabled) return;
          // 현재가 rest 중이면 다음 rest로, 아니면 첫 rest로.
          const idx = rest.findIndex((m) => m.id === current);
          const next = rest[(idx + 1) % rest.length];
          setItemAssign(it.id, { member: next.id });
        },
      },
      restOn ? initial(rest.find((m) => m.id === current)!.name) : '+',
    );
    if (restOn) {
      const m = rest.find((mm) => mm.id === current)!;
      // 더보기 칩에도 색 힌트.
      more.style.color = `var(--${m.colorVar})`;
    }
    seg.append(more);
  }

  return seg;
}

// ---------- 분할 버튼 + 패널 ----------

function splitButton(it: LineItem): HTMLElement {
  const open = expanded.has(it.id);
  const count = it.splits ? it.splits.length : 0;
  const cls = ['split-btn'];
  if (open || count > 0) cls.push('is-on');
  return el(
    'button',
    {
      class: cls.join(' '),
      disabled: it.excluded,
      'aria-expanded': open ? 'true' : 'false',
      onClick: (e: Event) => {
        e.preventDefault();
        if (it.excluded) return;
        if (open) expanded.delete(it.id);
        else expanded.add(it.id);
        // 분할 패널을 처음 열 때 분할이 없으면 단일 라인으로 시드.
        if (!open && (!it.splits || it.splits.length === 0)) {
          setItemSplits(it.id, seedSplits(it));
        } else {
          // 토글만 반영하기 위해 강제 재렌더 트리거(상태 변경 없이): splits 재지정.
          setItemSplits(it.id, it.splits);
        }
      },
    },
    count > 0 ? `분할 ${count}` : '분할',
    el('span', { class: 'num' }, open ? ' ▴' : count > 0 ? ' ▾' : ''),
  );
}

/** 분할 초기값: 전체 net 을 현재 카테고리로 한 줄. */
function seedSplits(it: LineItem): Split[] {
  return [{ category: it.category ?? getState().config.categories[0], amount: it.net }];
}

function splitsTotal(splits: Split[]): number {
  return splits.reduce((s, x) => s + (Number.isFinite(x.amount) ? x.amount : 0), 0);
}

function splitPanel(it: LineItem): HTMLElement {
  const { categories } = getState().config;
  const splits = it.splits ?? [];

  const panel = el('div', { class: 'split-panel' });

  panel.append(
    el(
      'div',
      {
        class: 'muted',
        style: { fontSize: '11.5px', fontWeight: '800', margin: '0 0 8px' },
      },
      `${it.merchant} 한 건을 카테고리별로 나눠요`,
    ),
  );

  splits.forEach((sp, idx) => {
    const catSel = el(
      'select',
      {
        class: 'cat-select',
        'aria-label': '분할 카테고리',
        onChange: (e: Event) => {
          const next = splits.map((s, i) =>
            i === idx ? { ...s, category: (e.target as HTMLSelectElement).value } : s,
          );
          setItemSplits(it.id, next);
        },
      },
      ...(sp.category && !categories.includes(sp.category)
        ? [el('option', { value: sp.category, selected: true }, sp.category)]
        : []),
      ...categories.map((c) =>
        el('option', { value: c, selected: c === sp.category }, c),
      ),
    );

    const amtInput = el('input', {
      type: 'number',
      class: 'num',
      value: String(sp.amount),
      'aria-label': '분할 금액',
      style: {
        marginLeft: 'auto',
        width: '110px',
        textAlign: 'right',
        padding: '6px 10px',
        borderRadius: '9px',
        border: '1.5px solid var(--line)',
        background: 'var(--surface)',
        fontWeight: '800',
      },
      onChange: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        const next = splits.map((s, i) =>
          i === idx ? { ...s, amount: Number.isFinite(v) ? v : 0 } : s,
        );
        setItemSplits(it.id, next);
      },
    });

    const removeBtn = el(
      'button',
      {
        class: 'split-btn',
        title: '이 항목 삭제',
        style: { padding: '6px 9px' },
        onClick: (e: Event) => {
          e.preventDefault();
          const next = splits.filter((_, i) => i !== idx);
          setItemSplits(it.id, next.length ? next : null);
          if (next.length === 0) expanded.delete(it.id);
        },
      },
      '✕',
    );

    panel.append(
      el(
        'div',
        { class: 'split-row' },
        el('span', { class: 'grip' }, '⋮⋮'),
        catSel,
        amtInput,
        removeBtn,
      ),
    );
  });

  // 하단: 항목 추가 + 합계 검증.
  const total = splitsTotal(splits);
  const balanced = Math.round(total) === Math.round(it.net);

  const addBtn = el(
    'button',
    {
      class: 'split-btn',
      onClick: (e: Event) => {
        e.preventDefault();
        const remaining = it.net - total;
        const next: Split[] = [
          ...splits,
          { category: categories[0], amount: remaining > 0 ? remaining : 0 },
        ];
        setItemSplits(it.id, next);
      },
    },
    '＋ 항목 추가',
  );

  const balance = el(
    'span',
    {
      class: 'num',
      style: {
        marginLeft: 'auto',
        fontWeight: '800',
        fontSize: '11.5px',
        color: balanced ? 'var(--ok)' : 'var(--warn)',
      },
    },
    balanced ? `✓ 합계 ${won(total)} 일치` : `합계 ${won(total)} / ${won(it.net)}`,
  );

  panel.append(
    el(
      'div',
      { class: 'row', style: { marginTop: '2px' } },
      addBtn,
      balance,
    ),
  );

  return panel;
}

// ---------- 직접 추가 폼 ----------

/** 분류 세그먼트(공용 + 멤버) — 폼 전용. 외부 상태(value) 를 콜백으로 갱신. */
function manualAssignSegment(
  members: Member[],
  current: Assignment,
  onPick: (a: Assignment) => void,
): HTMLElement {
  const seg = el('div', { class: 'seg' });
  const opts: Array<{ node: HTMLElement; match: () => boolean }> = [];

  const sharedOpt = segOption(
    '공',
    isShared(current),
    'shared',
    true,
    () => {},
    false,
  );
  seg.append(sharedOpt);
  opts.push({ node: sharedOpt, match: () => isShared(current) });

  for (const m of members.slice(0, 4)) {
    const opt = segOption(
      initial(m.name),
      memberOf(current) === m.id,
      m.colorVar,
      false,
      () => {},
      false,
    );
    seg.append(opt);
    opts.push({ node: opt, match: () => memberOf(current) === m.id });
  }

  // 클릭은 여기서 위임 처리(세그 선택 + 즉시 on 상태 갱신).
  function refresh(): void {
    for (const o of opts) o.node.classList.toggle('is-on', o.match());
  }
  sharedOpt.addEventListener('click', (e) => {
    e.preventDefault();
    current = 'shared';
    onPick(current);
    refresh();
  });
  members.slice(0, 4).forEach((m, i) => {
    opts[i + 1].node.addEventListener('click', (e) => {
      e.preventDefault();
      current = { member: m.id };
      onPick(current);
      refresh();
    });
  });

  return seg;
}

function manualForm(members: Member[]): HTMLElement {
  const { categories } = getState().config;

  // 폼 내부 상태(제출 전까지 store 미변경).
  let pick: Assignment = 'shared';

  const dateInput = el('input', {
    type: 'date',
    class: 'manual-field',
    value: todayISO(),
    'aria-label': '일자',
  }) as HTMLInputElement;

  const merchantInput = el('input', {
    type: 'text',
    class: 'manual-field',
    placeholder: '가맹점',
    'aria-label': '가맹점',
  }) as HTMLInputElement;

  const amountInput = el('input', {
    type: 'number',
    class: 'manual-field num',
    placeholder: '금액',
    'aria-label': '금액',
  }) as HTMLInputElement;

  const catSelect = el(
    'select',
    { class: 'manual-field', 'aria-label': '카테고리' },
    el('option', { value: '', selected: true }, '미분류'),
    ...categories.map((c) => el('option', { value: c }, c)),
  ) as HTMLSelectElement;

  const seg = manualAssignSegment(members, pick, (a) => {
    pick = a;
  });

  function submit(): void {
    const date = dateInput.value || todayISO();
    const merchant = merchantInput.value.trim();
    const amount = Number(amountInput.value);
    // 빈값 검증: 가맹점 + 유효한 양수 금액 필수.
    if (!merchant || !Number.isFinite(amount) || amount <= 0) {
      toast('가맹점과 금액을 입력하세요', 'info');
      return;
    }
    // 폼 닫기/초기화 먼저 — addManualItem 의 notify() 가 곧바로 루트 재렌더하므로
    // 그 전에 플래그를 내려야 새 목록이 닫힌 폼으로 그려진다.
    manualFormOpen = false;
    addManualItem({
      date,
      merchant,
      amount,
      category: catSelect.value || null,
      assign: pick,
    });
    toast('추가됨');
  }

  const addBtn = el(
    'button',
    {
      class: 'btn btn-primary btn-sm',
      onClick: (e: Event) => {
        e.preventDefault();
        submit();
      },
    },
    '추가',
  );

  const cancelBtn = el(
    'button',
    {
      class: 'btn btn-ghost btn-sm',
      onClick: (e: Event) => {
        e.preventDefault();
        manualFormOpen = false;
        notifyRerender();
      },
    },
    '취소',
  );

  // 가맹점에서 Enter → 추가 단축.
  merchantInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });

  return el(
    'div',
    { class: 'manual-form' },
    dateInput,
    merchantInput,
    amountInput,
    catSelect,
    seg,
    addBtn,
    cancelBtn,
  );
}

/** store.notify 가 루트 재렌더를 부르지만, 취소처럼 store 변경 없는 경우 직접 트리거가 필요.
 *  여기선 TransactionList 호스트 섹션을 다시 만들 수 없으므로 setItemSplits 류가 아닌
 *  로컬 in-place 토글로 처리한다(아래 toolbar 콜백에서 직접 재구성). */
let notifyRerender: () => void = () => {};

/** 마지막 셀: 분할 버튼 + 제외/복구 토글.
 *  - 전체취소(cancel==='full')는 구조적 제외라 토글 불가(정산 제외 라벨만).
 *  - 카드 항목(엑셀)은 수동 제외/복구 가능. 직접 추가 항목은 삭제로 처리하므로 토글 제외.
 */
function lastCell(it: LineItem, excluded: boolean): HTMLElement {
  const wrap = el('div', { class: 'row', style: { gap: '6px' } });

  if (it.cancel === 'full') {
    // 전체취소: 토글 불가.
    wrap.append(
      el('span', { class: 'muted', style: { fontSize: '11px', fontWeight: '700' } }, '정산 제외'),
    );
    return wrap;
  }

  if (!excluded) {
    wrap.append(splitButton(it));
  } else {
    wrap.append(
      el('span', { class: 'muted', style: { fontSize: '11px', fontWeight: '700' } }, '정산 제외'),
    );
  }

  // 직접 추가 항목은 × 삭제로 처리하므로 제외 토글 미표시.
  if (!it.manual) {
    wrap.append(
      el(
        'button',
        {
          class: ['exclude-toggle', it.excluded ? 'is-on' : ''].filter(Boolean).join(' '),
          title: it.excluded ? '정산에 복구' : '정산에서 제외',
          'aria-pressed': it.excluded ? 'true' : 'false',
          onClick: (e: Event) => {
            e.preventDefault();
            // toggleExcluded 가 it.excluded 를 즉시 뒤집으므로 토스트 문구는 토글 전 값 기준.
            const wasExcluded = it.excluded;
            toggleExcluded(it.id);
            toast(wasExcluded ? '복구됨' : '제외됨', 'info');
          },
        },
        it.excluded ? '복구' : '제외',
      ),
    );
  }

  return wrap;
}

// ---------- 행(테이블 tr들) ----------

function rowFor(it: LineItem, members: Member[]): HTMLElement[] {
  const excluded = it.excluded || it.cancel === 'full';

  // 가맹점 셀: 이름 + 배지(직접/부분취소/전체취소/할부).
  const merchantCell = el('td', { class: 'txn-merchant' }, it.merchant);
  if (it.manual) {
    merchantCell.append(el('span', { class: 'badge badge-manual' }, '직접'));
  }
  if (it.cancel === 'partial') {
    merchantCell.append(el('span', { class: 'badge badge-cancel' }, '부분취소'));
  } else if (it.cancel === 'full') {
    merchantCell.append(el('span', { class: 'badge badge-cancel' }, '전체취소'));
  }
  if (it.installment) {
    merchantCell.append(
      el(
        'span',
        { class: 'badge badge-installment' },
        it.installmentMonths > 0 ? `할부 ${it.installmentMonths}` : '할부',
      ),
    );
  }
  // 직접 추가 항목: × 삭제 버튼.
  if (it.manual) {
    merchantCell.append(
      el(
        'button',
        {
          class: 'row-remove',
          title: '삭제',
          'aria-label': '삭제',
          onClick: (e: Event) => {
            e.preventDefault();
            removeItem(it.id);
            toast('삭제됨');
          },
        },
        '×',
      ),
    );
  }

  const tr = el(
    'tr',
    { class: ['txn-row', excluded ? 'is-excluded' : ''].filter(Boolean).join(' ') },
    el('td', { class: 'txn-date num' }, shortDate(it.date)),
    merchantCell,
    el('td', {}, excluded ? disabledCategory(it) : categorySelect(it)),
    el('td', { class: 'r' }, amountCell(it)),
    el('td', {}, excluded ? excludedSegment(members) : assignSegment(it, members)),
    el('td', {}, lastCell(it, excluded)),
  );

  const rows = [tr];

  if (!excluded && expanded.has(it.id) && it.splits && it.splits.length > 0) {
    const splitTr = el(
      'tr',
      { class: 'txn-split' },
      el('td', { colspan: '6', style: { padding: '0' } }, splitPanel(it)),
    );
    rows.push(splitTr);
  }

  return rows;
}

/** 제외 행: 비활성 카테고리 표시 */
function disabledCategory(it: LineItem): HTMLElement {
  return el(
    'div',
    { class: 'txn-cat' },
    el(
      'div',
      { class: 'cat-wrap' },
      el(
        'select',
        { class: 'cat-select', disabled: true, 'aria-label': '카테고리' },
        el('option', {}, it.category ?? '—'),
      ),
    ),
  );
}

/** 제외 행: 흐린 비활성 세그먼트 */
function excludedSegment(members: Member[]): HTMLElement {
  const seg = el('div', { class: 'seg', style: { opacity: '.5' } });
  seg.append(
    el('button', { class: 'seg-opt seg-shared', disabled: true }, el('span', { class: 'seg-av' }, '공')),
  );
  for (const m of members.slice(0, 4)) {
    const av = el('span', { class: 'seg-av' }, initial(m.name));
    av.style.background = `var(--${m.colorVar})`;
    seg.append(el('button', { class: 'seg-opt', disabled: true }, av));
  }
  return seg;
}

// ---------- export ----------

export function TransactionList(): HTMLElement {
  const { import: imp } = getState().session;
  const { members } = getState().config;

  const section = el('section', { class: 'section' });

  // 섹션 헤더.
  section.append(
    el(
      'div',
      { class: 'sec-head' },
      el('span', { class: 'sec-title' }, '거래 내역'),
      el(
        'span',
        { class: 'sec-desc' },
        '각 거래를 공용 또는 멤버 개인으로 분류하고, 카테고리를 확인하세요',
      ),
    ),
  );

  if (!imp || imp.items.length === 0) {
    // 거래가 없어도 직접 추가는 가능(엑셀 없이 가계부 시작).
    const emptyCard = el(
      'div',
      { class: 'card', style: { padding: '28px', textAlign: 'center' } },
      el('div', { class: 'muted' }, '표시할 거래가 없습니다. 이용내역 파일을 올리거나 직접 추가하세요.'),
    );

    const emptyToolWrap = el('div', { style: { marginBottom: '12px' } });
    function renderEmptyTool(): void {
      emptyToolWrap.replaceChildren();
      emptyToolWrap.append(
        el(
          'div',
          { class: 'row', style: { margin: '0 4px' } },
          el('span', { class: 'spacer' }),
          el(
            'button',
            {
              class: 'manual-add-btn',
              onClick: (e: Event) => {
                e.preventDefault();
                manualFormOpen = !manualFormOpen;
                renderEmptyTool();
              },
            },
            '＋ 직접 추가',
          ),
        ),
      );
      if (manualFormOpen) {
        notifyRerender = renderEmptyTool;
        emptyToolWrap.append(manualForm(members));
      }
    }
    renderEmptyTool();

    section.append(emptyToolWrap);
    section.append(emptyCard);
    return section;
  }

  const items = imp.items;

  // 카운트(필터 무관 전체 기준).
  const cAll = items.length;
  const cShared = items.filter(isSharedItem).length;
  const cPersonal = items.filter(isPersonal).length;
  const cExcluded = items.filter((it) => it.excluded || it.cancel === 'full').length;

  // 툴바 — 필터탭. 필터/검색은 순수 UI 상태(store 변경 없음)이므로
  // 행 목록만 in-place 로 다시 그려 입력 포커스/스크롤을 보존한다.
  const tabDefs: Array<{ label: string; count: number; value: Filter }> = [
    { label: '전체', count: cAll, value: 'all' },
    { label: '공용', count: cShared, value: 'shared' },
    { label: '개인', count: cPersonal, value: 'personal' },
    { label: '제외', count: cExcluded, value: 'excluded' },
  ];
  const tabEls: HTMLButtonElement[] = tabDefs.map((d) =>
    el(
      'button',
      {
        class: activeFilter === d.value ? 'is-on' : '',
        'aria-pressed': activeFilter === d.value ? 'true' : 'false',
        onClick: () => {
          activeFilter = d.value;
          tabDefs.forEach((td, i) => {
            const on = td.value === activeFilter;
            tabEls[i].classList.toggle('is-on', on);
            tabEls[i].setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          renderRows();
        },
      },
      `${d.label} ${d.count}`,
    ),
  );
  const tabs = el('div', { class: 'txn-tabs' }, ...tabEls);

  const searchBox = el(
    'label',
    { class: 'txn-search' },
    icon(ICON_SEARCH, 15),
    el('input', {
      type: 'search',
      placeholder: '가맹점 검색',
      value: searchText,
      'aria-label': '가맹점 검색',
      onInput: (e: Event) => {
        searchText = (e.target as HTMLInputElement).value;
        // 검색은 결과 목록만 바꾸므로 store 변경 없이 행만 다시 그린다.
        renderRows();
      },
    }),
  );

  // '직접 추가' 버튼 + 인라인 폼: store 변경 없이 토글되므로 in-place 재구성.
  const addBtn = el(
    'button',
    {
      class: 'manual-add-btn',
      onClick: (e: Event) => {
        e.preventDefault();
        manualFormOpen = !manualFormOpen;
        renderTool();
      },
    },
    '＋ 직접 추가',
  );

  const toolbar = el(
    'div',
    { class: 'row', style: { margin: '0 4px 12px', flexWrap: 'wrap' } },
    tabs,
    el('span', { class: 'spacer' }),
    addBtn,
    searchBox,
  );

  // 툴바 + 폼을 감싸는 슬롯(폼 토글 시 이 영역만 다시 그림).
  const toolWrap = el('div', {});
  function renderTool(): void {
    toolWrap.replaceChildren();
    toolWrap.append(toolbar);
    if (manualFormOpen) {
      notifyRerender = renderTool;
      toolWrap.append(manualForm(members));
    }
  }
  renderTool();
  section.append(toolWrap);

  // 테이블.
  const tbody = el('tbody');
  const theadTr = el('tr', {});
  const table = el(
    'table',
    { class: 'txn-table' },
    el('thead', {}, theadTr),
    tbody,
  );
  section.append(el('div', {}, table));

  // 정렬 가능한 헤더 셀(클릭 시 오름/내림 토글 + 화살표).
  function sortTh(
    label: string,
    key: SortKey,
    opts?: { width?: string; right?: boolean },
  ): HTMLElement {
    const active = sortKey === key;
    const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    const style: Record<string, string> = {
      cursor: 'pointer',
      userSelect: 'none',
      whiteSpace: 'nowrap',
    };
    if (opts?.width) style.width = opts.width;
    if (active) style.color = 'var(--accent-deep)';
    return el(
      'th',
      {
        class: opts?.right ? 'r' : undefined,
        style,
        title: '클릭하여 정렬',
        onClick: () => {
          if (sortKey === key) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            sortKey = key;
            sortDir = key === 'amount' || key === 'date' ? 'desc' : 'asc';
          }
          renderHead();
          renderRows();
        },
      },
      label + arrow,
    );
  }

  function renderHead(): void {
    theadTr.replaceChildren(
      sortTh('일자', 'date', { width: '64px' }),
      sortTh('가맹점', 'merchant'),
      sortTh('카테고리', 'category', { width: '170px' }),
      sortTh('금액', 'amount', { width: '120px', right: true }),
      el('th', { style: { width: '150px' } }, '분류'),
      el('th', { style: { width: '92px' } }, '분할'),
    );
  }

  // 빈 상태 안내(필터/검색 결과 0건) 슬롯.
  const empty = el(
    'div',
    {
      class: 'card center muted',
      style: { padding: '24px', marginTop: '10px', display: 'none' },
    },
    '조건에 맞는 거래가 없어요.',
  );
  section.append(empty);

  // 행 렌더(필터+검색 적용). store 변경 없이 검색 입력 때 호출 가능.
  function renderRows(): void {
    tbody.replaceChildren();
    const shown = sortItems(items.filter((it) => matchesFilter(it) && matchesSearch(it)));
    if (shown.length === 0) {
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      for (const it of shown) {
        for (const tr of rowFor(it, members)) tbody.append(tr);
      }
    }
  }

  renderHead();
  renderRows();

  return section;
}
