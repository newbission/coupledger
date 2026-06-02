// ===== coupledger 진입점 =====
// 전역 스타일 로드 → 루트 호스트에 렌더 → 상태 변경 구독으로 재렌더.
import './styles/tokens.css';
import './styles/base.css';

import { subscribe, warmGoogleAuth } from './state/store';
import { renderRoot } from './ui/app';

const host = document.getElementById('app');
if (!host) {
  throw new Error('#app 호스트 엘리먼트를 찾을 수 없습니다.');
}

function render(): void {
  renderRoot(host as HTMLElement);
}

// 상태가 바뀔 때마다 루트 재렌더.
subscribe(render);

// 최초 1회 렌더.
render();

// 연결돼 있으면 조용히 토큰 확보(팝업 없이) — 성공하면 헤더가 갱신됨.
void warmGoogleAuth();
