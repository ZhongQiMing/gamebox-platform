/**
 * 实时开奖的房间口径：
 * 只有管理看全平台；总监、总代、代理都按各自的管辖房间收窄。
 *
 * 总监这一条是刻意的：他原先在这里放开成全平台，于是被屏蔽掉的总代
 * 名下房间的实时注单、开奖结果照样在盯盘页上滚，房号玩家金额全露，
 * 总代级可见性等于白做。这里一旦被改回 null，那个后门就又开了。
 * 反方向放开，代理就能看到别家房间的投注热度。
 */
import { ConsoleLiveService } from './console-live.service';
import type { ConsoleActor } from './console-scope.service';

type Scope = { grantedRoomIds: jest.Mock };

function makeService(granted: string[] | null) {
  const scope: Scope = { grantedRoomIds: jest.fn().mockResolvedValue(granted) };
  const svc = new ConsoleLiveService(
    {} as never,
    scope as never,
    { get: jest.fn(), set: jest.fn() } as never,
    {} as never,
  );
  return { svc, scope };
}

/** liveRoomScope 是私有的，测试按行为调用 */
function roomScopeOf(svc: ConsoleLiveService, actor: ConsoleActor) {
  return (svc as unknown as {
    liveRoomScope(a: ConsoleActor): Promise<string[] | null>;
  }).liveRoomScope(actor);
}

describe('实时开奖的房间口径', () => {
  it('管理看全平台，不去查授权房间', async () => {
    const { svc, scope } = makeService(['r1']);
    await expect(roomScopeOf(svc, { id: 'u', role: 'ADMIN' })).resolves.toBeNull();
    expect(scope.grantedRoomIds).not.toHaveBeenCalled();
  });

  it('总监按授权房间收窄：屏蔽掉的总代名下房间不能在盯盘页露出来', async () => {
    const { svc, scope } = makeService(['r1']);
    await expect(roomScopeOf(svc, { id: 'u', role: 'BRANCH' })).resolves.toEqual(['r1']);
    expect(scope.grantedRoomIds).toHaveBeenCalled();
  });

  it('总代只看名下房间', async () => {
    const { svc, scope } = makeService(['r1', 'r2', 'r3']);
    await expect(roomScopeOf(svc, { id: 'g', role: 'GENERAL' }))
      .resolves.toEqual(['r1', 'r2', 'r3']);
    expect(scope.grantedRoomIds).toHaveBeenCalled();
  });

  it('代理只看自己那间房', async () => {
    const { svc } = makeService(['r9']);
    await expect(roomScopeOf(svc, { id: 'a', role: 'AGENT' })).resolves.toEqual(['r9']);
  });

  it('子账号跟着自己挂的那一层', async () => {
    const { svc } = makeService(['r9']);
    await expect(roomScopeOf(svc, { id: 'p', role: 'PROXY' })).resolves.toEqual(['r9']);
  });

  it('一间房都没有的代理拿到空数组，不会退化成全平台', async () => {
    const { svc } = makeService([]);
    await expect(roomScopeOf(svc, { id: 'a', role: 'AGENT' })).resolves.toEqual([]);
  });
});
