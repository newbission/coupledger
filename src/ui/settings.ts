// ===== Settings — 설정 페이지 =====
// 상단 '← 뒤로'(setRoute('app')) + 섹션들:
//   1) 멤버: 이름/색(m1..m6)/결제자/가중치/추가/삭제  (updateMember/setPayer/addMember/removeMember)
//   2) 앱 라벨(appLabel) + 소스(defaultSource)  (setConfig)
//   3) 카테고리: 편집·추가·삭제  (setConfig({ categories }))
//   4) 테마 전환: warm/minimal/slate 스와치  (setTheme)
//   5) 데이터: 백업 내보내기(exportBackupJSON→downloadFile 'coupledger-backup.json')
//             · 가져오기(file read→importBackupJSON) · 전체 초기화(resetAll, 확인)
//
// getState()로 현재 config를 읽고, 모든 변경은 store 액션으로만.
// 사용 클래스(모두 base.css 존재): .settings/.settings-group/.field/.theme-swatch/
//   .member-dot/.payer-badge/.btn*/.row/.stack/.muted/.spacer/.toast/.badge*.
//   색/여백/라운드는 tokens.css 변수만 사용(하드코딩 색 없음).
//   멤버 색 점은 swatch에 var(--m1..--m6)를 그대로 비춘다.
import type { SourceId, ThemeId } from '../types';
import { el, downloadFile, toast } from '../util';
import {
  getState,
  setRoute,
  setConfig,
  setTheme,
  addMember,
  removeMember,
  updateMember,
  setPayer,
  loadHistory,
  mergeHistoryEntries,
  exportBackupJSON,
  importBackupJSON,
  resetAll,
} from '../state/store';
import { pickFolder, listFolderSheets, disconnect } from '../integrations/google';
import { pushAll, pullAll } from '../integrations/gsync';

// 멤버 색 슬롯(테마 팔레트 m1..m6).
const COLOR_SLOTS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] as const;

const THEMES: { id: ThemeId; label: string; desc: string }[] = [
  { id: 'warm', label: '따뜻함', desc: '크림 · 코랄' },
  { id: 'minimal', label: '미니멀', desc: '화이트 · 블루' },
  { id: 'slate', label: '슬레이트', desc: '쿨 · 인디고' },
];

const SOURCES: { id: SourceId; label: string }[] = [{ id: 'samsung', label: '삼성카드' }];

/** 인라인 SVG 헬퍼(currentColor stroke). el() 은 HTML 전용이라 직접 생성. */
function svg(size: number, inner: string, strokeWidth = 2): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('width', String(size));
  node.setAttribute('height', String(size));
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', String(strokeWidth));
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.innerHTML = inner;
  return node;
}

// ---------- 1) 멤버 ----------

/** 한 멤버의 색 슬롯 선택(작은 원 점들). 현재 색은 테두리 강조. */
function colorPicker(memberId: string, current: string): HTMLElement {
  const wrap = el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } });
  for (const slot of COLOR_SLOTS) {
    const on = slot === current;
    const dot = el('button', {
      class: 'member-dot',
      type: 'button',
      'aria-label': `색 ${slot}`,
      'aria-pressed': on ? 'true' : 'false',
      title: slot,
      style: {
        width: '20px',
        height: '20px',
        cursor: 'pointer',
        background: `var(--${slot})`,
        boxShadow: on
          ? '0 0 0 2px var(--surface) inset, 0 0 0 2px var(--accent)'
          : '0 0 0 3px var(--surface) inset',
      },
      onClick: () => {
        updateMember(memberId, { colorVar: slot });
        toast('저장됨');
      },
    });
    wrap.append(dot);
  }
  return wrap;
}

function memberCard(memberId: string): HTMLElement {
  const { config } = getState();
  const m = config.members.find((x) => x.id === memberId);
  if (!m) return el('div');
  const canRemove = config.members.length > 1;

  // 이름.
  const nameInput = el('input', {
    type: 'text',
    value: m.name,
    'aria-label': '멤버 이름',
    style: { flex: '1 1 160px', minWidth: '0' },
    onChange: (e: Event) => {
      const v = (e.target as HTMLInputElement).value.trim();
      updateMember(m.id, { name: v || m.name });
      toast('저장됨');
    },
  });

  const dot = el('span', { class: 'member-dot' });
  dot.style.background = `var(--${m.colorVar})`;

  // 결제자 토글.
  const payerBtn = m.isPayer
    ? el('span', { class: 'payer-badge', text: '결제자' })
    : el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        text: '결제자로',
        onClick: () => {
          setPayer(m.id);
          toast('결제자가 바뀌었어요');
        },
      });

  // 삭제.
  const removeBtn = el('button', {
    class: 'btn btn-ghost btn-sm',
    type: 'button',
    'aria-label': '멤버 삭제',
    text: '삭제',
    disabled: !canRemove,
    style: canRemove ? null : { opacity: '.4', cursor: 'not-allowed' },
    onClick: () => {
      if (canRemove) {
        removeMember(m.id);
        toast('멤버가 삭제됐어요');
      }
    },
  });

  // 가중치(공용 분배 상대값).
  const weightInput = el('input', {
    type: 'number',
    min: '0',
    step: '0.5',
    value: String(m.weight),
    'aria-label': '공용 분배 가중치',
    style: { width: '88px' },
    onChange: (e: Event) => {
      const raw = parseFloat((e.target as HTMLInputElement).value);
      const w = Number.isFinite(raw) && raw >= 0 ? raw : m.weight;
      updateMember(m.id, { weight: w });
      toast('저장됨');
    },
  });

  return el(
    'div',
    {
      style: {
        padding: '12px 14px',
        marginBottom: '10px',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        background: 'var(--surface-2)',
      },
    },
    // 이름 행.
    el('div', { class: 'row', style: { gap: '10px' } }, dot, nameInput, payerBtn, removeBtn),
    // 색 + 가중치 행.
    el(
      'div',
      { class: 'row', style: { gap: '14px', marginTop: '12px', flexWrap: 'wrap' } },
      el(
        'div',
        { class: 'stack', style: { gap: '5px' } },
        el('span', { class: 'muted', style: { fontSize: '11.5px', fontWeight: '700' }, text: '색' }),
        colorPicker(m.id, m.colorVar),
      ),
      el('div', { class: 'spacer' }),
      el(
        'div',
        { class: 'stack', style: { gap: '5px' } },
        el('span', { class: 'muted', style: { fontSize: '11.5px', fontWeight: '700' }, text: '공용 가중치' }),
        weightInput,
      ),
    ),
  );
}

function memberSection(): HTMLElement {
  const { config } = getState();

  // 새 멤버 추가 입력.
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
    toast('멤버 추가됨');
  };
  addInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAdd();
    }
  });

  return el(
    'div',
    { class: 'settings-group' },
    el('h3', null, '멤버'),
    el(
      'p',
      { class: 'muted', style: { fontSize: '11.5px', fontWeight: '600', margin: '0 0 12px' } },
      '공용 지출을 함께 나눌 사람들 · 결제자 1명 · 가중치로 분배 비중 조절',
    ),
    el('div', null, ...config.members.map((m) => memberCard(m.id))),
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
  );
}

// ---------- 2) 앱 라벨 + 소스 ----------

function generalSection(): HTMLElement {
  const { config } = getState();

  const labelInput = el('input', {
    type: 'text',
    value: config.appLabel,
    placeholder: 'coupledger',
    'aria-label': '앱 표시 이름',
    onChange: (e: Event) => {
      const v = (e.target as HTMLInputElement).value.trim();
      setConfig({ appLabel: v || 'coupledger' });
      toast('저장됨');
    },
  });

  const sourceSelect = el(
    'select',
    {
      'aria-label': '기본 소스',
      value: config.defaultSource,
      onChange: (e: Event) => {
        setConfig({ defaultSource: (e.target as HTMLSelectElement).value as SourceId });
        toast('저장됨');
      },
    },
    ...SOURCES.map((s) =>
      el('option', { value: s.id, selected: s.id === config.defaultSource }, s.label),
    ),
  );

  return el(
    'div',
    { class: 'settings-group' },
    el('h3', null, '일반'),
    el(
      'div',
      { class: 'field' },
      el('label', null, '앱 표시 이름'),
      labelInput,
    ),
    el(
      'div',
      { class: 'field' },
      el(
        'label',
        null,
        '소스 ',
        el('span', { class: 'badge badge-warn', text: '다른 카드/은행 곧 추가' }),
      ),
      sourceSelect,
    ),
  );
}

// ---------- 3) 카테고리 ----------

function categorySection(): HTMLElement {
  const { config } = getState();
  const cats = config.categories;

  function setCats(next: string[]): void {
    setConfig({ categories: next });
  }

  const list = el('div', { class: 'stack', style: { gap: '8px' } });
  cats.forEach((cat, i) => {
    const input = el('input', {
      type: 'text',
      value: cat,
      'aria-label': '카테고리 이름',
      style: { flex: '1 1 auto', minWidth: '0' },
      onChange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value.trim();
        if (!v) return;
        const next = cats.slice();
        next[i] = v;
        setCats(next);
        toast('저장됨');
      },
    });
    const del = el('button', {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      'aria-label': '카테고리 삭제',
      text: '삭제',
      disabled: cats.length <= 1,
      style: cats.length <= 1 ? { opacity: '.4', cursor: 'not-allowed' } : null,
      onClick: () => {
        if (cats.length <= 1) return;
        setCats(cats.filter((_, j) => j !== i));
        toast('카테고리가 삭제됐어요');
      },
    });
    list.append(el('div', { class: 'row', style: { gap: '8px' } }, input, del));
  });

  // 추가.
  const addInput = el('input', {
    type: 'text',
    placeholder: '새 카테고리 입력 후 추가',
    'aria-label': '새 카테고리',
    style: { flex: '1 1 auto', minWidth: '0' },
  });
  const submitAdd = (): void => {
    const v = addInput.value.trim();
    if (!v) return;
    if (cats.includes(v)) {
      toast('이미 있는 카테고리예요');
      addInput.value = '';
      return;
    }
    setCats([...cats, v]);
    addInput.value = '';
    toast('카테고리 추가됨');
  };
  addInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAdd();
    }
  });

  return el(
    'div',
    { class: 'settings-group' },
    el('h3', null, '카테고리'),
    el(
      'p',
      { class: 'muted', style: { fontSize: '11.5px', fontWeight: '600', margin: '0 0 12px' } },
      '거래 분류에 쓰이는 카테고리 목록이에요 · 이름을 바꾸거나 추가/삭제할 수 있어요',
    ),
    list,
    el(
      'div',
      { class: 'row', style: { gap: '8px', marginTop: '10px' } },
      addInput,
      el(
        'button',
        { class: 'member-add', type: 'button', onClick: submitAdd },
        el('span', { style: { fontSize: '15px', lineHeight: '1' }, text: '+' }),
        '카테고리',
      ),
    ),
  );
}

// ---------- 4) 테마 ----------

function themeSwatch(t: { id: ThemeId; label: string; desc: string }): HTMLElement {
  const { config } = getState();
  const on = config.theme === t.id;
  // swatch 자체에 data-theme → 내부 점이 해당 테마 토큰색을 비춘다(하드코딩 색 없음).
  return el(
    'button',
    {
      class: 'theme-swatch' + (on ? ' is-on' : ''),
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      'data-theme': t.id,
      onClick: () => {
        setTheme(t.id);
        toast('테마 적용됨');
      },
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
}

function themeSection(): HTMLElement {
  return el(
    'div',
    { class: 'settings-group' },
    el('h3', null, '테마'),
    el(
      'div',
      { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
      ...THEMES.map(themeSwatch),
    ),
  );
}

// ---------- 5) 데이터(백업/가져오기/초기화) ----------

/** 백업 JSON 파일 선택 → 읽기 → importBackupJSON. 실패 시 토스트. */
function pickBackupFile(): void {
  const input = el('input', {
    type: 'file',
    accept: '.json,application/json',
    style: { display: 'none' },
    onChange: (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      input.remove();
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          importBackupJSON(String(reader.result ?? ''));
          toast('백업을 가져왔어요');
        } catch {
          toast('유효하지 않은 백업 파일이에요');
        }
      };
      reader.onerror = () => toast('파일을 읽지 못했어요');
      reader.readAsText(f);
    },
  });
  document.body.append(input);
  input.click();
}

function dataSection(): HTMLElement {
  const exportBtn = el(
    'button',
    {
      class: 'btn btn-ghost',
      type: 'button',
      onClick: () => {
        downloadFile('coupledger-backup.json', exportBackupJSON(), 'application/json');
        toast('백업을 내보냈어요');
      },
    },
    svg(15, '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
    '백업 내보내기',
  );

  const importBtn = el(
    'button',
    { class: 'btn btn-ghost', type: 'button', onClick: pickBackupFile },
    svg(15, '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 9l5-5 5 5"/><path d="M12 4v12"/>'),
    '가져오기',
  );

  const resetBtn = el(
    'button',
    {
      class: 'btn btn-ghost',
      type: 'button',
      style: { color: 'var(--danger)', borderColor: 'var(--danger)' },
      onClick: () => {
        const ok = window.confirm(
          '모든 멤버·카테고리·기록·설정을 지우고 처음 상태로 되돌려요. 계속할까요?',
        );
        if (ok) {
          resetAll();
          toast('처음 상태로 되돌렸어요');
        }
      },
    },
    svg(15, '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'),
    '전체 초기화',
  );

  return el(
    'div',
    { class: 'settings-group' },
    el('h3', null, '데이터'),
    el(
      'p',
      { class: 'muted', style: { fontSize: '11.5px', fontWeight: '600', margin: '0 0 12px' } },
      '모든 데이터는 이 브라우저에만 저장돼요 · 백업으로 옮기거나 보관하세요',
    ),
    el(
      'div',
      { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
      exportBtn,
      importBtn,
      el('div', { class: 'spacer' }),
      resetBtn,
    ),
  );
}

// ---------- 6) 구글시트 연결 (베타) ----------

function googleSection(): HTMLElement {
  const conn = getState().config.gdrive ?? null;
  const group = el(
    'div',
    { class: 'settings-group' },
    el('h3', null, '구글시트 연결 ', el('span', { class: 'badge', text: '베타' })),
  );

  const sheetIcon = (n: number) =>
    svg(n, '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/>');

  // ----- 미연결: 폴더 선택으로 연결 -----
  if (!conn) {
    const status = el('span', { class: 'muted', style: { fontSize: '12px' } }, '');
    const connectBtn = el(
      'button',
      {
        class: 'btn btn-primary',
        type: 'button',
        onClick: async () => {
          try {
            status.textContent = '구글 로그인·폴더 선택 중…';
            const folder = await pickFolder(); // 토큰은 내부에서 처리(첫 연결만 동의 팝업)
            if (!folder) {
              status.textContent = '폴더 선택을 취소했어요.';
              return;
            }
            // 연결 즉시 폴더의 시트 기록을 자동으로 가져와 history에 채움.
            let msg = '구글 연결됨 · ' + folder.name;
            status.textContent = '연결됨 · 시트에서 기록 가져오는 중…';
            try {
              const pulled = await pullAll(folder.id);
              if (pulled.length) {
                const { added, updated } = mergeHistoryEntries(pulled);
                if (added + updated) msg += ` · 기록 ${added + updated}개 가져옴`;
              }
            } catch {
              msg += ' · (자동 불러오기 실패 — 아래 버튼으로 재시도)';
            }
            setConfig({ gdrive: { folderId: folder.id, folderName: folder.name } });
            toast(msg);
          } catch (e) {
            status.textContent = '실패: ' + (e instanceof Error ? e.message : String(e));
            toast('연결 실패 — 상태 메시지 확인', 'info');
          }
        },
      },
      sheetIcon(15),
      '구글 연결 (폴더 선택)',
    );
    group.append(
      el(
        'p',
        { class: 'muted', style: { fontSize: '11.5px', fontWeight: '600', margin: '0 0 12px' } },
        '둘이 같은 폴더를 공유해 기록을 함께 봐요. 로그인 후 저장할 폴더를 고르면 됩니다.',
      ),
      el(
        'div',
        { class: 'row', style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
        connectBtn,
        status,
      ),
    );
    return group;
  }

  // ----- 연결됨: 폴더 + 시트 목록 + 변경/해제 -----
  const folderLink = 'https://drive.google.com/drive/folders/' + conn.folderId;

  const sheetList = el(
    'div',
    { style: { margin: '14px 0 0', fontSize: '12.5px' } },
    el('span', { class: 'muted', text: '시트 목록 불러오는 중…' }),
  );
  listFolderSheets(conn.folderId)
    .then((sheets) => {
      sheetList.replaceChildren();
      if (!sheets.length) {
        sheetList.append(
          el('span', { class: 'muted', text: '이 폴더에 아직 시트가 없어요. 정산을 저장하면 연도 시트가 생겨요.' }),
        );
        return;
      }
      sheetList.append(
        el('div', { class: 'muted', style: { marginBottom: '8px', fontWeight: '700' }, text: `시트 ${sheets.length}개` }),
      );
      const wrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
      for (const s of sheets.slice().sort((a, b) => b.name.localeCompare(a.name))) {
        wrap.append(
          el(
            'a',
            {
              href: 'https://docs.google.com/spreadsheets/d/' + s.id,
              target: '_blank',
              class: 'pill',
              style: { textDecoration: 'none', display: 'inline-flex', gap: '6px', alignItems: 'center' },
            },
            sheetIcon(13),
            el('span', { text: s.name }),
            el('span', { class: 'muted', text: '↗' }),
          ),
        );
      }
      sheetList.append(wrap);
    })
    .catch((e) => {
      sheetList.replaceChildren(
        el('span', { class: 'muted', text: '시트 목록을 못 불러왔어요: ' + (e instanceof Error ? e.message : '') }),
      );
    });

  const changeBtn = el(
    'button',
    {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      onClick: async () => {
        try {
          const f = await pickFolder();
          if (f) {
            let msg = '폴더 변경됨 · ' + f.name;
            try {
              const pulled = await pullAll(f.id);
              if (pulled.length) {
                const { added, updated } = mergeHistoryEntries(pulled);
                if (added + updated) msg += ` · 기록 ${added + updated}개 가져옴`;
              }
            } catch {
              /* 변경은 됐고 자동 불러오기만 실패 */
            }
            setConfig({ gdrive: { folderId: f.id, folderName: f.name } });
            toast(msg);
          }
        } catch (e) {
          toast('실패: ' + (e instanceof Error ? e.message : ''), 'info');
        }
      },
    },
    '폴더 변경',
  );
  const disconnectBtn = el(
    'button',
    {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      style: { color: 'var(--danger)' },
      onClick: () => {
        setConfig({ gdrive: null });
        disconnect();
        toast('연결 해제됨');
      },
    },
    '연결 해제',
  );

  const pushStatus = el('span', { class: 'muted', style: { fontSize: '12px' } }, '');
  const pushBtn = el(
    'button',
    {
      class: 'btn btn-primary btn-sm',
      type: 'button',
      onClick: async () => {
        try {
          const entries = loadHistory();
          const n = entries.filter((x) => x.snapshot).length;
          if (!n) {
            pushStatus.textContent = '올릴 기록이 없어요(저장된 스냅샷 필요).';
            return;
          }
          pushStatus.textContent = `올리는 중… 0/${n}`;
          const done = await pushAll(conn.folderId, entries, getState().config.members, (d, t) => {
            pushStatus.textContent = `올리는 중… ${d}/${t}`;
          });
          pushStatus.textContent = `완료 — ${done}개 기록을 시트에 올렸어요.`;
          toast('시트에 올렸어요');
        } catch (e) {
          pushStatus.textContent = '실패: ' + (e instanceof Error ? e.message : String(e));
          toast('올리기 실패 — 상태 메시지 확인', 'info');
        }
      },
    },
    '로컬 기록 시트로 올리기',
  );

  const pullBtn = el(
    'button',
    {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      onClick: async () => {
        try {
          pushStatus.textContent = '시트 읽는 중…';
          const pulled = await pullAll(conn.folderId, (d, t) => {
            pushStatus.textContent = `시트 읽는 중… ${d}/${t}`;
          });
          if (!pulled.length) {
            pushStatus.textContent = '시트에서 찾은 기록이 없어요.';
            return;
          }
          const { added, updated, skipped } = mergeHistoryEntries(pulled);
          pushStatus.textContent = `불러옴 — 새로 ${added} · 갱신 ${updated} · 유지 ${skipped}`;
          toast(`시트에서 ${added + updated}개 반영`);
        } catch (e) {
          pushStatus.textContent = '실패: ' + (e instanceof Error ? e.message : String(e));
          toast('불러오기 실패 — 상태 메시지 확인', 'info');
        }
      },
    },
    '시트에서 불러오기',
  );

  group.append(
    el(
      'p',
      { class: 'muted', style: { fontSize: '11.5px', fontWeight: '600', margin: '0 0 12px' } },
      '연결됨 — 매번 다시 로그인할 필요 없어요. 정산을 저장하면 이 폴더의 연도 시트에 기록돼요.',
    ),
    el(
      'div',
      { class: 'row', style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
      el(
        'a',
        { href: folderLink, target: '_blank', class: 'pill pill-accent', style: { textDecoration: 'none' } },
        '📁 ' + conn.folderName + ' ↗',
      ),
      changeBtn,
      el('div', { class: 'spacer' }),
      disconnectBtn,
    ),
    el(
      'div',
      { class: 'row', style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '12px' } },
      pushBtn,
      pullBtn,
      pushStatus,
    ),
    sheetList,
  );
  return group;
}

// ---------- 페이지 ----------

export function Settings(): HTMLElement {
  const backBtn = el(
    'button',
    {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      onClick: () => setRoute('app'),
    },
    svg(15, '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>'),
    '뒤로',
  );

  const head = el(
    'div',
    { class: 'sec-head', style: { marginTop: '20px', alignItems: 'center' } },
    backBtn,
    el('span', { class: 'sec-title', text: '설정' }),
    el('span', { class: 'sec-desc', text: '멤버 · 카테고리 · 테마 · 데이터를 관리해요' }),
  );

  const saveHint = el(
    'p',
    { class: 'save-hint', role: 'note' },
    svg(13, '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
    '변경하면 자동으로 저장돼요',
  );

  const panel = el(
    'div',
    { class: 'settings' },
    saveHint,
    memberSection(),
    generalSection(),
    categorySection(),
    themeSection(),
    googleSection(),
    dataSection(),
  );

  return el('div', { class: 'container' }, head, panel);
}
