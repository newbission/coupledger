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
import type { SourceId, ThemeId } from '../types';
import { el, toast } from '../util';
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
  connectGoogle,
  importBackupJSON,
} from '../state/store';

const THEMES: { id: ThemeId; label: string; desc: string }[] = [
  { id: 'warm', label: '따뜻함', desc: '크림 · 코랄' },
  { id: 'minimal', label: '미니멀', desc: '화이트 · 블루' },
  { id: 'slate', label: '슬레이트', desc: '쿨 · 인디고' },
];

// 카드 선택 — 지금은 삼성카드만 지원, 나머지는 '곧'(비활성) 안내.
// id가 SourceId인 것만 선택 가능(현재 'samsung').
const CARDS: { id: SourceId | string; label: string; ready: boolean }[] = [
  { id: 'samsung', label: '삼성카드', ready: true },
  { id: 'kb', label: 'KB국민카드', ready: false },
  { id: 'hyundai', label: '현대카드', ready: false },
  { id: 'shinhan', label: '신한카드', ready: false },
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

  // 시작하기 전까지 보관하는 임시 선택값(아직 store 미반영).
  const draft: { defaultSource: SourceId } = { defaultSource: config.defaultSource };

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

  // ---- 기존 기록 불러오기 (설정 없이 외부에서 가져오기) ----
  const importStatus = el('span', { class: 'muted', style: { fontSize: '12px' } }, '');
  const fileInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
    style: { display: 'none' },
    onChange: async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        importBackupJSON(await file.text());
        setConfig({ onboarded: true });
        setRoute('app');
        toast('백업에서 멤버·기록을 불러왔어요');
      } catch (err) {
        importStatus.textContent = '가져오기 실패: ' + (err instanceof Error ? err.message : '');
      }
    },
  }) as HTMLInputElement;

  const fromGoogle = async (): Promise<void> => {
    try {
      importStatus.textContent = '구글 연결·불러오는 중…';
      const r = await connectGoogle(); // 폴더 선택 → 시트 기록 pull(+멤버 정합)
      if (!r) {
        importStatus.textContent = '연결을 취소했어요.';
        return;
      }
      setConfig({ onboarded: true });
      setRoute('app');
      toast(
        r.added + r.updated
          ? `구글에서 기록 ${r.added + r.updated}개를 불러왔어요`
          : '구글 연결됨 · 시트엔 아직 기록이 없어요',
      );
    } catch (err) {
      importStatus.textContent = '실패: ' + (err instanceof Error ? err.message : '');
    }
  };

  const importCard = el(
    'div',
    { class: 'connect-invite', style: { marginBottom: '4px' } },
    el('div', { class: 'ci-head' }, el('strong', { text: '이미 쓰던 기록이 있나요?' })),
    el('p', { class: 'ci-desc', text: '구글 시트나 백업 파일에서 멤버·기록을 그대로 불러와요. 직접 설정 안 해도 돼요.' }),
    el(
      'div',
      { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => { void fromGoogle(); } }, '구글에서 불러오기'),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => fileInput.click() }, '백업 파일(JSON)'),
      importStatus,
    ),
    fileInput,
  );

  const orDivider = el(
    'div',
    { class: 'muted center', style: { fontSize: '11.5px', fontWeight: '700', margin: '2px 0' } },
    '— 또는 직접 시작 —',
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

  // ---- 카드 선택 ----
  const cardOpts = CARDS.map((c) => {
    const on = c.ready && draft.defaultSource === c.id;
    const opt = el(
      'button',
      {
        class:
          'card-opt' + (c.ready ? (on ? ' is-on' : '') : ' is-soon'),
        type: 'button',
        disabled: !c.ready,
        'aria-pressed': on ? 'true' : 'false',
        onClick: c.ready
          ? () => {
              draft.defaultSource = c.id as SourceId;
              // 선택 상태 토글(재렌더 없이 클래스만 갱신).
              for (const node of cardOpts) {
                const isOn = node === opt;
                node.classList.toggle('is-on', isOn);
                node.setAttribute('aria-pressed', isOn ? 'true' : 'false');
              }
            }
          : undefined,
      },
      el('span', { text: c.label }),
      c.ready ? null : el('span', { class: 'muted', style: { fontSize: '10.5px', fontWeight: '700' }, text: '곧' }),
    );
    return opt;
  });

  const cardSection = el(
    'div',
    { class: 'field', style: { marginTop: '6px' } },
    el(
      'div',
      { class: 'row', style: { gap: '8px' } },
      el('label', { style: { margin: '0' } }, '카드 선택'),
      el('span', { class: 'muted', style: { fontSize: '11.5px', fontWeight: '600' }, text: '이용내역을 올릴 카드 · 더 많은 카드는 곧' }),
    ),
    el(
      'div',
      { class: 'card-select', style: { marginTop: '4px' } },
      ...cardOpts,
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
    el(
      'div',
      { class: 'muted', style: { fontSize: '12px', marginTop: '2px' } },
      '함께 쓰는 사람을 추가하세요(혼자면 그대로 두세요).',
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
        // 이름 있는 멤버만 유지. 모두 비었으면 시작을 막고 안내.
        const named = config.members.filter((m) => m.name.trim());
        if (named.length === 0) {
          toast('멤버 이름을 한 명 이상 입력하세요.', 'info');
          return;
        }
        // 이름 트림 + 결제자 보정(결제자가 빠졌으면 첫 멤버를 결제자로).
        const members = named.map((m) => ({ ...m, name: m.name.trim() }));
        if (!members.some((m) => m.isPayer)) members[0] = { ...members[0], isPayer: true };

        setConfig({
          onboarded: true,
          theme: config.theme,
          members,
          defaultSource: draft.defaultSource,
        });
        setRoute('app');
      },
    },
    '시작하기',
  );

  return el(
    'div',
    { class: 'onboarding' },
    hero,
    importCard,
    orDivider,
    story,
    cardSection,
    themeSection,
    memberSection,
    startBtn,
  );
}
