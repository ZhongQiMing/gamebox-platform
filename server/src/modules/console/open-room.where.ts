/**
 * 关房 = 软删除。
 *
 * 经营名单（房间中心、账号中心、报表选房、总代账单空行）默认不出现。
 * 只有管理/总监能显式要已关闭。
 * 按 id 访问、下分审核、grantedRoomIds 仍认 CLOSED，不要拿这个去改授权范围。
 */
export const OPEN_ROOM_WHERE = { status: { not: 'CLOSED' as const } };

/** 账号树：只认还开着的房。关房后代理不能再以「未绑定」挂在总代名下。 */
export function hasOpenRoomSome(roomIds?: string[]) {
  return {
    rooms: {
      some: roomIds?.length
        ? { id: { in: roomIds }, ...OPEN_ROOM_WHERE }
        : { ...OPEN_ROOM_WHERE },
    },
  };
}

/** 关房时停月费，避免删了还进下一张总代账单 */
export const CLOSE_ROOM_PATCH = {
  status: 'CLOSED' as const,
  platformFeeDueAt: null,
  nextBillAt: null,
};

export function actorCanListClosedRooms(role: string): boolean {
  return role === 'ADMIN' || role === 'BRANCH';
}

export function allowClosedInRoomList(role: string, includeClosed?: boolean): boolean {
  return !!(includeClosed && actorCanListClosedRooms(role));
}

/** 已关且本期完全没动静的房，不进报表/总代表；有流水或资金的仍要留下对账 */
export function keepClosedRoomInPeriodList(row: {
  status: string;
  betFlow?: number;
  payout?: number;
  housePnl?: number;
  betCount?: number;
  upCount?: number;
  downCount?: number;
  commissionCount?: number;
}): boolean {
  if (row.status !== 'CLOSED') return true;
  const n = (v?: number) => Number(v) || 0;
  return (
    n(row.betCount) > 0
    || n(row.upCount) > 0
    || n(row.downCount) > 0
    || n(row.commissionCount) > 0
    || n(row.betFlow) !== 0
    || n(row.payout) !== 0
    || n(row.housePnl) !== 0
  );
}
