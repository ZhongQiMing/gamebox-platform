import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { LobbyService } from './lobby.service';

/** 一次最多聚合的游戏数：挡住有人拿几百个 code 把一个请求放大成几百次查询 */
const MAX_CODES = 40;

function positiveConfig(raw: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

const LOBBY_THROTTLE_LIMIT = positiveConfig(process.env.LOBBY_THROTTLE_LIMIT, 30, 1);
const LOBBY_THROTTLE_TTL_MS = positiveConfig(
  process.env.LOBBY_THROTTLE_TTL_MS,
  60_000,
  1_000,
);

function parseCodes(raw?: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const code = part.trim().toLowerCase();
    if (!code) continue;
    if (!/^[a-z0-9-]{1,40}$/.test(code)) {
      throw new BadRequestException('gameCode 参数无效');
    }
    seen.add(code);
  }
  return [...seen];
}

@Controller('lobby')
export class LobbyController {
  constructor(private readonly lobby: LobbyService) {}

  /**
   * GET /api/lobby/snapshot?lottery=ssc,ffc&table=zhajinhua,baccarat
   * 大厅一次拿齐所有卡片的期号 / 相位 / 上期开奖。
   */
  @Public()
  @Throttle({
    default: { limit: LOBBY_THROTTLE_LIMIT, ttl: LOBBY_THROTTLE_TTL_MS },
  })
  @Get('snapshot')
  snapshot(
    @Query('lottery') lottery?: string,
    @Query('table') table?: string,
  ) {
    const lotteryCodes = parseCodes(lottery);
    const tableCodes = parseCodes(table);
    if (lotteryCodes.length + tableCodes.length > MAX_CODES) {
      throw new BadRequestException(`gameCode 最多 ${MAX_CODES} 个`);
    }
    return this.lobby.snapshot(lotteryCodes, tableCodes);
  }
}
