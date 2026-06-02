// ===== Header: 상단바 + 멤버바 =====
// 상단바: 브랜드 락업(좌) + 소스 pill('삼성카드 ▾') + 조회기간 pill + 설정 톱니(→ settings)
// 멤버바: 멤버 칩들(색 점 + 결제자 배지) + '+멤버' + 멤버 1명이면 '가계부 모드' 안내
// 사용 클래스: base.css(.topbar/.topbar-left/.topbar-right/.source-pill/.pill/.gear/
//   .memberbar/.member-chip/.member-dot/.payer-badge/.member-add/.badge/.num/.muted)
import { el, toast } from '../util';
import { getState, setRoute, connectGoogle, signOut } from '../state/store';
import { lockupEl } from '../brand';

function gSheetIcon(size = 14): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>';
  return svg;
}

/** 상단바 구글 상태: 연결됨이면 폴더명 칩+드롭다운(열기/관리/로그아웃), 아니면 '구글 연결'. */
function googleControl(): HTMLElement {
  const gdrive = getState().config.gdrive;
  if (!gdrive) {
    return el(
      'button',
      {
        class: 'g-pill',
        type: 'button',
        title: '구글 시트에 자동 백업',
        onClick: async () => {
          try {
            const r = await connectGoogle();
            if (r) {
              toast(r.added + r.updated ? `연결됨 · 기록 ${r.added + r.updated}개 불러옴` : '구글 연결됨');
            }
          } catch (e) {
            toast('연결 실패: ' + (e instanceof Error ? e.message : ''), 'info');
          }
        },
      },
      gSheetIcon(13),
      el('span', { text: '구글 연결' }),
    );
  }

  const menu = el(
    'div',
    { class: 'g-menu', style: { display: 'none' } },
    el('a', { class: 'g-menu-item', href: 'https://drive.google.com/drive/folders/' + gdrive.folderId, target: '_blank' }, '시트 폴더 열기 ↗'),
    el('button', { class: 'g-menu-item', type: 'button', onClick: () => setRoute('settings') }, '연결 관리'),
    el('button', { class: 'g-menu-item is-danger', type: 'button', onClick: () => { signOut(); toast('구글에서 로그아웃했어요'); } }, '로그아웃'),
  );
  const pill = el(
    'button',
    {
      class: 'g-pill is-on',
      type: 'button',
      title: '구글 시트 자동 백업 · ' + gdrive.folderName,
      onClick: (e: Event) => {
        e.stopPropagation();
        const open = menu.style.display === 'none';
        menu.style.display = open ? 'block' : 'none';
        if (open) {
          setTimeout(() => {
            const close = (): void => {
              menu.style.display = 'none';
              document.removeEventListener('click', close);
            };
            document.addEventListener('click', close);
          }, 0);
        }
      },
    },
    el('span', { class: 'g-dot' }),
    el('span', { class: 'g-name', text: gdrive.folderName }),
    el('span', { class: 'muted', text: '▾' }),
  );
  return el('div', { class: 'g-wrap' }, pill, menu);
}

/** 소스 ID → 표시 라벨 (현재 삼성카드만 지원) */
const SOURCE_LABEL: Record<string, string> = {
  samsung: '삼성카드',
};

/** 'YYYY-MM-DD' → 'YYYY.MM.DD' (조회기간 표기) */
function dotDate(iso: string): string {
  return iso.replace(/-/g, '.');
}

export function Header(): HTMLElement {
  const { config, session } = getState();
  const imp = session.import;

  // ---------- 상단바 ----------
  const left = el('div', { class: 'topbar-left' }, lockupEl(40, 22));

  // 소스 pill: 가져온 소스 표시(현재 삼성카드만). 다른 카드/은행은 곧.
  const sourceId = imp ? imp.source : config.defaultSource;
  const sourcePill = el(
    'button',
    {
      class: 'source-pill',
      type: 'button',
      title: '가져온 소스 — 다른 카드/은행은 곧 추가됩니다',
    },
    el('span', { class: 'num', text: SOURCE_LABEL[sourceId] ?? sourceId }),
    el('span', { class: 'muted', text: '▾' }),
  );

  // 조회기간 pill: import 있으면 실제 기간, 없으면 안내.
  const periodPill = imp
    ? el(
        'span',
        { class: 'pill num' },
        `${dotDate(imp.periodStart)} ~ ${dotDate(imp.periodEnd)}`,
      )
    : el('span', { class: 'pill muted' }, '조회기간 — 파일을 올려주세요');

  // 설정 톱니.
  const gear = el(
    'button',
    {
      class: 'gear',
      type: 'button',
      title: '설정',
      'aria-label': '설정',
      onClick: () => setRoute('settings'),
    },
    gearIcon(),
  );

  const right = el('div', { class: 'topbar-right' }, periodPill, sourcePill, googleControl(), gear);

  const topbar = el('header', { class: 'topbar' }, left, right);

  // ---------- 멤버바 ----------
  const memberbar = el('div', { class: 'memberbar' });

  for (const m of config.members) {
    const dot = el('span', { class: 'member-dot' });
    dot.style.background = `var(--${m.colorVar})`;
    const chip = el(
      'span',
      { class: 'member-chip' },
      dot,
      m.name,
      m.isPayer && el('span', { class: 'payer-badge', text: '결제자' }),
    );
    memberbar.append(chip);
  }

  // +멤버 추가.
  const addBtn = el(
    'button',
    {
      class: 'member-add',
      type: 'button',
      onClick: () => setRoute('settings'),
      title: '설정에서 멤버를 추가·관리해요',
    },
    el('span', { text: '+' }),
    '멤버',
  );
  memberbar.append(addBtn);

  // 멤버 1명이면 정산 없는 가계부 모드 안내.
  if (config.members.length <= 1) {
    const hint = el(
      'span',
      { class: 'badge', style: { marginLeft: 'auto' } },
      '혼자라서 정산 없이 ',
      el('b', { text: '가계부 모드' }),
      '예요',
    );
    memberbar.append(hint);
  }

  return el('div', null, topbar, memberbar);
}

/** 설정 톱니 아이콘(SVG). */
function gearIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '19');
  svg.setAttribute('height', '19');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '3');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute(
    'd',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  );
  svg.append(circle, path);
  return svg;
}
