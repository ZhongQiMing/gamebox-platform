/**
 * 飞盘：解析下注对手盘、读取返水比例。
 * 现金/信用同一套：开关开且盘分可飞 ≥ 本注额 → 飞平台；不足则本注关盘、代理坐庄。
 * 飞盘单笔输赢只动玩家↔平台，不改代理盘分（算法 A）。
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID, type OwnerType } from '../points/points.service';
import { agentFlyAvailable, generalTreeFlyAvailable } from './credit-settle.helper';

/** 可飞额度缓存有效期；下注判断容许这个量级的滞后 */
const FLY_CACHE_TTL_MS = Math.max(
  0,
  Math.floor(Number(process.env.FLY_AVAILABLE_CACHE_MS ?? 500)),
);
/** 缓存条目上限，防止代理数量很多时无界增长 */
const FLY_CACHE_MAX = 5000;
import {
  bandForRoomGame,
  readPlatformBounds,
  resolvePayoutRates,
  resolvePlayerBand,
} from '../rebate/rebate-chain';

export type FlyHouse = {
  type: OwnerType;
  id: string;
  flying: boolean;
  roomId?: string;
  agentUserId?: string;
  /** 总代 userId（房间挂了总代时） */
  generalUserId?: string;
  /** CASH | CREDIT；关盘结算分支用 */
  bookMode?: string;
  /** 谁坐庄：PLATFORM=飞上台  GENERAL=总代关  AGENT=代理关 */
  sitting?: 'PLATFORM' | 'GENERAL' | 'AGENT';
};

@Injectable()
export class FlyDiskService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
  ) {}

  /**
   * 可飞额度的进程内短缓存。
   *
   * 这个数要聚合「名下房间全部玩家持分」，一间几千人的房每次都算就是几千行扫描，
   * 而它在每笔下注的判断路径上。缓存一小段时间换掉这个开销。
   *
   * 代价：额度最多旧这么久，极端情况下会多飞出一点点。可以接受——它是风险闸门
   * 而不是余额，差几百毫秒的量级远小于单注限红；真正兜底的是限红与软控。
   */
  private readonly flyCache = new Map<string, { at: number; value: number }>();

  /** 上盘可飞 = 代理盘分 + 客服未发出 + 名下房间玩家持分（见 agentFlyAvailable） */
  async flyAvailable(
    tx: Prisma.TransactionClient | PrismaService,
    agentUserId: string,
    bookMode: 'CASH' | 'CREDIT',
  ): Promise<number> {
    return agentFlyAvailable(tx, agentUserId, bookMode);
  }

  /** 带缓存版本，只给下注判断用；后台展示与结算一律读实时值 */
  private async flyAvailableCached(
    agentUserId: string,
    bookMode: 'CASH' | 'CREDIT',
  ): Promise<number> {
    return this.cached(`A:${bookMode}:${agentUserId}`, () =>
      agentFlyAvailable(this.prisma, agentUserId, bookMode),
    );
  }

  /**
   * 整棵总代树，同样只给下注判断用。
   *
   * 不带盘种参数：树里每一格用各自的盘种（总代用自己与平台的约定，
   * 每个代理用其房间的约定），由 SQL 内部决定。
   */
  private async treeFlyAvailableCached(generalUserId: string): Promise<number> {
    return this.cached(`G:${generalUserId}`, () =>
      generalTreeFlyAvailable(this.prisma, generalUserId),
    );
  }

  private async cached(key: string, load: () => Promise<number>): Promise<number> {
    const hit = this.flyCache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < FLY_CACHE_TTL_MS) return hit.value;
    const value = await load();
    this.flyCache.set(key, { at: now, value });
    /* 缓存只是省查询，不能变成内存泄漏：超量就整体丢掉重来 */
    if (this.flyCache.size > FLY_CACHE_MAX) this.flyCache.clear();
    return value;
  }

  private readonly roomInclude = {
    bookMode: true,
    generalFlyEnabled: true,
    ownerAgent: {
      select: {
        id: true,
        userId: true,
        rebateRate: true,
        flowRate: true,
        shareRate: true,
        pointsQuota: true,
        gameRates: true,
      },
    },
    generalAgent: {
      select: {
        id: true,
        userId: true,
        flowRate: true,
        shareRate: true,
        pointsQuota: true,
        downlineFlowRate: true,
        playerMinRate: true,
        playerMaxRate: true,
        gameRates: true,
      },
    },
  } as const;

  /**
   * 下注/资金路径：6 位房间号 → 运营房间 id，并校验 APPROVED 成员。
   * 多房玩家必须显式指定房间，禁止按 updatedAt 猜房。
   */
  async requireOpsRoomId(playerId: string, roomNoRaw?: string | null): Promise<string> {
    const roomNo = String(roomNoRaw || '').trim();
    if (!/^\d{6}$/.test(roomNo)) {
      throw new BadRequestException('请先进入房间再下注');
    }
    const room = await this.prisma.room.findUnique({
      where: { roomNo },
      select: { id: true, status: true },
    });
    if (!room || room.status !== 'OPEN') {
      throw new BadRequestException('房间不存在或已关闭');
    }
    const member = await this.prisma.roomMember.findFirst({
      where: { playerId, roomId: room.id, status: 'APPROVED' },
      select: { id: true },
    });
    if (!member) {
      throw new BadRequestException('您不在该房间或尚未通过审核');
    }
    return room.id;
  }

  /**
   * 玩家运营房间成员。
   * - preferredRoomId 有值：只认该房（不在房则 null）
   * - required=true：无 preferred 或不在房直接抛错（下注路径）
   * - required=false 且无 preferred：仅控制台非资金展示可回退「最近房」（勿用于下注）
   */
  async resolvePlayerRoom(
    playerId: string,
    preferredRoomId?: string,
    opts?: { required?: boolean },
  ) {
    const required = !!opts?.required;
    if (preferredRoomId) {
      const m = await this.prisma.roomMember.findFirst({
        where: { playerId, roomId: preferredRoomId, status: 'APPROVED' },
        include: { room: { select: this.roomInclude } },
      });
      if (m) return m;
      if (required) {
        throw new BadRequestException('您不在该房间或尚未通过审核');
      }
      return null;
    }
    if (required) {
      throw new BadRequestException('请先进入房间再下注');
    }
    return this.prisma.roomMember.findFirst({
      where: { playerId, status: 'APPROVED', room: { ownerAgentId: { not: null } } },
      orderBy: { updatedAt: 'desc' },
      include: { room: { select: this.roomInclude } },
    });
  }

  /**
   * 飞盘开 → 平台盘口池；关盘 → 房间绑定代理
   * - 现金/信用：开关开且盘分可飞 ≥ 本注额；不足则本注关盘、代理坐庄
   * - 未传 stakeAmount 时：可飞 > 0 即视为可飞（仅供非下注查询）
   * - requireRoom=true（下注默认）：必须带运营房间 id，禁止猜房
   */
  async resolveHouse(
    playerId: string,
    preferredRoomId?: string,
    stakeAmount?: number,
    opts?: { requireRoom?: boolean },
  ): Promise<FlyHouse> {
    const requireRoom = !!opts?.requireRoom;
    if (requireRoom && !preferredRoomId) {
      throw new BadRequestException('请先进入房间再下注');
    }
    const member = await this.resolvePlayerRoom(playerId, preferredRoomId, { required: requireRoom });
    if (!member?.room?.ownerAgent) {
      if (requireRoom) {
        throw new BadRequestException('房间未绑定代理，无法下注');
      }
      return { type: 'PLATFORM', id: PLATFORM_OWNER_ID, flying: false };
    }
    const agent = member.room.ownerAgent;
    const general = member.room.generalAgent;
    const isCredit = member.room.bookMode === 'CREDIT';
    const bookMode = isCredit ? 'CREDIT' : 'CASH';
    const agentFlyOn = member.flyEnabled !== false;
    const generalUserId = general?.userId;
    const base = {
      roomId: member.roomId,
      agentUserId: agent.userId,
      generalUserId,
      bookMode,
    };

    /* 代理整房关或单玩家关 → 代理坐庄 */
    if (!agentFlyOn) {
      return { type: 'AGENT', id: agent.userId, flying: false, sitting: 'AGENT', ...base };
    }

    /* 代理开、总代整房关 → 总代坐庄 */
    if (generalUserId && member.room.generalFlyEnabled === false) {
      return { type: 'AGENT', id: generalUserId, flying: false, sitting: 'GENERAL', ...base };
    }

    /*
     * 一层一层往上飞，每一层只拿自己的钱冒险：
     *
     *   代理那一支不够本注  →  代理坐庄
     *   整棵总代树不够本注  →  总代坐庄
     *   两层都够            →  飞到平台
     *
     * 为什么平台还要看整棵树：总代一旦超发（赔出去的超过他手上有的），
     * 某个代理那一支的数字会被抬高，但那部分分没有真钱背书——玩家输了平台收到白纸，
     * 玩家赢了平台掏真钱。所以平台当庄的上限是树里实际有多少钱。
     * 树里有钱时两个条件都满足，行为和只看单支时一模一样。
     */
    const stake = Math.max(0, asMoney(stakeAmount ?? 0));
    const enough = (v: number) => (stake > 0 ? v + 1e-9 >= stake : v > 0);

    if (!enough(await this.flyAvailableCached(agent.userId, bookMode))) {
      /* 代理这一支不够：有总代则总代接，否则代理自己坐庄 */
      if (generalUserId) {
        return { type: 'AGENT', id: generalUserId, flying: false, sitting: 'GENERAL', ...base };
      }
      return { type: 'AGENT', id: agent.userId, flying: false, sitting: 'AGENT', ...base };
    }

    if (generalUserId && !enough(await this.treeFlyAvailableCached(generalUserId))) {
      return { type: 'AGENT', id: generalUserId, flying: false, sitting: 'GENERAL', ...base };
    }

    return {
      type: 'PLATFORM',
      id: PLATFORM_OWNER_ID,
      flying: true,
      sitting: 'PLATFORM',
      ...base,
    };
  }

  async getRebatePolicy() {
    const row = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    const platform = readPlatformBounds(row);
    return {
      totalRate: platform.generalDefault,
      playerMinRate: platform.playerMin,
      playerMaxRate: platform.playerMax,
      generalDefaultRate: platform.generalDefault,
      generalMaxRate: platform.generalMax,
      agentDefaultRate: platform.agentDefault,
      defaults: row?.defaults ?? {},
      platform,
    };
  }

  /**
   * P=玩家回水；agentPkg=代理%；generalPkg=总代%。
   * 发放时各人拿自己的点：总代%−代理%、代理%−玩家%、玩家进回水池。
   */
  async resolvePlayerRate(playerId: string, roomId?: string, gameCode?: string): Promise<{
    P: number;
    T: number;
    A: number;
    agentPkg: number;
    generalPkg: number;
  }> {
    const policy = await this.getRebatePolicy();
    const member = await this.resolvePlayerRoom(playerId, roomId);
    const opsRoomId = roomId || member?.roomId;
    const roomBand = resolvePlayerBand({
      platform: policy.platform,
      general: member?.room?.generalAgent,
      agentFlowRate: member?.room?.ownerAgent?.flowRate,
    });
    const gamePkg = gameCode
      ? bandForRoomGame({
          defaults: policy.defaults,
          platform: policy.platform,
          gameCode,
          category: (
            await this.prisma.game.findUnique({
              where: { code: gameCode },
              select: { category: true },
            })
          )?.category,
          hasGeneral: !!member?.room?.generalAgent,
          generalGameRates: member?.room?.generalAgent?.gameRates,
          agentGameRates: member?.room?.ownerAgent?.gameRates,
        }).pkg
      : null;
    let roomGameRate: number | null = null;
    if (gameCode && opsRoomId) {
      const cfg = await this.prisma.roomGameConfig.findUnique({
        where: { roomId_gameCode: { roomId: opsRoomId, gameCode } },
        select: { rebateRate: true },
      });
      if (cfg?.rebateRate != null) roomGameRate = Number(cfg.rebateRate);
    }
    const rates = resolvePayoutRates({
      roomBand,
      gamePkg,
      roomGameRate,
      memberRate: member?.playerRebateRate,
      agentDefaultRate: member?.room?.ownerAgent?.rebateRate,
    });
    const T = rates.generalPkg > 0 ? rates.generalPkg : rates.agentPkg;
    return {
      P: rates.P,
      T,
      A: roundMoney(rates.A),
      agentPkg: rates.agentPkg,
      generalPkg: rates.generalPkg,
    };
  }

  clampPlayerRate(rate: number, T: number, playerMinRate: number) {
    const maxP = Math.min(T, rate);
    if (rate < playerMinRate) {
      throw new BadRequestException(`玩家回水须在 ${playerMinRate} ~ ${maxP}`);
    }
    return rate;
  }
}
