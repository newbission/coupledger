// ===== Upload — 이용내역 가져오기 =====
// 미업로드: 드롭존(.xlsx 클릭/드래그) → parseSamsung(file) → setImport
// 업로드됨: 파일명 · '삼성카드 N건 인식' · 조회기간 · 다시 업로드 + '다른 카드/은행 곧'
// 에러: 토스트 메시지. 모든 색/여백은 tokens.css 변수(base.css 클래스)만 사용.
import { el, comma } from '../util';
import { getState, setImport } from '../state/store';
import { parseSamsung } from '../import/samsung';

const ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 1.2초 후 사라지는 토스트(.toast 는 base.css 정의). */
function toast(msg: string): void {
  const t = el('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

/** 숨김 파일 input 을 만들어 즉시 파일 선택을 띄운다. */
function pickFile(onPick: (file: File) => void): void {
  const input = el('input', {
    type: 'file',
    accept: ACCEPT,
    style: { display: 'none' },
    onChange: (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      input.remove();
      if (f) onPick(f);
    },
  });
  document.body.append(input);
  input.click();
}

/** 파일 확장자 검사 → parseSamsung → setImport. 실패 시 토스트. */
async function handleFile(file: File): Promise<void> {
  if (!/\.xlsx$/i.test(file.name)) {
    toast('삼성카드 이용내역 .xlsx 파일을 올려주세요');
    return;
  }
  try {
    const result = await parseSamsung(file);
    if (!result.items.length) {
      toast('인식된 거래가 없어요. 파일을 확인해주세요');
      return;
    }
    setImport(result);
  } catch {
    toast('파일을 읽지 못했어요. 삼성카드 이용내역(.xlsx)인지 확인해주세요');
  }
}

/** 미업로드 상태: 클릭/드래그 드롭존. */
function dropzone(): HTMLElement {
  const zone = el(
    'div',
    {
      class: 'dropzone',
      role: 'button',
      tabindex: '0',
      'aria-label': '카드 이용내역 .xlsx 파일 올리기',
      onClick: () => pickFile((f) => void handleFile(f)),
      onKeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickFile((f) => void handleFile(f));
        }
      },
      onDragover: (e: DragEvent) => {
        e.preventDefault();
        zone.classList.add('is-over');
      },
      onDragleave: () => zone.classList.remove('is-over'),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        zone.classList.remove('is-over');
        const f = e.dataTransfer?.files?.[0];
        if (f) void handleFile(f);
      },
    },
    uploadIcon(20),
    el('div', { class: 'dropzone-text' },
      el('span', { class: 'dropzone-title', text: '.xlsx 파일을 끌어다 놓거나 클릭' }),
      el('span', { class: 'dropzone-meta' },
        '삼성카드 이용내역 지원 · ',
        el('b', { text: '다른 카드/은행 곧 추가' }),
      ),
    ),
  );
  // .upload-done 의 ok-dot 가상요소가 어울리지 않으므로 드롭존 안내문은 일반 텍스트(가로 1줄 컴팩트).
  return el('div', { class: 'upload', style: { padding: '0', border: 'none', background: 'transparent', boxShadow: 'none' } }, zone);
}

/** 업로드됨 상태: 파일명 · 인식 건수 · 조회기간 · 다시 업로드. */
function uploadedView(): HTMLElement {
  const imp = getState().session.import!;
  const sourceLabel = imp.source === 'samsung' ? '삼성카드' : imp.source;

  return el('div', { class: 'upload' },
    uploadIcon(26),
    el('div', { style: { flex: '1 1 240px', minWidth: '200px' } },
      el('div', { class: 'upload-done' }, imp.fileName),
      el('div', { class: 'file-meta' },
        el('b', { text: `${sourceLabel} · ${comma(imp.rawCount)}건 인식` }),
        ` · ${imp.periodLabel} 조회기간 · ${comma(imp.items.length)}개 항목`,
      ),
      el('div', { class: 'file-meta' },
        '삼성카드 이용내역(.xlsx) 지원 ',
        el('span', { class: 'badge badge-warn', text: '다른 카드/은행 곧 추가' }),
      ),
    ),
    el('button', {
      class: 'btn btn-ghost',
      type: 'button',
      onClick: () => pickFile((f) => void handleFile(f)),
    }, reuploadIcon(), '다시 업로드'),
  );
}

/** 문서 아이콘(체크). 색은 currentColor(컨테이너 색 토큰 상속). */
function uploadIcon(size: number): SVGElement {
  return svg(size,
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/>',
  );
}

function reuploadIcon(): SVGElement {
  return svg(15,
    '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5"/>' +
    '<path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  );
}

/** 인라인 SVG 헬퍼(currentColor stroke). el() 은 HTML 전용이라 직접 생성. */
function svg(size: number, inner: string): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('width', String(size));
  node.setAttribute('height', String(size));
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.9');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.innerHTML = inner;
  return node;
}

export function Upload(): HTMLElement {
  const body = getState().session.import ? uploadedView() : dropzone();
  return el('section', { class: 'section' },
    el('div', { class: 'sec-head' },
      el('span', { class: 'sec-title', text: '이용내역 가져오기' }),
      el('span', {
        class: 'sec-desc',
        text: '카드/은행 거래내역 파일을 올리면 자동으로 분류돼요',
      }),
    ),
    body,
  );
}
