// ===== 내보내기 바: 파일(Excel / CSV / PDF) =====
// 구글 시트 동기화는 '확정' 액션에서 자동 처리(여기서는 파일 내보내기만).
import { el, toast, downloadFile } from '../util';
import { exportCSV } from '../export/csv';
import { exportXLSX, exportPDF } from '../export/exporters';
import type { ImportResult, Member, SettlementResult } from '../types';

/** 파일 내보내기 버튼 묶음(현재 데이터 또는 특정 기록). */
export function exportBar(imp: ImportResult, members: Member[], s: SettlementResult): HTMLElement {
  const base = `coupledger_${imp.periodLabel.replace(/\./g, '-')}`;
  const mini = (label: string, onClick: () => void): HTMLElement =>
    el('button', {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      onClick: (e: Event) => {
        e.stopPropagation();
        onClick();
      },
    }, label);

  return el('div', { class: 'row export-bar', style: { gap: '7px', flexWrap: 'wrap', alignItems: 'center' } },
    el('span', { class: 'muted export-label', text: '내보내기 (파일)' }),
    mini('Excel', () => {
      exportXLSX(imp, members, s);
      toast('Excel 내보냈어요');
    }),
    mini('CSV', () => {
      downloadFile(base + '.csv', exportCSV(imp, members, s), 'text/csv;charset=utf-8');
      toast('CSV 내보냈어요');
    }),
    mini('PDF', () => {
      if (!exportPDF(imp, members, s)) toast('팝업이 막혔어요 — 허용 후 다시', 'info');
    }),
  );
}
