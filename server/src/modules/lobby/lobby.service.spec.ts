import { BadRequestException } from '@nestjs/common';
import { LobbyController } from './lobby.controller';
import { LobbyService } from './lobby.service';

describe('大厅聚合资源保护', () => {
  it('同实例同键并发只执行一组底层查询，Redis 故障可降级', async () => {
    const lottery = {
      currentIssue: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { issueNo: '1' };
      }),
      history: jest.fn().mockResolvedValue([{ issueNo: '0', drawNumbers: '1,2,3' }]),
    };
    const table = { snapshot: jest.fn().mockResolvedValue({ phase: 'BETTING' }) };
    const redis = {
      get: jest.fn().mockRejectedValue(new Error('redis unavailable')),
      tryLock: jest.fn().mockRejectedValue(new Error('redis unavailable')),
      set: jest.fn().mockRejectedValue(new Error('redis unavailable')),
      releaseLock: jest.fn(),
    };
    const service = new LobbyService(lottery as never, table as never, redis as never);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => service.snapshot(['ssc'], ['baccarat'])),
    );

    expect(results).toHaveLength(6);
    expect(lottery.currentIssue).toHaveBeenCalledTimes(1);
    expect(lottery.history).toHaveBeenCalledTimes(1);
    expect(table.snapshot).toHaveBeenCalledTimes(1);
  });

  it('参数统一小写去重，且彩票与牌桌合计最多 40 个 code', async () => {
    const lobby = { snapshot: jest.fn().mockResolvedValue({}) };
    const controller = new LobbyController(lobby as never);
    await controller.snapshot(' SSC,ssc,FfC ', 'Baccarat,baccarat');
    expect(lobby.snapshot).toHaveBeenCalledWith(['ssc', 'ffc'], ['baccarat']);

    const tooMany = Array.from({ length: 41 }, (_, i) => `g${i}`).join(',');
    expect(() => controller.snapshot(tooMany, undefined)).toThrow(BadRequestException);
    expect(() => controller.snapshot('ssc,$bad', undefined)).toThrow(BadRequestException);
    const repeatedAcrossCategories = Array.from({ length: 21 }, (_, i) => `same${i}`).join(',');
    expect(() =>
      controller.snapshot(repeatedAcrossCategories, repeatedAcrossCategories),
    ).toThrow(BadRequestException);
  });
});
