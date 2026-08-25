import { ForbiddenException, HttpException } from '@nestjs/common';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { CsService } from './cs.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
  writeFile: jest.fn(),
}));

const mockedMkdir = jest.mocked(mkdir);
const mockedStat = jest.mocked(stat);
const mockedUnlink = jest.mocked(unlink);
const mockedWriteFile = jest.mocked(writeFile);

function imageDataUrl(size = 64): string {
  const buf = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

describe('CsService 图片上传防护', () => {
  const prisma = {
    roomMember: {
      findFirst: jest.fn(),
    },
    csUpload: {
      create: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const config = {
    get: jest.fn(),
  };
  const redis = {
    consumeFixedWindow: jest.fn(),
  };
  let service: CsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.roomMember.findFirst.mockResolvedValue({ id: 'member-1' });
    config.get.mockReturnValue(undefined);
    redis.consumeFixedWindow.mockResolvedValue(1);
    mockedMkdir.mockResolvedValue(undefined);
    mockedStat.mockResolvedValue({
      isFile: () => true,
      size: 64,
    } as never);
    mockedUnlink.mockResolvedValue(undefined);
    mockedWriteFile.mockResolvedValue(undefined);
    prisma.csUpload.create.mockResolvedValue({ id: 'media-1234567890' });
    prisma.csUpload.findMany.mockResolvedValue([]);
    prisma.csUpload.updateMany.mockResolvedValue({ count: 0 });
    service = new CsService(
      prisma as never,
      config as never,
      redis as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('未通过房间审核的注册玩家不能上传', async () => {
    prisma.roomMember.findFirst.mockResolvedValue(null);

    await expect(
      service.saveUploadedImage('player-1', imageDataUrl(), 'chat', 'PLAYER_CHAT'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(redis.consumeFixedWindow).not.toHaveBeenCalled();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('合法玩家聊天图走日配额并异步落盘', async () => {
    const out = await service.saveUploadedImage(
      'player-1',
      imageDataUrl(),
      'chat',
      'PLAYER_CHAT',
    );

    expect(out.url).toBe('/api/cs/media/media-1234567890');
    expect(redis.consumeFixedWindow).toHaveBeenCalledWith(
      'cs:upload:24h:player:player-1',
      86_400,
    );
    expect(mockedMkdir).toHaveBeenCalledWith(
      expect.stringContaining('uploads'),
      { recursive: true },
    );
    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('private-uploads'),
      expect.any(Buffer),
      { flag: 'wx' },
    );
    expect(prisma.csUpload.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: 'player-1',
        playerId: 'player-1',
        policy: 'PLAYER_CHAT',
        mimeType: 'image/png',
        sizeBytes: 64,
      }),
      select: { id: true },
    });
  });

  it('玩家聊天图超过 2MB 时在计配额和写盘前拒绝', async () => {
    await expect(
      service.saveUploadedImage(
        'player-1',
        imageDataUrl(2 * 1024 * 1024 + 1),
        'chat',
        'PLAYER_CHAT',
      ),
    ).rejects.toThrow('图片请小于 2MB');
    expect(redis.consumeFixedWindow).not.toHaveBeenCalled();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('伪造 MIME 但没有真实图片 magic bytes 时拒绝', async () => {
    const buf = Buffer.alloc(64, 0x41);
    const url = `data:image/png;base64,${buf.toString('base64')}`;

    await expect(
      service.saveUploadedImage('player-1', url, 'chat', 'PLAYER_CHAT'),
    ).rejects.toThrow('文件不是有效图片');
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('超过玩家日配额时返回 429', async () => {
    redis.consumeFixedWindow.mockResolvedValue(11);

    let error: unknown;
    try {
      await service.saveUploadedImage('player-1', imageDataUrl(), 'chat', 'PLAYER_CHAT');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('Redis 配额不可用时 fail closed，不写文件', async () => {
    redis.consumeFixedWindow.mockRejectedValue(new Error('redis unavailable'));

    let error: unknown;
    try {
      await service.saveUploadedImage('player-1', imageDataUrl(), 'chat', 'PLAYER_CHAT');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('文件系统写入失败不会返回成功 URL', async () => {
    mockedWriteFile.mockRejectedValue(new Error('disk full'));

    await expect(
      service.saveUploadedImage('player-1', imageDataUrl(), 'chat', 'PLAYER_CHAT'),
    ).rejects.toThrow('disk full');
    expect(prisma.csUpload.create).not.toHaveBeenCalled();
  });

  it('元数据写入失败时删除已经落盘的孤儿文件', async () => {
    prisma.csUpload.create.mockRejectedValue(new Error('database unavailable'));

    await expect(
      service.saveUploadedImage('player-1', imageDataUrl(), 'chat', 'PLAYER_CHAT'),
    ).rejects.toThrow('database unavailable');
    expect(mockedUnlink).toHaveBeenCalledWith(
      expect.stringContaining('private-uploads'),
    );
  });
});
