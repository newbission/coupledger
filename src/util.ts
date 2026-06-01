// ===== 공용 유틸 =====
import type { Assignment } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2, 10);
}

/** ₩1,234,567 */
export function won(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + '₩' + Math.abs(Math.round(n)).toLocaleString('ko-KR');
}

/** 1,234,567 (기호 없음) */
export function comma(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function assignKey(a: Assignment): string {
  return a === 'shared' ? 'shared' : a.member;
}

export function isShared(a: Assignment): boolean {
  return a === 'shared';
}

export function memberOf(a: Assignment): string | null {
  return a === 'shared' ? null : a.member;
}

type Child = Node | string | null | undefined | false;
interface ElProps {
  class?: string;
  text?: string;
  html?: string;
  // 이벤트: onClick, onInput, onChange ...
  [key: string]: unknown;
}

/**
 * 간결한 DOM 생성 헬퍼. 모든 UI 모듈은 이걸 사용한다.
 *   el('button', { class: 'btn', onClick: () => ... }, '저장')
 *   el('div', { class: 'row' }, child1, child2)
 * - class/text/html: 특수 처리
 * - on<Event>: addEventListener
 * - data-*, aria-* 등 나머지: setAttribute 또는 property
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === 'class') node.className = String(v);
      else if (k === 'text') node.textContent = String(v);
      else if (k === 'html') node.innerHTML = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v as object);
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') {
        (node as Record<string, unknown>)[k] = v;
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(host: HTMLElement): void {
  host.replaceChildren();
}

/** 'YYYY-MM-DD' → 'MM.DD' */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${m}.${d}`;
}

/** 'YYYY-MM-DD' → 'YYYY.MM' */
export function periodOf(iso: string): string {
  const [y, m] = iso.split('-');
  return `${y}.${m}`;
}

export function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 화면 하단에 잠깐 떴다 사라지는 토스트(저장됨 등 피드백). 자체 스타일이라 CSS 불필요. */
export function toast(message: string, kind: 'ok' | 'info' = 'ok'): void {
  const t = el('div', { class: 'toast', text: message });
  Object.assign(t.style, {
    position: 'fixed',
    left: '50%',
    bottom: '28px',
    transform: 'translateX(-50%) translateY(10px)',
    background: kind === 'ok' ? 'var(--accent-deep, #333)' : 'var(--ink, #333)',
    color: '#fff',
    padding: '11px 18px',
    borderRadius: '999px',
    fontSize: '13.5px',
    fontWeight: '700',
    boxShadow: 'var(--shadow-lg, 0 12px 32px rgba(0,0,0,.18))',
    zIndex: '2000',
    opacity: '0',
    transition: 'opacity .2s ease, transform .2s ease',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  document.body.append(t);
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => t.remove(), 240);
  }, 1900);
}
