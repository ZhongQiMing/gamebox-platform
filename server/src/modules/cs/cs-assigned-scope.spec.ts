/**
 * 客服「审本单」的玩家范围。
 *
 * 这里出错的表现很隐蔽：客服在聊天里跟玩家聊得好好的，点「审本单」却说「暂无待审申请」，
 * 而审核动作本身（assertReviewScope，按房间归属授权）其实允许他批——变成「批得动却看不见」。
 * 根因是同一个玩家有两套范围口径：会话列表算上了房间成员，审单过滤只比 agentPath。
 * 玩家是按房间进来的，agentPath 不一定挂到代理身上（实测就有停在 '/' 的），于是被过滤掉。
 */
import { CsService } from './cs.service';

type PlayerRow = { id: string; agentPath: string };

const AGENT_PREFIX = '/agent-1/';
/** 挂靠过的玩家：agentPath 落在代理前缀下 */
const HUNG: PlayerRow = { id: 'p-hung', agentPath: `${AGENT_PREFIX}` };
/** 只进了房、没挂靠的玩家：agentPath 停在根 */
const ROOM_ONLY: PlayerRow = { id: 'p-room', agentPath: '/' };
/** 别家代理的玩家：既不挂靠也不在本代理房间里 */
const OUTSIDER: PlayerRow = { id: 'p-out', agentPath: '/agent-2/' };

const ALL = [HUNG, ROOM_ONLY, OUTSIDER];

/** 按 assignedPlayerIdsForCs 里那份 where 手工过一遍，验证口径本身 */
function matches(player: PlayerRow, roomMemberIds: string[]): boolean {
  return (
    player.agentPath.startsWith(AGENT_PREFIX) || roomMemberIds.includes(player.id)
  );
}

describe('客服审单的玩家范围', () => {
  it('房间成员即便没挂靠也要算进来', () => {
    const roomMembers = [HUNG.id, ROOM_ONLY.id];
    const visible = ALL.filter((p) => matches(p, roomMembers)).map((p) => p.id);
    expect(visible).toContain(ROOM_ONLY.id);
    expect(visible).toContain(HUNG.id);
  });

  it('不在房、也不挂本代理的玩家仍要挡住', () => {
    const roomMembers = [HUNG.id, ROOM_ONLY.id];
    expect(matches(OUTSIDER, roomMembers)).toBe(false);
  });

  it('代理名下没有房间时，只按挂靠算，不会放开成全体', () => {
    expect(matches(HUNG, [])).toBe(true);
    expect(matches(ROOM_ONLY, [])).toBe(false);
    expect(matches(OUTSIDER, [])).toBe(false);
  });

  it('审单范围的查询里确实带了房间成员这一支', () => {
    /*
     * 纯口径断言容易与实现脱节，这里再对源码做一次结构检查：
     * assignedPlayerIdsForCs 必须同时出现 roomMemberPlayerIds 与 agentPath 两个分支，
     * 少任何一个都会退回「只比 agentPath」的老毛病。
     */
    const src = CsService.prototype.assignedPlayerIdsForCs.toString();
    expect(src).toContain('roomMemberPlayerIds');
    expect(src).toContain('agentPath');
  });
});
