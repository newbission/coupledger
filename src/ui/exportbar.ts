// ===== 내보내기 바: Excel / CSV / PDF + 구글 시트 저장 (정산요약·기록카드 공용) =====
import { el, toast, downloadFile, uid } from '../util';
import { getState } from '../state/store';
import { exportCSV } from '../export/csv';
import { exportXLSX, exportPDF } from '../export/exporters';
import { pushEntry } from '../integrations/gsync';
import type { HistoryEntry, ImportResult, Member, SettlementResult } from '../types';

/** 현재 데이터로 임시 HistoryEntry 구성(시트 저장용). */
function makeEntry(imp: ImportResult, members: Member[], s: SettlementResult): HistoryEntry {
  const memberNames: Record<string, string> = {};
  for (const m of members) memberNames[m.id] = m.name;
  return {
    id: uid(),
    periodLabel: imp.periodLabel,
    source: imp.source,
    savedAt: Date.now(),
    cardTotalNet: s.cardTotalNet,
    settlement: s,
    memberNames,
    itemCount: imp.items.filter((it) => !it.excluded).length,
    snapshot: imp,
  };
}

/** 내보내기 버튼 묶음. entry 주면 그 기록을, 없으면 현재 데이터를 내보냄. */
export function exportBar(
  imp: ImportResult,
  members: Member[],
  s: SettlementResult,
  entry?: HistoryEntry,
): HTMLElement {
  const base = `coupledger_${imp.periodLabel.replace(/\./g, '-')}`;
  const mini = (label: string, onClick: () => void): HTMLElement =>
    el(
      'button',
      {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onClick: (e: Event) => {
          e.stopPropagation();
          onClick();
        },
      },
      label,
    );

  const row = el(
    'div',
    { class: 'row', style: { gap: '7px', flexWrap: 'wrap', alignItems: 'center' } },
    el('span', { class: 'muted', style: { fontSize: '11.5px', fontWeight: '700' } }, '내보내기'),
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

  const gdrive = getState().config.gdrive;
  if (gdrive) {
    const status = el('span', { class: 'muted', style: { fontSize: '11.5px' } }, '');
    const gbtn = el(
      'button',
      {
        class: 'btn btn-primary btn-sm',
        type: 'button',
        onClick: async (e: Event) => {
          e.stopPropagation();
          try {
            status.textContent = '저장 중…';
            await pushEntry(gdrive.folderId, entry ?? makeEntry(imp, members, s), members);
            status.textContent = '시트에 저장됨';
            toast('구글 시트에 저장됨');
          } catch (err) {
            status.textContent = '실패';
            toast('시트 저장 실패: ' + (err instanceof Error ? err.message : ''), 'info');
          }
        },
      },
      '구글 시트',
    );
    row.append(el('span', { class: 'spacer' }), gbtn, status);
  }
  return row;
}
