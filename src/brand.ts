// ===== 브랜드: coupledger 워드마크 + 아이콘 =====
// 워드마크 = 순수 텍스트(coup·dger 잉크, l=var(--wm-l), e=var(--wm-e)).
// 아이콘 = 두 원 대각선 겹침(좌상 accent, 우하 accent2).
import { el } from './util';

/** 텍스트 워드마크. fontSize(px) 지정 가능 */
export function wordmarkEl(fontSizePx?: number): HTMLElement {
  const wm = el('span', { class: 'wm' },
    'coup',
    el('span', { class: 'wm-l', text: 'l' }),
    el('span', { class: 'wm-e', text: 'e' }),
    'dger',
  );
  if (fontSizePx) wm.style.fontSize = fontSizePx + 'px';
  return wm;
}

/** 두 원 아이콘. sizePx = 정사각 변 길이 */
export function iconEl(sizePx = 40): HTMLElement {
  const box = el('span', { class: 'appicon' },
    el('span', { class: 'appicon-c l' }),
    el('span', { class: 'appicon-c r' }),
  );
  box.style.width = sizePx + 'px';
  box.style.height = sizePx + 'px';
  box.style.setProperty('--icon-size', sizePx + 'px');
  return box;
}

/** 아이콘 + 워드마크 락업 */
export function lockupEl(iconSize = 40, wmSize = 24): HTMLElement {
  return el('span', { class: 'lockup' }, iconEl(iconSize), wordmarkEl(wmSize));
}
