import {
  Controller, Get, Patch, Post, Param, Body, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminLogService } from './admin-log.service';
import { GameOpsScheduler } from './game-ops.scheduler';
import { GameConfigCache } from '../game-core/game-config.cache';
import { validateGamePayTable } from '../game-core/game-config.validator';
import { RETIRED_GAME_CODES } from '../games/retired-games';

@Controller('admin/games')
@Roles('ADMIN')
export class GameAdminController {
  constructor(
    private prisma: PrismaService,
    private adminLog: AdminLogService,
    private configCache: GameConfigCache,
    private gameOps: GameOpsScheduler,
  ) {}

  /** 已下线目录（代码已移除，DB 若仍残留则列表中隐藏）；名单与大厅/引擎共用 */
  private static readonly RETIRED_CODES = RETIRED_GAME_CODES;

  /** 游戏列表（含所有配置版本） */
  @Get()
  async list() {
    return this.prisma.game.findMany({
      where: { code: { notIn: [...GameAdminController.RETIRED_CODES] } },
      orderBy: { sortOrder: 'asc' },
      include: {
        configs: {
          select: { id: true, version: true, rtp: true, active: true },
          orderBy: { version: 'desc' },
        },
      },
    });
  }

  /** 平台定时运维规则（日切 / 每日维护窗） */
  @Get('ops-schedule')
  opsSchedule() {
    return this.gameOps.getScheduleInfo();
  }

  /** 手动结束卡死的全站维护，把维护中的游戏全部恢复上架 */
  @Post('restore-online')
  async restoreOnline() {
    const result = await this.gameOps.forceRestoreAllOnline();
    return { ok: true, ...result };
  }

  /**
   * 大厅排序：按 codes 数组顺序写成 1..N（不用手填数字）
   * body: { codes: string[] } 须覆盖全部未下线目录游戏
   */
  @Post('reorder')
  async reorder(
    @Body('codes') codes: unknown,
    @CurrentUser() user: { id: string },
  ) {
    if (!Array.isArray(codes) || !codes.length || codes.some((c) => typeof c !== 'string')) {
      throw new BadRequestException('codes 无效');
    }
    const list = codes as string[];
    const uniq = new Set(list);
    if (uniq.size !== list.length) throw new BadRequestException('codes 有重复');

    const existing = await this.prisma.game.findMany({
      where: { code: { notIn: [...GameAdminController.RETIRED_CODES] } },
      select: { code: true },
    });
    const expect = new Set(existing.map((g) => g.code));
    if (list.length !== expect.size || list.some((c) => !expect.has(c))) {
      throw new BadRequestException('请提交完整游戏列表顺序');
    }

    await this.prisma.$transaction(
      list.map((code, i) =>
        this.prisma.game.update({ where: { code }, data: { sortOrder: i + 1 } }),
      ),
    );
    this.configCache.invalidateAll();
    await this.adminLog.log(user.id, 'GAME_REORDER', list.join(','), { codes: list });
    return { ok: true };
  }

  /** 上下架 / 维护 */
  @Patch(':code/status')
  async setStatus(
    @Param('code') code: string,
    @Body('status') status: string,
    @CurrentUser() user: { id: string },
  ) {
    if (!['ONLINE', 'OFFLINE', 'MAINTENANCE'].includes(status)) {
      throw new BadRequestException('无效状态');
    }
    const game = await this.prisma.game.findUnique({ where: { code } });
    if (!game) throw new NotFoundException('游戏不存在');

    if (status === 'ONLINE') {
      const active = await this.prisma.gameConfig.findFirst({
        where: { gameId: game.id, active: true },
        select: { id: true },
      });
      if (!active) {
        throw new BadRequestException('请先配置并激活爆率，再上架');
      }
    }

    await this.prisma.game.update({ where: { code }, data: { status: status as never } });
    this.configCache.invalidate(code);
    await this.adminLog.log(user.id, 'GAME_STATUS_CHANGE', code, { from: game.status, to: status });
    return { ok: true };
  }

  /** 基础参数：限红、排序 */
  @Patch(':code')
  async updateBasics(
    @Param('code') code: string,
    @Body()
    body: { minBet?: number; maxBet?: number; sortOrder?: number; name?: string },
    @CurrentUser() user: { id: string },
  ) {
    const game = await this.prisma.game.findUnique({ where: { code } });
    if (!game) throw new NotFoundException('游戏不存在');

    const data: {
      minBet?: number;
      maxBet?: number;
      sortOrder?: number;
      name?: string;
    } = {};

    if (body.minBet != null) {
      const n = Number(body.minBet);
      if (!Number.isFinite(n) || n <= 0) throw new BadRequestException('最小下注无效');
      data.minBet = n;
    }
    if (body.maxBet != null) {
      const n = Number(body.maxBet);
      if (!Number.isFinite(n) || n <= 0) throw new BadRequestException('最大下注无效');
      data.maxBet = n;
    }
    if (data.minBet != null && data.maxBet != null && data.minBet > data.maxBet) {
      throw new BadRequestException('最小下注不能大于最大下注');
    }
    if (data.minBet != null && data.maxBet == null && data.minBet > Number(game.maxBet)) {
      throw new BadRequestException('最小下注不能大于当前最大下注');
    }
    if (data.maxBet != null && data.minBet == null && data.maxBet < Number(game.minBet)) {
      throw new BadRequestException('最大下注不能小于当前最小下注');
    }
    if (body.sortOrder != null) {
      const n = Math.floor(Number(body.sortOrder));
      if (!Number.isFinite(n)) throw new BadRequestException('排序无效');
      data.sortOrder = n;
    }
    if (typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim().slice(0, 40);
    }
    if (!Object.keys(data).length) throw new BadRequestException('无有效字段');

    await this.prisma.game.update({ where: { code }, data: data as never });
    this.configCache.invalidate(code);
    await this.adminLog.log(user.id, 'GAME_BASICS_UPDATE', code, data);
    return { ok: true };
  }

  /** 查某游戏所有配置版本 */
  @Get(':code/configs')
  async listConfigs(@Param('code') code: string) {
    const game = await this.prisma.game.findUnique({ where: { code } });
    if (!game) throw new NotFoundException('游戏不存在');
    return this.prisma.gameConfig.findMany({
      where: { gameId: game.id },
      orderBy: { version: 'desc' },
    });
  }

  /** 新建爆率配置版本并激活 */
  @Post(':code/config')
  async createConfig(
    @Param('code') code: string,
    @Body() body: { rtp: number; payTable: unknown },
    @CurrentUser() user: { id: string },
  ) {
    const game = await this.prisma.game.findUnique({ where: { code } });
    if (!game) throw new NotFoundException('游戏不存在');
    if (body.rtp <= 0 || body.rtp >= 1) throw new BadRequestException('RTP 须在 0~1 之间');
    validateGamePayTable(game, body.payTable);

    // 最新版本号 + 1
    const last = await this.prisma.gameConfig.findFirst({
      where: { gameId: game.id }, orderBy: { version: 'desc' },
    });
    const newVersion = (last?.version ?? 0) + 1;

    await this.prisma.$transaction([
      this.prisma.gameConfig.updateMany({ where: { gameId: game.id, active: true }, data: { active: false } }),
      this.prisma.gameConfig.create({
        data: { gameId: game.id, version: newVersion, active: true, rtp: body.rtp, payTable: body.payTable as never },
      }),
    ]);

    this.configCache.invalidate(code);
    await this.adminLog.log(user.id, 'GAME_CONFIG_UPDATE', code, { version: newVersion, rtp: body.rtp });
    return { ok: true, version: newVersion };
  }

  /** 激活历史配置版本 */
  @Patch(':code/config/:version/activate')
  async activateConfig(
    @Param('code') code: string,
    @Param('version') versionStr: string,
    @CurrentUser() user: { id: string },
  ) {
    const version = parseInt(versionStr);
    const game = await this.prisma.game.findUnique({ where: { code } });
    if (!game) throw new NotFoundException('游戏不存在');

    const config = await this.prisma.gameConfig.findFirst({ where: { gameId: game.id, version } });
    if (!config) throw new NotFoundException('版本不存在');

    await this.prisma.$transaction([
      this.prisma.gameConfig.updateMany({ where: { gameId: game.id, active: true }, data: { active: false } }),
      this.prisma.gameConfig.update({ where: { id: config.id }, data: { active: true } }),
    ]);

    this.configCache.invalidate(code);
    await this.adminLog.log(user.id, 'GAME_CONFIG_ACTIVATE', code, { version });
    return { ok: true };
  }
}
