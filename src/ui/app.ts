// ===== 루트 렌더러 =====
// getState() 를 읽어 현재 라우트/상태에 맞는 화면을 host 에 mount 한다.
//   !config.onboarded → Onboarding
//   route === 'settings' → Settings
//   else → 메인(Header + SettlementBar(sticky) + Upload +
//          (import 있으면 TransactionList + SettlementSummary) + History)
// 매 호출마다 host 를 비우고 새로 그린다. 재렌더 전후 window.scrollY 를 보존.
//
// 사용 클래스: 모두 base.css 정의(.app/.container/.section).
//   SettlementBar(.settle-bar)는 자체 position:sticky 를 가지므로 별도 래퍼 없이 .container 안에 둔다.
//   Settings()는 자체적으로 .container 를 반환하므로 추가 래핑하지 않는다.
import { clear, el } from '../util';
import { getState } from '../state/store';
import { Onboarding } from './onboarding';
import { Settings } from './settings';
import { Header } from './header';
import { Upload } from './upload';
import { TransactionList } from './transactions';
import { SettlementBar, SettlementSummary } from './summary';
import { History } from './history';

/** 온보딩 화면(.container 로 가운데 정렬). */
function onboardingView(): HTMLElement {
  return el('div', { class: 'app' }, el('div', { class: 'container' }, Onboarding()));
}

/** 접기 상태 기억(재렌더 사이 유지). true=펼침. */
const collapseState = new Map<string, boolean>();

/** 컴포넌트 섹션(.sec-head 보유)을 접기 가능하게 감싼다(컴포넌트 수정 없이). 헤더 클릭=토글. */
function collapsible(section: HTMLElement, key: string, defaultOpen: boolean): HTMLElement {
  const head = section.querySelector(':scope > .sec-head') as HTMLElement | null;
  if (!head) return section;
  if (!collapseState.has(key)) collapseState.set(key, defaultOpen);

  // .sec-head 외 자식들을 body 로 이동 → 토글 대상.
  const body = el('div', {});
  for (const n of Array.from(section.childNodes)) {
    if (n !== head) body.append(n);
  }
  section.append(body);

  // 헤더를 토글로.
  Object.assign(head.style, {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  });
  const chev = el('span', { text: '▾' });
  Object.assign(chev.style, {
    marginLeft: 'auto',
    fontSize: '14px',
    color: 'var(--sub)',
    transition: 'transform .15s',
  });
  head.append(chev);

  const apply = () => {
    const open = collapseState.get(key)!;
    body.style.display = open ? '' : 'none';
    chev.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)';
  };
  apply();
  head.addEventListener('click', () => {
    collapseState.set(key, !collapseState.get(key));
    apply();
  });
  return section;
}

/** 메인 화면: 헤더 + 정산바(sticky) + 업로드 + 요약(접기,위) + 거래내역(아래).
 *  지난 기록: 넓은 화면이면 우측 플로팅 섬(스크롤 따라옴), 좁으면 본문 위 접기. */
function mainView(): HTMLElement {
  const hasImport = getState().session.import != null;
  const wide = window.innerWidth >= 1440;

  const container = el('div', { class: 'container' }, Header());

  // 좁은 화면: 지난 기록을 멤버 밑(상단)에 접힌 채로 — 바꾸려고 스크롤 안 해도 됨.
  if (!wide) {
    container.append(collapsible(History(), 'history', false));
  }

  container.append(SettlementBar(), Upload());

  if (hasImport) {
    container.append(collapsible(SettlementSummary(), 'summary', true));
    container.append(TransactionList());
  }

  const root = el('div', { class: 'app' }, container);
  // 넓은 화면: 지난 기록을 좌측 플로팅 섬으로(접기 없이 항상 표시, 스크롤 따라옴).
  if (wide) {
    root.append(el('div', { class: 'float-history' }, History()));
  }
  return root;
}

/** 상태에 맞는 화면을 host 에 mount. window.scrollY 보존. */
export function renderRoot(host: HTMLElement): void {
  const { config, route } = getState();
  const scrollY = window.scrollY;

  let view: HTMLElement;
  if (!config.onboarded) {
    view = onboardingView();
  } else if (route === 'settings') {
    // Settings()는 .container 를 직접 반환 → .app 래퍼만 씌운다.
    view = el('div', { class: 'app' }, Settings());
  } else {
    view = mainView();
  }

  clear(host);
  host.append(view);

  // 재렌더로 인한 스크롤 점프 방지(레이아웃 적용 후 복원).
  window.scrollTo(0, scrollY);
}
