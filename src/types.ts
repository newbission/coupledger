// ===== coupledger 도메인 타입 (전체 모듈 공용 계약) =====

export type ThemeId = 'warm' | 'minimal' | 'slate';
export type SourceId = 'samsung';
export type Route = 'onboarding' | 'app' | 'settings';

export type CancelKind = 'none' | 'partial' | 'full';

/** 'shared'(공용) 또는 특정 멤버 개인 */
export type Assignment = 'shared' | { member: string };

export interface Member {
  id: string;
  name: string;
  /** 'm1'..'m6' → var(--m1) 등 테마 팔레트 슬롯 */
  colorVar: string;
  /** 카드값 결제자(청구 전액 결제). 정확히 1명 권장 */
  isPayer: boolean;
  /** 공용 분배 가중치(상대값, 기본 1) */
  weight: number;
}

export interface MerchantRule {
  /** 카테고리 → 선택 횟수 (빈도 학습) */
  cat: Record<string, number>;
  /** assignKey('shared' | memberId) → 선택 횟수 */
  assign: Record<string, number>;
}

export interface AppConfig {
  schema: number;
  onboarded: boolean;
  theme: ThemeId;
  members: Member[];
  defaultSource: SourceId;
  /** 편집 가능한 카테고리 목록 */
  categories: string[];
  /** 가맹점명 → 빈도 학습 규칙 */
  rules: Record<string, MerchantRule>;
  /** UI 라벨 커스터마이즈 (선택) */
  appLabel: string;
  /** 구글 드라이브 연결(저장 폴더). 없으면 미연결 */
  gdrive?: { folderId: string; folderName: string } | null;
}

/** 어댑터가 내보내는 원시 거래(취소행 포함, 음수 가능) */
export interface RawTxn {
  date: string;            // YYYY-MM-DD
  time?: string;
  merchant: string;
  amount: number;          // 취소행은 음수
  installment: boolean;
  installmentMonths: number;
  approvalNo: string;
  cancel: CancelKind;
  paymentDate?: string;
  source: SourceId;
}

export interface Split {
  category: string;
  amount: number;
}

/** 취소를 승인번호로 병합한 정산 단위 항목 */
export interface LineItem {
  id: string;
  date: string;            // YYYY-MM-DD
  merchant: string;
  /** 카드 승인번호 — 재업로드 시 같은 거래 매칭 키(없을 수 있음) */
  approvalNo?: string;
  gross: number;           // 원 승인금액(양수)
  canceledAmount: number;  // 취소 합계(<=0)
  net: number;             // gross + canceledAmount
  installment: boolean;
  installmentMonths: number;
  cancel: CancelKind;
  /** 전액취소/ net 0 → 정산 제외 */
  excluded: boolean;
  category: string | null;
  /** 자동 제안 상태(사용자 확정 전) */
  categoryAuto: boolean;
  assign: Assignment;
  /** 카테고리 분할(합계 = net). 없으면 null */
  splits: Split[] | null;
  /** 사용자가 직접 추가한 항목(엑셀 아님) */
  manual?: boolean;
}

export interface ImportResult {
  source: SourceId;
  periodLabel: string;     // '2026.05'
  periodStart: string;     // YYYY-MM-DD
  periodEnd: string;
  rawCount: number;        // 인식한 전체 행 수
  fileName: string;
  items: LineItem[];       // 병합 결과(제외 항목은 excluded=true)
}

export interface OwedLine {
  memberId: string;
  amount: number;          // 결제자에게 줄 총액
  sharedShare: number;     // 공용 분담분
  personal: number;        // 개인 분담분
}

export interface CategoryAmount {
  category: string;
  amount: number;
}

export interface SettlementResult {
  sharedTotal: number;
  /** memberId → 개인 지출 net 합계 */
  perMemberPersonal: Record<string, number>;
  cardTotalNet: number;    // 제외 제외한 청구 net 총액
  payerId: string;
  owed: OwedLine[];        // 결제자 외 멤버가 줄 금액
  byCategoryShared: CategoryAmount[]; // 공용 카테고리별(내림차순)
  excludedCount: number;
  solo: boolean;           // 멤버 1명 → 정산 없음(리포트)
}

export interface HistoryEntry {
  id: string;
  periodLabel: string;
  source: SourceId;
  savedAt: number;         // epoch ms
  cardTotalNet: number;
  settlement: SettlementResult;
  memberNames: Record<string, string>;
  itemCount: number;
  /** 전체 데이터 스냅샷 — 불러오기(복원)용 */
  snapshot: ImportResult;
  /** 구글 시트 동기화: 마지막 성공 시각(ms). 없으면 미동기화 */
  syncedAt?: number | null;
  /** 동기화된 시트 URL(열기 링크용) */
  sheetUrl?: string | null;
  /** 마지막 동기화 실패 메시지(있으면 실패 상태) */
  syncError?: string | null;
}

export interface Session {
  import: ImportResult | null;
  /** 현재 보고 있는 내역이 어떤 저장 기록에서 불러온 것인지(없으면 새 업로드) */
  loadedHistoryId?: string | null;
}

export interface AppState {
  config: AppConfig;
  session: Session;
  route: Route;
}

/** 백업(JSON 내보내기/가져오기) 포맷 */
export interface Backup {
  app: 'coupledger';
  schema: number;
  exportedAt: number;
  config: AppConfig;
  history: HistoryEntry[];
}
