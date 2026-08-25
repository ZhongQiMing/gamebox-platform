/**
 * 回水规则：管理按游戏填总代/代理/玩家的下限·默认·上限。
 * 总代不能改「给总代」（合同点），只能改给代理、给玩家；
 * 代理不能改「给总代」「给代理」，只能改给玩家。
 * 操作一律是修改 → 填下限/默认/上限 → 保存，和后台同一张表。
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLogService } from '../admin/admin-log.service';
import {
  REBATE_RATE_HARD_MAX,
  parseRateInput,
  pctLabel,
  readPlatformBounds,
  resolveGamePackages,
  resolvePlayerBand,
  type PlatformRebateBounds,
} from '../rebate/rebate-chain';
import {
  clampRate,
  hydrateGameRebate,
  overlayDownlineRebate,
  readAgentGameLayerMap,
  readRawGameMap,
  rebateFallbackForCategory,
  shouldApplyCategoryTemplate,
  writeAgentGameLayers,
  writeGameRebateMap,
  gameRebateNineDiffer,
  type StoredGameRebate,
} from '../rebate/rebate-policy-games';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import { RETIRED_GAME_CODES } from '../games/retired-games';

export type RebateCanEdit = 'platform' | 'general' | 'agent' | 'none';

type GamePatch = Partial<StoredGameRebate> & {
  gameCode?: string;
  mineRate?: number;
};

type PatchBody = {
  generalMinRate?: number;
  generalMaxRate?: number;
  generalDefaultRate?: number;
  totalRate?: number;
  agentMinRate?: number;
  agentMaxRate?: number;
  agentDefaultRate?: number;
  playerMinRate?: number;
  playerMaxRate?: number;
  minRate?: number;
  maxRate?: number;
  games?: GamePatch[];
  gameCode?: string;
  mineRate?: number;
};

@Injectable()
export class ConsoleRebatePolicyService {
  constructor(
    private prisma: PrismaService,
    private scope: ConsoleScopeService,
    private adminLog: AdminLogService,
  ) {}

  private assertRate(v: number | undefined, label: string) {
    if (v == null) return;
    if (!Number.isFinite(v) || v < 0 || v > REBATE_RATE_HARD_MAX) {
      throw new BadRequestException(
        `${label}须在 0～${REBATE_RATE_HARD_MAX * 100}% 之间`,
      );
    }
  }

  async loadPlatform() {
    const row = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    return { row, platform: readPlatformBounds(row) };
  }

  async playerBandForRoom(roomId: string) {
    const { platform } = await this.loadPlatform();
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: {
        ownerAgent: { select: { flowRate: true, rebateRate: true } },
        generalAgent: {
          select: {
            flowRate: true,
            downlineFlowRate: true,
            playerMinRate: true,
            playerMaxRate: true,
          },
        },
      },
    });
    if (!room) throw new BadRequestException('房间不存在');
    const band = resolvePlayerBand({
      platform,
      general: room.generalAgent,
      agentFlowRate: room.ownerAgent?.flowRate,
    });
    return {
      platform,
      band,
      defaultPlayerRate: clampRate(
        Number(room.ownerAgent?.rebateRate ?? band.playerMin),
        band.playerMin,
        band.playerMax,
      ),
    };
  }

  private async canEditOf(actor: ConsoleActor): Promise<RebateCanEdit> {
    if (actor.role === 'ADMIN') return 'platform';
    if (await this.scope.isGeneralSide(actor)) return 'general';
    if (actor.role === 'AGENT') return 'agent';
    return 'none';
  }

  private gameRule(
    saved: Record<string, unknown>,
    code: string,
    category?: string | null,
  ): StoredGameRebate {
    return hydrateGameRebate(saved[code], rebateFallbackForCategory(category));
  }

  /** 缺档或还是旧的全站 1.8% 时，按彩票/电子类型写入默认三层框 */
  private async ensureCategoryTemplates() {
    const { row, platform } = await this.loadPlatform();
    const games = await this.prisma.game.findMany({
      where: { code: { notIn: [...RETIRED_GAME_CODES] } },
      select: { code: true, category: true },
    });
    const raw = readRawGameMap(row?.defaults);
    const next: Record<string, StoredGameRebate> = {};
    let changed = false;
    for (const g of games) {
      const code = String(g.code || '').trim().toLowerCase();
      if (!code) continue;
      if ((RETIRED_GAME_CODES as readonly string[]).includes(code)) continue;
      const fb = rebateFallbackForCategory(g.category);
      if (shouldApplyCategoryTemplate(raw[code], g.category)) {
        next[code] = hydrateGameRebate({}, fb);
        changed = true;
      } else {
        next[code] = hydrateGameRebate(raw[code], fb);
        if (gameRebateNineDiffer(raw[code], next[code])) changed = true;
      }
    }
    const platNeed =
      Math.abs(Number(row?.generalMinRate ?? 0) - 0.07) > 1e-9
      || Math.abs(Number(row?.agentMinRate ?? 0) - 0.03) > 1e-9
      || Math.abs(platform.playerMin - 0.01) > 1e-9
      || Math.abs(platform.agentDefault - 0.05) > 1e-9
      || Math.abs(platform.generalDefault - 0.07) > 1e-9;
    if (!changed && !platNeed) {
      return { row, platform };
    }
    const defaults = writeGameRebateMap(row?.defaults ?? {}, next);
    const saved = await this.prisma.rebatePolicy.upsert({
      where: { id: 1 },
      update: {
        generalMinRate: 0.07,
        generalMaxRate: 0.1,
        generalDefaultRate: 0.07,
        totalRate: 0.07,
        agentMinRate: 0.03,
        agentMaxRate: 0.07,
        agentDefaultRate: 0.05,
        playerMinRate: 0.01,
        playerMaxRate: 0.03,
        minRate: 0.01,
        maxRate: 0.03,
        defaults: defaults as Prisma.InputJsonValue,
      },
      create: {
        id: 1,
        generalMinRate: 0.07,
        generalMaxRate: 0.1,
        generalDefaultRate: 0.07,
        totalRate: 0.07,
        agentMinRate: 0.03,
        agentMaxRate: 0.07,
        agentDefaultRate: 0.05,
        playerMinRate: 0.01,
        playerMaxRate: 0.03,
        minRate: 0.01,
        maxRate: 0.03,
        defaults: defaults as Prisma.InputJsonValue,
      },
    });
    return { row: saved, platform: readPlatformBounds(saved) };
  }

  async getForActor(actor: ConsoleActor, roomId?: string) {
    const { row, platform } = await this.ensureCategoryTemplates();
    const canEdit = await this.canEditOf(actor);
    const saved = readRawGameMap(row?.defaults);
    const games = await this.prisma.game.findMany({
      where: { code: { notIn: [...RETIRED_GAME_CODES] } },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, category: true, status: true },
    });

    let generalLayers: Record<string, unknown> = {};
    let agentLayers: Record<string, unknown> = {};
    let hasGeneral = false;
    let mineUserId: string | null = null;

    if (roomId) {
      await this.scope.assertRoomAccess(actor, roomId);
      const room = await this.prisma.room.findUnique({
        where: { id: roomId },
        select: {
          ownerAgent: { select: { userId: true, gameRates: true } },
          generalAgent: { select: { userId: true, gameRates: true } },
        },
      });
      hasGeneral = !!room?.generalAgent;
      generalLayers = readAgentGameLayerMap(room?.generalAgent?.gameRates);
      agentLayers = readAgentGameLayerMap(room?.ownerAgent?.gameRates);
      mineUserId = room?.ownerAgent?.userId ?? null;
    } else if (canEdit === 'general' || actor.role === 'GENERAL') {
      const rootId = await this.scope.generalRootId(actor);
      const general = await this.prisma.agent.findUnique({
        where: { userId: rootId },
        select: { gameRates: true },
      });
      hasGeneral = true;
      generalLayers = readAgentGameLayerMap(general?.gameRates);
      mineUserId = rootId;
    } else if (actor.role === 'AGENT' || actor.role === 'PROXY') {
      const userId = actor.role === 'PROXY'
        ? await this.scope.scopeRootUserId(actor)
        : actor.id;
      const agent = await this.prisma.agent.findUnique({
        where: { userId },
        select: {
          gameRates: true,
          rooms: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              generalAgent: { select: { gameRates: true } },
            },
          },
        },
      });
      hasGeneral = !!agent?.rooms[0]?.generalAgent;
      generalLayers = readAgentGameLayerMap(agent?.rooms[0]?.generalAgent?.gameRates);
      agentLayers = readAgentGameLayerMap(agent?.gameRates);
      mineUserId = userId;
    }

    const editGeneral = canEdit === 'platform';
    const editAgent = canEdit === 'platform' || canEdit === 'general';
    const editPlayer = canEdit === 'platform' || canEdit === 'general' || canEdit === 'agent';

    const gameRows = games.map((g) => {
      const admin = this.gameRule(saved, g.code, g.category);
      const rule = overlayDownlineRebate(admin, generalLayers[g.code], agentLayers[g.code]);
      const playerCap = overlayDownlineRebate(admin, generalLayers[g.code], undefined);
      const pkg = resolveGamePackages({ game: rule, hasGeneral });
      const capAgentMax = Math.min(admin.agentMax, admin.generalDefault);
      return {
        gameCode: g.code,
        name: g.name,
        category: g.category,
        status: g.status,
        generalMin: rule.generalMin,
        generalDefault: rule.generalDefault,
        generalMax: rule.generalMax,
        agentMin: rule.agentMin,
        agentDefault: rule.agentDefault,
        agentMax: rule.agentMax,
        playerMin: rule.playerMin,
        playerDefault: rule.playerDefault,
        playerMax: rule.playerMax,
        adminGeneralMin: admin.generalMin,
        adminGeneralDefault: admin.generalDefault,
        adminGeneralMax: admin.generalMax,
        adminAgentMin: admin.agentMin,
        adminAgentDefault: admin.agentDefault,
        adminAgentMax: admin.agentMax,
        adminPlayerMin: admin.playerMin,
        adminPlayerDefault: admin.playerDefault,
        adminPlayerMax: admin.playerMax,
        capAgentMin: admin.agentMin,
        capAgentMax,
        capPlayerMin: canEdit === 'agent' ? playerCap.playerMin : admin.playerMin,
        capPlayerMax: canEdit === 'agent' ? playerCap.playerMax : admin.playerMax,
        editGeneral,
        editAgent,
        editPlayer,
        agentPkg: pkg.agentPkg,
        generalPkg: pkg.generalPkg,
        minRate: pkg.playerMin,
        maxRate: pkg.playerMax,
        playerRate: pkg.playerDefault,
      };
    });

    const first = gameRows[0];
    return {
      ...(row ?? { id: 1, defaults: {} }),
      generalMinRate: platform.generalMin,
      generalMaxRate: platform.generalMax,
      generalDefaultRate: platform.generalDefault,
      totalRate: platform.generalDefault,
      agentMinRate: platform.agentMin,
      agentMaxRate: platform.agentMax,
      agentDefaultRate: platform.agentDefault,
      playerMinRate: first?.playerMin ?? platform.playerMin,
      playerMaxRate: first?.playerMax ?? platform.playerMax,
      minRate: first?.playerMin ?? platform.playerMin,
      maxRate: first?.playerMax ?? platform.playerMax,
      games: gameRows,
      chain: {
        canEdit,
        platform,
        mine: mineUserId ? { userId: mineUserId } : null,
        downlines: [],
        effective: {
          agentPkg: first?.agentPkg ?? platform.agentDefault,
          generalPkg: first?.generalPkg ?? 0,
          playerMin: first?.playerMin ?? platform.playerMin,
          playerMax: first?.playerMax ?? platform.playerMax,
          defaultPlayerRate: first?.playerDefault ?? platform.playerMin,
        },
      },
    };
  }

  async patchForActor(actor: ConsoleActor, body: PatchBody) {
    const canEdit = await this.canEditOf(actor);
    if (canEdit === 'platform') return this.patchPlatform(actor, body);
    if (canEdit === 'general') return this.patchDownline(actor, body, 'general');
    if (canEdit === 'agent') return this.patchDownline(actor, body, 'agent');
    throw new ForbiddenException('当前角色不能改回水规则');
  }

  private assertGameRule(g: StoredGameRebate, label: string) {
    this.assertRate(g.generalMin, `${label} 总代下限`);
    this.assertRate(g.generalMax, `${label} 总代上限`);
    this.assertRate(g.generalDefault, `${label} 总代默认`);
    this.assertRate(g.agentMin, `${label} 代理下限`);
    this.assertRate(g.agentMax, `${label} 代理上限`);
    this.assertRate(g.agentDefault, `${label} 代理默认`);
    this.assertRate(g.playerMin, `${label} 玩家下限`);
    this.assertRate(g.playerMax, `${label} 玩家上限`);
    this.assertRate(g.playerDefault, `${label} 玩家默认`);
    if (g.generalMin > g.generalMax + 1e-9) {
      throw new BadRequestException(`${label} 总代下限不能高于上限`);
    }
    if (g.generalDefault < g.generalMin - 1e-9 || g.generalDefault > g.generalMax + 1e-9) {
      throw new BadRequestException(`${label} 总代默认须在下限～上限之间`);
    }
    if (g.agentMin > g.agentMax + 1e-9) {
      throw new BadRequestException(`${label} 代理下限不能高于上限`);
    }
    if (g.agentMax > g.generalDefault + 1e-9) {
      throw new BadRequestException(`${label} 代理上限不能超过总代默认`);
    }
    if (g.agentMin + 1e-9 < g.playerMax) {
      throw new BadRequestException(`${label} 代理下限不能低于玩家上限`);
    }
    if (g.generalMin + 1e-9 < g.agentMax) {
      throw new BadRequestException(`${label} 总代下限不能低于代理上限`);
    }
    if (g.agentDefault < g.agentMin - 1e-9 || g.agentDefault > g.agentMax + 1e-9) {
      throw new BadRequestException(`${label} 代理默认须在下限～上限之间`);
    }
    if (g.playerMin > g.playerMax + 1e-9) {
      throw new BadRequestException(`${label} 玩家下限不能高于上限`);
    }
    if (g.playerMax > g.agentDefault + 1e-9) {
      throw new BadRequestException(`${label} 玩家上限不能超过代理默认`);
    }
    if (g.playerDefault < g.playerMin - 1e-9 || g.playerDefault > g.playerMax + 1e-9) {
      throw new BadRequestException(`${label} 玩家默认须在下限～上限之间`);
    }
  }

  private async patchPlatform(actor: ConsoleActor, body: PatchBody) {
    const { row, platform: cur } = await this.loadPlatform();
    const raw = readRawGameMap(row?.defaults);
    const catRows = await this.prisma.game.findMany({
      where: { code: { notIn: [...RETIRED_GAME_CODES] } },
      select: { code: true, category: true },
    });
    const catOf = Object.fromEntries(
      catRows.map((g) => [String(g.code).trim().toLowerCase(), g.category]),
    );
    let defaults: Record<string, unknown> = (row?.defaults ?? {}) as Record<string, unknown>;
    if (Array.isArray(body.games) && body.games.length) {
      const map: Record<string, StoredGameRebate> = {};
      for (const [code, item] of Object.entries(raw)) {
        map[code] = hydrateGameRebate(item, rebateFallbackForCategory(catOf[code]));
      }
      for (const item of body.games) {
        const code = String(item?.gameCode || '').trim().toLowerCase();
        if (!code) continue;
        const prev = raw[code] && typeof raw[code] === 'object'
          ? (raw[code] as Record<string, unknown>)
          : {};
        const next = hydrateGameRebate({ ...prev, ...item }, rebateFallbackForCategory(catOf[code]));
        this.assertGameRule(next, code);
        map[code] = next;
      }
      defaults = writeGameRebateMap(row?.defaults ?? {}, map);
    }

    const nextPlat: PlatformRebateBounds = {
      generalMin: parseRateInput(body.generalMinRate, cur.generalMin),
      generalMax: parseRateInput(body.generalMaxRate, cur.generalMax),
      generalDefault: parseRateInput(
        body.generalDefaultRate ?? body.totalRate,
        cur.generalDefault,
      ),
      agentMin: parseRateInput(body.agentMinRate, cur.agentMin),
      agentMax: parseRateInput(body.agentMaxRate, cur.agentMax),
      agentDefault: parseRateInput(body.agentDefaultRate, cur.agentDefault),
      playerMin: parseRateInput(body.playerMinRate ?? body.minRate, cur.playerMin),
      playerMax: parseRateInput(body.playerMaxRate ?? body.maxRate, cur.playerMax),
    };

    const saved = await this.prisma.rebatePolicy.upsert({
      where: { id: 1 },
      update: {
        generalMinRate: nextPlat.generalMin,
        generalMaxRate: nextPlat.generalMax,
        generalDefaultRate: nextPlat.generalDefault,
        totalRate: nextPlat.generalDefault,
        agentMinRate: nextPlat.agentMin,
        agentMaxRate: nextPlat.agentMax,
        agentDefaultRate: nextPlat.agentDefault,
        playerMinRate: nextPlat.playerMin,
        playerMaxRate: nextPlat.playerMax,
        minRate: nextPlat.playerMin,
        maxRate: nextPlat.playerMax,
        defaults: defaults as Prisma.InputJsonValue,
      },
      create: {
        id: 1,
        generalMinRate: nextPlat.generalMin,
        generalMaxRate: nextPlat.generalMax,
        generalDefaultRate: nextPlat.generalDefault,
        totalRate: nextPlat.generalDefault,
        agentMinRate: nextPlat.agentMin,
        agentMaxRate: nextPlat.agentMax,
        agentDefaultRate: nextPlat.agentDefault,
        playerMinRate: nextPlat.playerMin,
        playerMaxRate: nextPlat.playerMax,
        minRate: nextPlat.playerMin,
        maxRate: nextPlat.playerMax,
        defaults: defaults as Prisma.InputJsonValue,
      },
    });
    await this.adminLog.log(actor.id, 'REBATE_POLICY', '1', {
      games: body.games?.map((g) => g.gameCode) ?? [],
    });
    return saved;
  }

  private pickPlayerFields(item: GamePatch, fallback: StoredGameRebate) {
    return {
      playerMin: item.playerMin ?? fallback.playerMin,
      playerDefault: item.playerDefault ?? fallback.playerDefault,
      playerMax: item.playerMax ?? fallback.playerMax,
    };
  }

  private pickAgentPlayerFields(item: GamePatch, fallback: StoredGameRebate) {
    return {
      agentMin: item.agentMin ?? fallback.agentMin,
      agentDefault: item.agentDefault ?? fallback.agentDefault,
      agentMax: item.agentMax ?? fallback.agentMax,
      ...this.pickPlayerFields(item, fallback),
    };
  }

  private async patchDownline(
    actor: ConsoleActor,
    body: PatchBody,
    kind: 'general' | 'agent',
  ) {
    const userId = kind === 'general' ? await this.scope.generalRootId(actor) : actor.id;
    const { row } = await this.loadPlatform();
    const raw = readRawGameMap(row?.defaults);
    const patches = (body.games ?? []).filter((g) => String(g?.gameCode || '').trim());
    if (!patches.length) throw new BadRequestException('请填写要保存的游戏');

    const agent = await this.prisma.agent.findUnique({
      where: { userId },
      select: {
        gameRates: true,
        rooms: {
          take: 1,
          orderBy: { createdAt: 'desc' as const },
          select: { generalAgent: { select: { gameRates: true } } },
        },
      },
    });
    if (!agent) throw new BadRequestException(kind === 'general' ? '总代档案不存在' : '代理档案不存在');
    const generalLayers = kind === 'agent'
      ? readAgentGameLayerMap(agent.rooms[0]?.generalAgent?.gameRates)
      : {};
    const catRows = await this.prisma.game.findMany({
      where: { code: { in: patches.map((p) => String(p.gameCode || '').trim().toLowerCase()) } },
      select: { code: true, category: true },
    });
    const catOf = Object.fromEntries(
      catRows.map((g) => [String(g.code).trim().toLowerCase(), g.category]),
    );
    const nextPatch: Record<string, Record<string, number>> = {};
    for (const item of patches) {
      const code = String(item.gameCode || '').trim().toLowerCase();
      if (!code) continue;
      const admin = this.gameRule(raw, code, catOf[code]);
      if (kind === 'general') {
        const next = hydrateGameRebate(
          { ...admin, ...this.pickAgentPlayerFields(item, admin) },
          admin,
        );
        next.generalMin = admin.generalMin;
        next.generalDefault = admin.generalDefault;
        next.generalMax = admin.generalMax;
        const agentCap = Math.min(admin.agentMax, admin.generalDefault);
        if (next.agentMin < Math.max(admin.agentMin, next.playerMax) - 1e-9) {
          throw new BadRequestException(`${code} 代理下限不能低于玩家上限 ${pctLabel(next.playerMax)}`);
        }
        if (next.agentMax > agentCap + 1e-9) {
          throw new BadRequestException(`${code} 代理上限不能超过总代 ${pctLabel(agentCap)}`);
        }
        if (next.playerMin < admin.playerMin - 1e-9) {
          throw new BadRequestException(`${code} 玩家下限不能低于管理下限 ${pctLabel(admin.playerMin)}`);
        }
        if (next.playerMax > admin.playerMax + 1e-9) {
          throw new BadRequestException(`${code} 玩家上限不能超过管理上限 ${pctLabel(admin.playerMax)}`);
        }
        this.assertGameRule(next, code);
        nextPatch[code] = {
          agentMin: next.agentMin,
          agentDefault: next.agentDefault,
          agentMax: next.agentMax,
          playerMin: next.playerMin,
          playerDefault: next.playerDefault,
          playerMax: next.playerMax,
        };
      } else {
        const parent = overlayDownlineRebate(admin, generalLayers[code], undefined);
        const next = hydrateGameRebate(
          { ...parent, ...this.pickPlayerFields(item, parent) },
          parent,
        );
        next.generalMin = parent.generalMin;
        next.generalDefault = parent.generalDefault;
        next.generalMax = parent.generalMax;
        next.agentMin = parent.agentMin;
        next.agentDefault = parent.agentDefault;
        next.agentMax = parent.agentMax;
        if (next.playerMin < parent.playerMin - 1e-9) {
          throw new BadRequestException(`${code} 玩家下限不能低于 ${pctLabel(parent.playerMin)}`);
        }
        if (next.playerMax > parent.playerMax + 1e-9) {
          throw new BadRequestException(`${code} 玩家上限不能超过 ${pctLabel(parent.playerMax)}`);
        }
        this.assertGameRule(next, code);
        nextPatch[code] = {
          playerMin: next.playerMin,
          playerDefault: next.playerDefault,
          playerMax: next.playerMax,
        };
      }
    }
    const gameRates = writeAgentGameLayers(agent.gameRates, nextPatch);
    await this.prisma.agent.update({
      where: { userId },
      data: { gameRates: gameRates as Prisma.InputJsonValue },
    });
    await this.adminLog.log(actor.id, 'REBATE_POLICY_DOWNLINE', userId, {
      kind,
      games: Object.keys(nextPatch),
    });
    return this.getForActor(actor);
  }
}
