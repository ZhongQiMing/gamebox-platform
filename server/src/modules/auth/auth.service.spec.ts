import {
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DUMMY_PASSWORD_HASH } from '../../common/security.constants';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

const mockedCompare = bcrypt.compare as jest.Mock;

describe('AuthService 登录安全', () => {
  const users = {
    findByUsername: jest.fn(),
    getProfile: jest.fn(),
    create: jest.fn(),
  };
  const jwt = {
    sign: jest.fn(),
  };
  const riskDetector = {
    onPlayerLogin: jest.fn(),
  };
  const loginLock = {
    recordFailure: jest.fn(),
    clearFailCounters: jest.fn(),
    isLocked: jest.fn(),
  };
  let service: AuthService;

  const activeUser = {
    id: 'user-1',
    username: 'playerone',
    passwordHash: 'real-password-hash',
    uid: '123456789',
    role: 'PLAYER',
    status: 'ACTIVE',
    loginLockedAt: null,
    tokenVersion: 7,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    users.findByUsername.mockResolvedValue(activeUser);
    users.getProfile.mockResolvedValue({
      id: activeUser.id,
      uid: activeUser.uid,
      role: activeUser.role,
    });
    jwt.sign.mockReturnValue('jwt-token');
    riskDetector.onPlayerLogin.mockResolvedValue(undefined);
    loginLock.recordFailure.mockResolvedValue({ blocked: false });
    loginLock.clearFailCounters.mockResolvedValue(undefined);
    loginLock.isLocked.mockReturnValue(false);
    mockedCompare.mockResolvedValue(true);
    service = new AuthService(
      users as never,
      jwt as never,
      riskDetector as never,
      loginLock as never,
    );
  });

  it('账号不存在时仍使用固定 cost=12 dummy hash 做 bcrypt', async () => {
    users.findByUsername.mockResolvedValue(null);
    mockedCompare.mockResolvedValue(false);

    await expect(
      service.login('missing-user', 'wrong-password', '203.0.113.8'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockedCompare).toHaveBeenCalledWith(
      'wrong-password',
      DUMMY_PASSWORD_HASH,
    );
    expect(loginLock.recordFailure).toHaveBeenCalledWith({
      username: 'missing-user',
      ip: '203.0.113.8',
    });
  });

  it('临时阈值命中时返回 429，不再声称账号被永久冻结', async () => {
    mockedCompare.mockResolvedValue(false);
    loginLock.recordFailure.mockResolvedValue({ blocked: true });

    let error: unknown;
    try {
      await service.login('playerone', 'wrong-password', '203.0.113.8');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as Error).message).toContain('15 分钟后再试');
    expect(loginLock.recordFailure).toHaveBeenCalledWith({
      username: 'playerone',
      ip: '203.0.113.8',
    });
    expect(loginLock.clearFailCounters).not.toHaveBeenCalled();
  });

  it('密码正确时不查询失败阈值，保留 tokenVersion 并允许已有会话继续有效', async () => {
    const out = await service.login(
      'playerone',
      'correct-password',
      '203.0.113.8',
    );

    expect(loginLock.recordFailure).not.toHaveBeenCalled();
    expect(loginLock.clearFailCounters).toHaveBeenCalledWith(
      'playerone',
      '203.0.113.8',
    );
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', tv: 7 }),
    );
    expect(out.token).toBe('jwt-token');
  });

  it('手工冻结状态只在密码正确后判断', async () => {
    loginLock.isLocked.mockReturnValue(true);

    await expect(
      service.login('playerone', 'correct-password', '203.0.113.8'),
    ).rejects.toThrow('账号已冻结');
    expect(mockedCompare).toHaveBeenCalledWith(
      'correct-password',
      'real-password-hash',
    );
    expect(loginLock.recordFailure).not.toHaveBeenCalled();
  });
});
