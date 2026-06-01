// ===== 구글 Sheets/Drive 연동 (브라우저 OAuth, 서버 없음) =====
// Google Identity Services(GIS) 토큰 방식 → 액세스 토큰은 메모리에만(localStorage 저장 안 함).
// REST는 fetch로 직접 호출. 비밀키 없음.
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, GOOGLE_API_KEY } from './google-config';

interface TokenClient {
  callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void;
  requestAccessToken: (opts?: { prompt?: string }) => void;
}
interface GoogleNS {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        callback: TokenClient['callback'];
      }) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
    };
  };
}
// Picker/gapi 는 외부 위젯이라 느슨하게 타입.
type AnyObj = Record<string, unknown> & { [k: string]: unknown };
declare global {
  interface Window {
    google?: { accounts?: GoogleNS['accounts']; picker?: AnyObj };
    gapi?: { load: (name: string, cfg: { callback: () => void; onerror?: () => void }) => void };
  }
}

let tokenClient: TokenClient | null = null;
let accessToken: string | null = null;
let tokenExpiry = 0;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('구글 스크립트 로드 실패'));
    document.head.append(s);
  });
}

async function ensureGis(): Promise<void> {
  await loadScript('https://accounts.google.com/gsi/client');
  const g = window.google?.accounts?.oauth2;
  if (!g) throw new Error('GIS 초기화 실패');
  if (!tokenClient) {
    tokenClient = g.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: () => {},
    });
  }
}

/** 동의 팝업 → 액세스 토큰. interactive=false면 가능 시 무팝업. */
export async function requestToken(interactive = true): Promise<string> {
  await ensureGis();
  return new Promise<string>((resolve, reject) => {
    tokenClient!.callback = (resp) => {
      if (resp.error || !resp.access_token) {
        reject(new Error(resp.error || '토큰 획득 실패'));
        return;
      }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000 - 60_000;
      resolve(accessToken);
    };
    tokenClient!.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

async function token(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  try {
    return await requestToken(false);
  } catch {
    return requestToken(true);
  }
}

export function isConnected(): boolean {
  return !!accessToken && Date.now() < tokenExpiry;
}

export function disconnect(): void {
  if (accessToken) window.google?.accounts?.oauth2.revoke(accessToken);
  accessToken = null;
  tokenExpiry = 0;
}

async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const t = await token();
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + t,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google API ${res.status}: ${txt.slice(0, 300)}`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

// ---------- Sheets ----------

/** 새 스프레드시트 생성 → spreadsheetId */
export async function createSpreadsheet(title: string): Promise<string> {
  const r = await api<{ spreadsheetId: string }>(
    'https://sheets.googleapis.com/v4/spreadsheets',
    { method: 'POST', body: JSON.stringify({ properties: { title } }) },
  );
  return r.spreadsheetId;
}

/** 탭(시트) 제목 목록 */
export async function listTabs(spreadsheetId: string): Promise<string[]> {
  const r = await api<{ sheets?: { properties: { title: string } }[] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
  );
  return (r.sheets || []).map((s) => s.properties.title);
}

/** 탭 추가(이미 있으면 무시) */
export async function ensureTab(spreadsheetId: string, title: string): Promise<void> {
  const tabs = await listTabs(spreadsheetId);
  if (tabs.includes(title)) return;
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
}

/** 범위 덮어쓰기(RAW) */
export async function writeRange(
  spreadsheetId: string,
  range: string,
  values: (string | number)[][],
): Promise<void> {
  await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      range,
    )}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values }) },
  );
}

/** 범위 읽기 */
export async function readRange(spreadsheetId: string, range: string): Promise<string[][]> {
  const r = await api<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      range,
    )}`,
  );
  return r.values || [];
}

// ---------- Drive (폴더) ----------

const DRIVE = 'https://www.googleapis.com/drive/v3';

/** 폴더 내 스프레드시트 목록 */
export async function listFolderSheets(
  folderId: string,
): Promise<{ id: string; name: string }[]> {
  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
  );
  const r = await api<{ files?: { id: string; name: string }[] }>(
    `${DRIVE}/files?q=${q}&fields=files(id,name)`,
  );
  return r.files || [];
}

/** 폴더 안에서 name 시트를 찾고 없으면 생성(생성 후 폴더로 이동) → spreadsheetId */
export async function findOrCreateSheetInFolder(folderId: string, name: string): Promise<string> {
  const hit = (await listFolderSheets(folderId)).find((f) => f.name === name);
  if (hit) return hit.id;
  const id = await createSpreadsheet(name);
  await api(`${DRIVE}/files/${id}?addParents=${folderId}&removeParents=root&fields=id`, {
    method: 'PATCH',
  });
  return id;
}

// ---------- Picker (폴더 선택) ----------

let pickerLoaded = false;
async function ensurePicker(): Promise<void> {
  if (pickerLoaded && window.google?.picker) return;
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((resolve, reject) => {
    if (!window.gapi) {
      reject(new Error('gapi 로드 실패'));
      return;
    }
    window.gapi.load('picker', {
      callback: () => resolve(),
      onerror: () => reject(new Error('Picker 로드 실패')),
    });
  });
  pickerLoaded = true;
}

/** 폴더 선택 Picker → {id, name} (취소 시 null) */
export async function pickFolder(): Promise<{ id: string; name: string } | null> {
  if (!GOOGLE_API_KEY) throw new Error('API 키가 없어요(Picker)');
  const t = await token();
  await ensurePicker();
  // 외부 위젯이라 any 로 다룸.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const picker = window.google!.picker as any;
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      .setMimeTypes('application/vnd.google-apps.folder');
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(t)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setTitle('정산을 저장할 폴더 선택')
      .setCallback((data: { action: string; docs?: { id: string; name: string }[] }) => {
        if (data.action === picker.Action.PICKED && data.docs && data.docs[0]) {
          resolve({ id: data.docs[0].id, name: data.docs[0].name });
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
}
