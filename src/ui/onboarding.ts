// ===== 온보딩 (첫 실행: 환영 + 이름 스토리 + 테마 + 멤버 설정) =====
// getState()로 현재 config를 읽고, store 액션(setConfig/setRoute/addMember/
// removeMember/updateMember/setPayer/setTheme)으로만 변경한다.
// '시작하기' → setConfig({ onboarded: true }) 후 setRoute('app').
//
// 사용 클래스: 모두 base.css 에 존재(.onboarding/.ob-hero/.ob-story/
//   .theme-swatch/.member-chip/.member-dot/.payer-badge/.member-add/
//   .btn*/.field/.lockup/.wm 등). base.css 에 없는 새 클래스는 도입하지 않음.
//   - 테마 미리보기 점은 swatch 자체에 data-theme를 걸어 각 테마의
//     var(--accent)/var(--accent2)/var(--accent2-deep)을 그대로 비추므로
//     하드코딩 색을 쓰지 않는다.
import type { ThemeId } from '../types';
import { el } from '../util';
import { iconEl, wordmarkEl } from '../brand';
import {
  addMember,
  getState,
  removeMember,
  setConfig,
  setPayer,
  setRoute,
  setTheme,
  updateMember,
} from '../state/store';

const THEMES: { id: ThemeId; label: string; desc: string }[] = [
  { id: 'warm', label: '따뜻함', desc: '크림 · 코랄' },
  { id: 'minimal', label: '미니멀', desc: '화이트 · 블루' },
  { id: 'slate', label: '슬레이트', desc: '쿨 · 인디고' },
];

/** 첫 글자(이니셜) — 아바타 점은 색만 쓰므로 칩 텍스트에만 이름 사용 */
function themeSwatch(t: { id: ThemeId; label: string; desc: string }): HTMLElement {
  const { config } = getState();
  const on = config.theme === t.id;
  // swatch 자체에 data-theme → 내부 점이 해당 테마 토큰색을 비춘다(하드코딩 색 없음).
  const sw = el(
    'button',
    {
      class: 'theme-swatch' + (on ? ' is-on' : ''),
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      'data-theme': t.id,
      onClick: () => setTheme(t.id),
    },
    el(
      'span',
      { class: 'dots' },
      el('i', { style: { background: 'var(--accent)' } }),
      el('i', { style: { background: 'var(--accent2)' } }),
      el('i', { style: { background: 'var(--accent2-deep)' } }),
    ),
    el(
      'span',
      { class: 'stack', style: { gap: '1px' } },
      el('span', { text: t.label }),
      el('span', { class: 'muted', style: { fontSize: '11px', fontWeight: '600' }, text: t.desc }),
    ),
  );
  return sw;
}

function memberRow(memberId: string): HTMLElement {
  const { config } = getState();
  const m = config.members.find((x) => x.id === memberId);
  if (!m) return el('div');
  const canRemove = config.members.length > 1;

  const nameInput = el('input', {
    type: 'text',
    value: m.name,
    'aria-label': '멤버 이름',
    style: { flex: '1 1 auto', minWidth: '0' },
    onChange: (e: Event) => {
      const v = (e.target as HTMLInputElement).value.trim();
      updateMember(m.id, { name: v || m.name });
    },
  });

  const dot = el('span', { class: 'member-dot' });
  dot.style.background = `var(--${m.colorVar})`;

  const payerBtn = m.isPayer
    ? el('span', { class: 'payer-badge', text: '결제자' })
    : el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        text: '결제자로',
        onClick: () => setPayer(m.id),
      });

  const removeBtn = el('button', {
    class: 'btn btn-ghost btn-sm',
    type: 'button',
    'aria-label': '멤버 삭제',
    text: '삭제',
    disabled: !canRemove,
    style: canRemove ? null : { opacity: '.4', cursor: 'not-allowed' },
    onClick: () => {
      if (canRemove) removeMember(m.id);
    },
  });

  return el(
    'div',
    { class: 'row', style: { gap: '10px' } },
    dot,
    nameInput,
    payerBtn,
    removeBtn,
  );
}

export function Onboarding(): HTMLElement {
  const { config } = getState();
  const solo = config.members.length <= 1;

  // ---- 환영 + 락업 ----
  const hero = el(
    'div',
    { class: 'ob-hero' },
    el('div', { class: 'center', style: { display: 'flex', justifyContent: 'center', marginBottom: '4px' } }, iconEl(54)),
    el('h1', null, '함께 쓰고, 다정하게 정산해요'),
    el(
      'p',
      null,
      '카드 이용내역을 올리면 공용·개인으로 나누고, 한 사람이 결제한 생활비를 깔끔하게 정산해 드려요.',
    ),
  );

  // ---- 이름 스토리 (coupledger = couple + ledger, le 강조) ----
  const story = el(
    'div',
    { class: 'ob-story' },
    el(
      'div',
      { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      wordmarkEl(22),
      el('span', { class: 'muted', style: { fontSize: '12px' }, text: '= couple + ledger' }),
    ),
    el(
      'div',
      null,
      '겹치는 ',
      el('b', { class: 'wm-l', text: 'l' }),
      el('b', { class: 'wm-e', text: 'e' }),
      ' 두 글자에 두 사람의 가계부라는 뜻을 담았어요.',
    ),
    el(
      'div',
      { style: { color: 'var(--accent2-deep)', fontWeight: '700' } },
      '커플을 위해 만들었지만 — 가족도, 룸메도, 혼자여도, 누구나.',
    ),
  );

  // ---- 테마 선택 ----
  const themeSection = el(
    'div',
    { class: 'field', style: { marginTop: '6px' } },
    el('label', null, '테마'),
    el(
      'div',
      { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
      ...THEMES.map(themeSwatch),
    ),
  );

  // ---- 멤버 설정 ----
  const addInput = el('input', {
    type: 'text',
    placeholder: '이름 입력 후 추가',
    'aria-label': '새 멤버 이름',
    style: { flex: '1 1 auto', minWidth: '0' },
  });
  const submitAdd = (): void => {
    const v = addInput.value.trim();
    addMember(v);
    addInput.value = '';
  };
  addInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAdd();
    }
  });

  const memberSection = el(
    'div',
    { class: 'field' },
    el(
      'div',
      { class: 'row', style: { gap: '8px' } },
      el('label', { style: { margin: '0' } }, '멤버'),
      el('span', { class: 'muted', style: { fontSize: '11.5px', fontWeight: '600' }, text: '공용 지출을 함께 나눌 사람들 · 결제자 1명' }),
    ),
    el('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } }, ...config.members.map((m) => memberRow(m.id))),
    el(
      'div',
      { class: 'row', style: { gap: '8px', marginTop: '4px' } },
      addInput,
      el(
        'button',
        { class: 'member-add', type: 'button', onClick: submitAdd },
        el('span', { style: { fontSize: '15px', lineHeight: '1' }, text: '+' }),
        '멤버',
      ),
    ),
    solo
      ? el(
          'div',
          { class: 'muted center', style: { fontSize: '12px', marginTop: '8px' } },
          '혼자면 정산 없이 지출 리포트로 보여드려요.',
        )
      : null,
  );

  // ---- 시작하기 ----
  const startBtn = el(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      style: { width: '100%', marginTop: '18px', padding: '13px 16px', fontSize: '15px' },
      onClick: () => {
        // 빈 이름 정리(혹시 모를 공백 이름 보정).
        for (const m of config.members) {
          if (!m.name.trim()) updateMember(m.id, { name: '멤버' });
        }
        setConfig({ onboarded: true });
        setRoute('app');
      },
    },
    '시작하기',
  );

  return el(
    'div',
    { class: 'onboarding' },
    hero,
    story,
    themeSection,
    memberSection,
    startBtn,
  );
}
