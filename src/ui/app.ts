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

/** 메인 화면: 헤더 + 정산바(sticky) + 업로드 + (import 있으면 거래/요약) + 기록. */
function mainView(): HTMLElement {
  const hasImport = getState().session.import != null;

  const container = el(
    'div',
    { class: 'container' },
    Header(),
    SettlementBar(),
    Upload(),
  );

  if (hasImport) {
    container.append(TransactionList(), SettlementSummary());
  }

  container.append(History());

  return el('div', { class: 'app' }, container);
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
