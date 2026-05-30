// ===== 정산 엔진 =====
// 제외(excluded) 안 된 LineItem만 집계해 SettlementResult 산출.
// 순수 함수: 입력(items, members)만으로 결과 결정. 외부 상태/DOM 의존 없음.
import type {
  CategoryAmount,
  LineItem,
  Member,
  OwedLine,
  SettlementResult,
} from '../types';
import { isShared, memberOf } from '../util';

/** item의 정산 금액: splits 있으면 splits 합, 없으면 net. */
function itemAmount(it: LineItem): number {
  if (it.splits && it.splits.length) {
    return it.splits.reduce((sum, s) => sum + s.amount, 0);
  }
  return it.net;
}

export function computeSettlement(
  items: LineItem[],
  members: Member[],
): SettlementResult {
  const solo = members.length <= 1;
  const payer = members.find((m) => m.isPayer) ?? members[0];
  const payerId = payer ? payer.id : '';

  // 멤버별 개인 지출 net 합계(모든 멤버 0으로 초기화).
  const perMemberPersonal: Record<string, number> = {};
  for (const m of members) perMemberPersonal[m.id] = 0;

  let sharedTotal = 0;
  let cardTotalNet = 0;
  let excludedCount = 0;

  // 공용 카테고리별 합계.
  const sharedCatMap = new Map<string, number>();

  for (const it of items) {
    if (it.excluded) {
      excludedCount++;
      continue;
    }

    // 청구 총액은 항상 net 기준(분할은 net 재배분이므로 net 사용).
    cardTotalNet += it.net;

    const amount = itemAmount(it);

    if (isShared(it.assign)) {
      sharedTotal += amount;
      // 카테고리 집계는 splits 우선.
      if (it.splits && it.splits.length) {
        for (const sp of it.splits) {
          addCat(sharedCatMap, sp.category, sp.amount);
        }
      } else {
        addCat(sharedCatMap, it.category ?? '미분류', amount);
      }
    } else {
      const mid = memberOf(it.assign);
      if (mid != null && mid in perMemberPersonal) {
        perMemberPersonal[mid] += amount;
      } else if (mid != null) {
        // 멤버 목록에 없는 id(삭제된 멤버 등)는 안전하게 누적.
        perMemberPersonal[mid] = (perMemberPersonal[mid] ?? 0) + amount;
      }
    }
  }

  // 공용 분배: 결제자 외 멤버가 가중치 비율로 분담.
  const owed: OwedLine[] = [];
  if (!solo) {
    const totalWeight = members.reduce(
      (sum, m) => sum + (m.weight > 0 ? m.weight : 0),
      0,
    );
    for (const m of members) {
      if (m.id === payerId) continue;
      const w = m.weight > 0 ? m.weight : 0;
      const sharedShare = totalWeight > 0 ? sharedTotal * (w / totalWeight) : 0;
      const personal = perMemberPersonal[m.id] ?? 0;
      owed.push({
        memberId: m.id,
        amount: sharedShare + personal,
        sharedShare,
        personal,
      });
    }
  }

  // 공용 카테고리별 내림차순.
  const byCategoryShared: CategoryAmount[] = [...sharedCatMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    sharedTotal,
    perMemberPersonal,
    cardTotalNet,
    payerId,
    owed,
    byCategoryShared,
    excludedCount,
    solo,
  };
}

function addCat(map: Map<string, number>, category: string, amount: number): void {
  map.set(category, (map.get(category) ?? 0) + amount);
}
