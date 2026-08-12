import { ForbiddenException } from '@nestjs/common';
import { stat, unlink } from 'node:fs/promises';
import { CsService } from './cs.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
  writeFile: jest.fn(),
}));

const mockedStat = jest.mocked(stat);
const mockedUnlink = jest.mocked(unlink);

describe('CsService 私有媒体读取', () => {
  const upload = {
    id: 'media-1234567890',
    ownerId: 'staff-1',
    playerId: null,
    mimeType: 'image/png',
    sizeBytes: 64,
    storageKey: 'staff-1/chat_1_aabbccddeeff.png',
    expiresAt: new Date(Date.now() + 60_000),
  };
  const prisma = {
    csUpload: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    csMessage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const config = {
    get: jest.fn(),
  };
  let service: CsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.csUpload.findUnique.mockResolvedValue(upload);
    prisma.csUpload.findMany.mockResolvedValue([]);
    prisma.csUpload.deleteMany.mockResolvedValue({ count: 1 });
    prisma.csMessage.findFirst.mockResolvedValue(null);
    prisma.csMessage.findMany.mockResolvedValue([]);
    config.get.mockReturnValue(undefined);
    mockedStat.mockResolvedValue({
      isFile: () => true,
      size: 64,
    } as never);
    mockedUnlink.mockResolvedValue(undefined);
    service = new CsService(
      prisma as never,
      config as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('上传者可读取自己的媒体，但响应数据只指向私有目录', async () => {
    const out = await service.openMedia(
      { id: 'staff-1', role: 'CS' },
      upload.id,
    );

    expect(out.path).toContain('private-uploads');
    expect(out).toEqual(
      expect.objectContaining({
        mimeType: 'image/png',
        sizeBytes: 64,
      }),
    );
  });

  it('未收到该图片的其他玩家不能读取', async () => {
    await expect(
      service.openMedia({ id: 'player-2', role: 'PLAYER' }, upload.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('玩家只能在自己的客服消息引用该 URL 后读取收款码', async () => {
    prisma.csMessage.findFirst.mockResolvedValue({ id: 'message-1' });

    await expect(
      service.openMedia({ id: 'player-1', role: 'PLAYER' }, upload.id),
    ).resolves.toEqual(expect.objectContaining({ mimeType: 'image/png' }));
    expect(prisma.csMessage.findFirst).toHaveBeenCalledWith({
      where: {
        playerId: 'player-1',
        text: { contains: '/api/cs/media/media-1234567890' },
      },
      select: { id: true },
    });
  });

  it('每日清理未发送孤儿与超过保留期的文件', async () => {
    prisma.csUpload.findMany.mockResolvedValue([
      { id: upload.id, storageKey: upload.storageKey },
    ]);

    await expect(service.cleanupExpiredMedia()).resolves.toBe(1);
    expect(mockedUnlink).toHaveBeenCalledWith(
      expect.stringContaining('chat_1_aabbccddeeff.png'),
    );
    expect(prisma.csUpload.deleteMany).toHaveBeenCalledWith({
      where: { id: upload.id },
    });
  });
});
