import { LoginLockService } from './login-lock.service';

describe('LoginLockService 临时登录退避', () => {
  const prisma = {
    user: {
      update: jest.fn(),
    },
  };
  const redis = {
    consumeFixedWindow: jest.fn(),
    del: jest.fn(),
  };
  let service: LoginLockService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.consumeFixedWindow.mockResolvedValue(1);
    redis.del.mockResolvedValue(undefined);
    service = new LoginLockService(prisma as never, redis as never);
  });

  it('错密只累计 15 分钟 Redis 计数，不冻结账号或递增 tokenVersion', async () => {
    const out = await service.recordFailure({
      username: 'PlayerOne',
      ip: '203.0.113.8',
    });

    expect(out).toEqual({
      blocked: false,
      pairBlocked: false,
      ipBlocked: false,
    });
    expect(redis.consumeFixedWindow).toHaveBeenNthCalledWith(
      1,
      'login:fail:pair:playerone:203.0.113.8',
      900,
    );
    expect(redis.consumeFixedWindow).toHaveBeenNthCalledWith(
      2,
      'login:fail:ip:203.0.113.8',
      900,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('第 10 次失败进入临时退避，但仍不写用户表', async () => {
    redis.consumeFixedWindow
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(10);

    await expect(
      service.recordFailure({ username: 'playerone', ip: '203.0.113.8' }),
    ).resolves.toEqual({
      blocked: true,
      pairBlocked: true,
      ipBlocked: true,
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('用户名不存在且无 IP 时的计数也会自动过期', async () => {
    await service.recordFailure({ username: 'missing-user' });

    expect(redis.consumeFixedWindow).toHaveBeenCalledTimes(1);
    expect(redis.consumeFixedWindow).toHaveBeenCalledWith(
      'login:fail:pair:missing-user:unknown',
      900,
    );
  });

  it('Redis 故障不回退为数据库永久冻号', async () => {
    redis.consumeFixedWindow.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      service.recordFailure({ username: 'playerone', ip: '203.0.113.8' }),
    ).resolves.toEqual({
      blocked: false,
      pairBlocked: false,
      ipBlocked: false,
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('成功登录只清账号来源组合，不清整个 IP 的撞库计数', async () => {
    await service.clearFailCounters('PlayerOne', '203.0.113.8');

    expect(redis.del).toHaveBeenCalledWith(
      'login:fail:user:playerone',
      'login:fail:pair:playerone:203.0.113.8',
    );
    expect(redis.del).not.toHaveBeenCalledWith(
      expect.stringContaining('login:fail:ip:'),
    );
  });
});
