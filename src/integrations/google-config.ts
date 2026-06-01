// ===== 구글 연동 설정값 =====
// 클라이언트 ID는 공개돼도 안전한 값(브라우저 OAuth 표준). 클라이언트 '시크릿'은 사용하지 않음.
// API 키는 Picker(폴더 선택)용 — 발급 후 채우고, Cloud Console에서 리퍼러/Picker API로 제한 권장.

export const GOOGLE_CLIENT_ID =
  '754823757789-5gi3s1bcgoggj6tmnhdl05elah2has19.apps.googleusercontent.com';

/** Picker(폴더 선택)용. 발급 후 채움. 비어 있으면 폴더 선택 기능만 비활성. */
export const GOOGLE_API_KEY = '';

/** 최소 권한: 시트 읽기/쓰기/생성 + 사용자가 고른(또는 앱이 만든) 파일만 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');
