import type { PrismaClient } from '@prisma/client';
import { CsService } from '../src/modules/cs/cs.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestPrisma,
  makeUser,
  wipeMoneyTables,
} from './db/money-test-kit';

function imageDataUrl(): string {
  const buf = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

let prisma: PrismaClient;
let service: CsService;

beforeAll(async () => {
  prisma = createTestPrisma();
  service = new CsService(
    prisma as unknown as PrismaService,
    { get: () => undefined } as never,
    { consumeFixedWindow: () => Promise.resolve(1) } as never,
    {} as never,
    {} as never,
  );
  await wipeMoneyTables(prisma);
});

afterAll(async () => {
  await wipeMoneyTables(prisma);
  await prisma.$disconnect();
});

describe('客服图片上传资格', () => {
  it('公开注册形态的无房间玩家不能直接上传', async () => {
    const playerId = await makeUser(prisma);

    await expect(
      service.saveUploadedImage(playerId, imageDataUrl(), 'chat', 'PLAYER_CHAT'),
    ).rejects.toThrow('请先加入房间并通过审核后再上传图片');
  });
});
