import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { genRobotBet, pickRobotWinners, robotRoster } from './room-chat-atmosphere';
import {
  CHAT_LOTTERY_GAMES,
  isChatLotteryGame,
  type ChatLotteryGame,
  type RoomChatBetPayload,
  type RoomChatKind,
  type RoomChatMessageDto,
  type RoomChatPlayLine,
  type RoomChatResultPayload,
  type RoomChatVerifyUser,
} from './room-chat.types';
import { formatLotteryPlayLabel } from '../lottery/play-label';

@Injectable()
export class RoomChatService {
  constructor(private prisma: PrismaService) {}

  /** 历史气泡里的旧「N定M」展示成现行「N/M」，不改库 */
  private normalizeLegacyDing(payload: Record<string, unknown>): Record<string, unknown> {
    const fix = (s: string) => String(s || '').replace(/([0-9])定(10|[0-9])/g, '$1/$2');
    const out: Record<string, unknown> = { ...payload };
    if (typeof out.text === 'string') out.text = fix(out.text);
    if (Array.isArray(out.plays)) {
      out.plays = out.plays.map((p) => {
        if (!p || typeof p !== 'object' || Array.isArray(p)) return p;
        const row = p as Record<string, unknown>;
        if (typeof row.play !== 'string') return p;
        return { ...row, play: fix(row.play) };
      });
    }
    if (Array.isArray(out.users)) {
      out.users = out.users.map((u) => {
        if (!u || typeof u !== 'object' || Array.isArray(u)) return u;
        const user = u as Record<string, unknown>;
        if (!Array.isArray(user.tags)) return u;
        return {
          ...user,
          tags: user.tags.map((t) => {
            if (!t || typeof t !== 'object' || Array.isArray(t)) return t;
            const tag = t as Record<string, unknown>;
            if (typeof tag.play !== 'string') return t;
            return { ...tag, play: fix(tag.play) };
          }),
        };
      });
    }
    return out;
  }

  private toDto(row: {
    id: string;
    gameCode: string;
    kind: string;
    issueNo: string | null;
    senderId: string | null;
    senderName: string;
    senderAvatar: string | null;
    isRobot: boolean;
    payload: Prisma.JsonValue;
    createdAt: Date;
  }): RoomChatMessageDto {
    const raw = (row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? row.payload
      : {}) as Record<string, unknown>;
    return {
      id: row.id,
      gameCode: row.gameCode,
      kind: row.kind as RoomChatKind,
      issueNo: row.issueNo,
      senderId: row.senderId,
      senderName: row.senderName,
      senderAvatar: row.senderAvatar,
      isRobot: row.isRobot,
      payload: this.normalizeLegacyDing(raw),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async assertMember(playerId: string, roomNo: string) {
    const room = await this.prisma.room.findUnique({ where: { roomNo } });
    if (!room || room.status !== 'OPEN') throw new NotFoundException('房间不存在或已关闭');
    const mem = await this.prisma.roomMember.findUnique({
      where: { playerId_roomId: { playerId, roomId: room.id } },
    });
    if (!mem || mem.status !== 'APPROVED') throw new ForbiddenException('您不是该房间成员');
    return room;
  }

  /** 玩家最近进入的 APPROVED 房间（下注未带 roomNo 时回退） */
  async resolvePlayerRoom(playerId: string, roomNo?: string | null) {
    if (roomNo && /^\d{6}$/.test(roomNo)) {
      try {
        return await this.assertMember(playerId, roomNo);
      } catch {
        /* fall through */
      }
    }
    const mem = await this.prisma.roomMember.findFirst({
      where: { playerId, status: 'APPROVED', room: { status: 'OPEN' } },
      include: { room: true },
      orderBy: { updatedAt: 'desc' },
    });
    return mem?.room ?? null;
  }

  private roomEnablesGame(enabledGamesJson: string, gameCode: string): boolean {
    try {
      const arr = JSON.parse(enabledGamesJson || '[]');
      if (!Array.isArray(arr) || arr.length === 0) return isChatLotteryGame(gameCode);
      return arr.map(String).includes(gameCode);
    } catch {
      return isChatLotteryGame(gameCode);
    }
  }

  async listOpenRoomsForGame(gameCode: string) {
    const rooms = await this.prisma.room.findMany({ where: { status: 'OPEN' } });
    return rooms.filter((r) => this.roomEnablesGame(r.enabledGames, gameCode));
  }

  async append(input: {
    roomId: string;
    gameCode: string;
    kind: RoomChatKind;
    issueNo?: string | null;
    senderId?: string | null;
    senderName: string;
    senderAvatar?: string | null;
    isRobot?: boolean;
    payload: Record<string, unknown>;
  }) {
    const row = await this.prisma.roomChatMessage.create({
      data: {
        roomId: input.roomId,
        gameCode: input.gameCode,
        kind: input.kind,
        issueNo: input.issueNo ?? null,
        senderId: input.senderId ?? null,
        senderName: input.senderName,
        senderAvatar: input.senderAvatar ?? null,
        isRobot: !!input.isRobot,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
    return this.toDto(row);
  }

  /** 系统类消息防重：同 room+game+kind+issueNo 只写一次（DB 部分唯一索引兜底） */
  async appendSystemOnce(input: {
    roomId: string;
    gameCode: string;
    kind: Extract<RoomChatKind, 'close' | 'result' | 'bet_verify' | 'win_verify'>;
    issueNo: string;
    senderName?: string;
    payload: Record<string, unknown>;
  }) {
    const exists = await this.prisma.roomChatMessage.findFirst({
      where: {
        roomId: input.roomId,
        gameCode: input.gameCode,
        kind: input.kind,
        issueNo: input.issueNo,
      },
      select: { id: true },
    });
    if (exists) return null;
    try {
      return await this.append({
        roomId: input.roomId,
        gameCode: input.gameCode,
        kind: input.kind,
        issueNo: input.issueNo,
        senderName: input.senderName || '机器人',
        isRobot: true,
        payload: input.payload,
      });
    } catch (err) {
      /* 并发下唯一约束冲突 → 视为已写入 */
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return null;
      }
      throw err;
    }
  }

  async list(
    roomId: string,
    gameCode: string,
    opts: { afterId?: string; limit?: number },
  ): Promise<RoomChatMessageDto[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    if (opts.afterId) {
      const anchor = await this.prisma.roomChatMessage.findUnique({
        where: { id: opts.afterId },
        select: { createdAt: true, id: true },
      });
      /* 锚点丢失（裁剪/清库）时退回首屏合并拉取，避免客户端永久断更；前端 seenId 会去重 */
      if (!anchor) {
        return this.list(roomId, gameCode, { limit });
      }
      const rows = await this.prisma.roomChatMessage.findMany({
        where: {
          roomId,
          gameCode,
          OR: [
            { createdAt: { gt: anchor.createdAt } },
            { createdAt: anchor.createdAt, id: { gt: anchor.id } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
      });
      return rows.map((r) => this.toDto(r));
    }

    /* 进房首屏：系统卡（封盘/开奖/核对）+ 近期下注合并，避免机器人注刷屏挤掉流水 */
    const systemKinds = ['close', 'result', 'bet_verify', 'win_verify'] as const;
    const systemTake = Math.min(30, limit);
    const betTake = Math.max(20, limit - 10);
    const [systems, bets] = await Promise.all([
      this.prisma.roomChatMessage.findMany({
        where: { roomId, gameCode, kind: { in: [...systemKinds] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: systemTake,
      }),
      this.prisma.roomChatMessage.findMany({
        where: { roomId, gameCode, kind: 'bet' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: betTake,
      }),
    ]);
    const byId = new Map<string, (typeof systems)[number]>();
    for (const r of [...systems, ...bets]) byId.set(r.id, r);
    const merged = Array.from(byId.values()).sort((a, b) => {
      const t = a.createdAt.getTime() - b.createdAt.getTime();
      if (t !== 0) return t;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    /* 超限时优先丢掉最旧的 bet，尽量保留封盘/开奖/核对卡 */
    const kindsKeep = new Set(['close', 'result', 'bet_verify', 'win_verify']);
    const arr = merged.slice();
    while (arr.length > limit) {
      const betIdx = arr.findIndex((r) => !kindsKeep.has(String(r.kind)));
      if (betIdx >= 0) arr.splice(betIdx, 1);
      else arr.shift();
    }
    return arr.map((r) => this.toDto(r));
  }

  async listForPlayer(playerId: string, roomNo: string, gameCode: string, opts: { afterId?: string; limit?: number }) {
    if (!isChatLotteryGame(gameCode)) throw new NotFoundException('不支持的游戏');
    const room = await this.assertMember(playerId, roomNo);
    return this.list(room.id, gameCode, opts);
  }

  async appendPlayerBet(opts: {
    playerId: string;
    roomNo?: string | null;
    gameCode: string;
    issueNo: string;
    chatText: string;
    plays?: RoomChatPlayLine[];
    totalAmount?: number;
  }) {
    if (!isChatLotteryGame(opts.gameCode)) return null;
    const room = await this.resolvePlayerRoom(opts.playerId, opts.roomNo);
    if (!room) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: opts.playerId },
      select: { nickname: true, avatar: true },
    });
    const payload: RoomChatBetPayload = {
      text: opts.chatText,
      issueNo: opts.issueNo,
      plays: opts.plays,
      totalAmount: opts.totalAmount,
    };
    return this.append({
      roomId: room.id,
      gameCode: opts.gameCode,
      kind: 'bet',
      issueNo: opts.issueNo,
      senderId: opts.playerId,
      senderName: user?.nickname || '玩家',
      senderAvatar: user?.avatar || null,
      isRobot: false,
      payload: payload as unknown as Record<string, unknown>,
    });
  }

  /** 相同玩法合并金额（多次同口令只显示一条） */
  private mergePlayTags(tags: Array<{ play: string; amount: number }>) {
    const order: string[] = [];
    const sum = new Map<string, number>();
    for (const t of tags) {
      const play = String(t?.play || '').trim();
      if (!play) continue;
      const amt = Number(t.amount) || 0;
      if (!sum.has(play)) order.push(play);
      sum.set(play, (sum.get(play) || 0) + amt);
    }
    return order.map((play) => ({ play, amount: sum.get(play) || 0 }));
  }

  /** 从气泡原文拆玩法/金额（保留复式折叠，如 后三12345/100） */
  private playsFromBetText(text: string): RoomChatPlayLine[] | null {
    const out: RoomChatPlayLine[] = [];
    for (const part of String(text || '').trim().split(/\s+/)) {
      if (!part) continue;
      const m = part.match(/^(.+)\/(\d+)$/);
      if (!m) return null;
      out.push({ play: m[1], amount: Number(m[2]) });
    }
    return out.length ? out : null;
  }

  /**
   * 汇总本期房间下注，供注单核对 / 中奖氛围：
   * - 真实玩家：以账本 PENDING 注单为准（已取消的不会出现）
   * - 机器人：仍从聊天氛围气泡汇总
   */
  private async collectIssueBets(roomId: string, gameCode: string, issueNo: string) {
    const users: RoomChatVerifyUser[] = [];

    /* 1) 真实玩家：房间成员在本期未取消的 PENDING 注单 */
    const game = await this.prisma.game.findUnique({ where: { code: gameCode } });
    if (game) {
      const issue = await this.prisma.lotteryIssue.findUnique({
        where: { gameId_issueNo: { gameId: game.id, issueNo } },
        select: { id: true },
      });
      if (issue) {
        const memberIds = (
          await this.prisma.roomMember.findMany({
            where: { roomId, status: 'APPROVED' },
            select: { playerId: true },
          })
        ).map((m) => m.playerId);
        if (memberIds.length) {
          const pendingBets = await this.prisma.bet.findMany({
            where: {
              issueId: issue.id,
              playerId: { in: memberIds },
              status: 'PENDING',
            },
            include: { player: { select: { nickname: true } } },
            orderBy: { createdAt: 'asc' },
          });
          const byPlayer = new Map<string, RoomChatVerifyUser>();
          for (const b of pendingBets) {
            const name = b.player?.nickname || '玩家';
            const cur = byPlayer.get(b.playerId) || {
              name,
              isRobot: false,
              total: 0,
              tags: [],
            };
            const payload = (b.payload || {}) as { value?: string | number };
            const play = formatLotteryPlayLabel(
              gameCode,
              String(b.betType || ''),
              payload.value ?? null,
            );
            cur.tags.push({ play, amount: b.amount });
            cur.total += b.amount;
            byPlayer.set(b.playerId, cur);
          }
          for (const u of byPlayer.values()) {
            const tags = this.mergePlayTags(u.tags);
            users.push({
              ...u,
              tags,
              total: tags.reduce((s, t) => s + t.amount, 0),
            });
          }
        }
      }
    }

    /* 2) 机器人氛围注 */
    users.push(...(await this.collectRobotIssueBets(roomId, gameCode, issueNo)));
    return users;
  }

  /** 仅汇总机器人氛围下注（轻量，供开奖中奖核对） */
  private async collectRobotIssueBets(roomId: string, gameCode: string, issueNo: string) {
    const rows = await this.prisma.roomChatMessage.findMany({
      where: { roomId, gameCode, kind: 'bet', issueNo, isRobot: true },
      orderBy: { createdAt: 'asc' },
    });
    const byRobot = new Map<string, RoomChatVerifyUser>();
    for (const r of rows) {
      const p = (r.payload || {}) as unknown as RoomChatBetPayload;
      const fromText = this.playsFromBetText(String(p.text || ''));
      const plays =
        fromText ||
        (Array.isArray(p.plays) && p.plays.length
          ? p.plays
          : [{ play: String(p.text || '下注'), amount: Number(p.totalAmount) || 0 }]);
      const cur = byRobot.get(r.senderName) || {
        name: r.senderName,
        isRobot: true,
        total: 0,
        tags: [],
      };
      for (const pl of plays) {
        cur.tags.push({ play: pl.play, amount: pl.amount });
        cur.total += pl.amount;
      }
      byRobot.set(r.senderName, cur);
    }
    return [...byRobot.values()].map((u) => {
      const tags = this.mergePlayTags(u.tags);
      return {
        ...u,
        tags,
        total: tags.reduce((s, t) => s + t.amount, 0),
      };
    });
  }

  async fanOutIssueLocked(gameCode: string, issueNo: string) {
    if (!isChatLotteryGame(gameCode)) return;
    const rooms = await this.listOpenRoomsForGame(gameCode);
    for (const room of rooms) {
      await this.appendSystemOnce({
        roomId: room.id,
        gameCode,
        kind: 'close',
        issueNo,
        payload: { issueNo },
      });
      const users = await this.collectIssueBets(room.id, gameCode, issueNo);
      await this.appendSystemOnce({
        roomId: room.id,
        gameCode,
        kind: 'bet_verify',
        issueNo,
        payload: { issueNo, users },
      });
    }
  }

  async fanOutIssueDrawn(gameCode: string, issueNo: string, nums: number[]) {
    if (!isChatLotteryGame(gameCode)) return;
    const rooms = await this.listOpenRoomsForGame(gameCode);
    if (!rooms.length) return;
    const resultPayload: RoomChatResultPayload = { issueNo, nums };

    /* 期号 / 全期中奖注单只查一次，按房成员过滤 */
    const game = await this.prisma.game.findUnique({ where: { code: gameCode } });
    const issue = game
      ? await this.prisma.lotteryIssue.findUnique({
          where: { gameId_issueNo: { gameId: game.id, issueNo } },
          select: { id: true },
        })
      : null;
    const allWonBets = issue
      ? await this.prisma.bet.findMany({
          where: {
            issueId: issue.id,
            status: 'WON',
            payout: { gt: 0 },
          },
          include: { player: { select: { nickname: true } } },
        })
      : [];

    const roomIds = rooms.map((r) => r.id);
    const allMembers = await this.prisma.roomMember.findMany({
      where: { roomId: { in: roomIds }, status: 'APPROVED' },
      select: { roomId: true, playerId: true },
    });
    const membersByRoom = new Map<string, string[]>();
    for (const m of allMembers) {
      const list = membersByRoom.get(m.roomId) || [];
      list.push(m.playerId);
      membersByRoom.set(m.roomId, list);
    }

    for (const room of rooms) {
      await this.appendSystemOnce({
        roomId: room.id,
        gameCode,
        kind: 'result',
        issueNo,
        payload: resultPayload as unknown as Record<string, unknown>,
      });

      const robotUsers = await this.collectRobotIssueBets(room.id, gameCode, issueNo);
      const robotBets = robotUsers.map((u) => ({
        name: u.name,
        plays: u.tags.map((t) => ({ play: t.play, amount: t.amount })),
      }));
      const robotWins = pickRobotWinners(room.id, gameCode, issueNo, robotBets);

      const memberSet = new Set(membersByRoom.get(room.id) || []);
      const byPlayer = new Map<string, RoomChatVerifyUser>();
      for (const b of allWonBets) {
        if (!memberSet.has(b.playerId)) continue;
        const name = b.player?.nickname || '玩家';
        const cur = byPlayer.get(b.playerId) || {
          name,
          total: 0,
          tags: [],
          winAmount: 0,
          profit: 0,
        };
        const payload = (b.payload || {}) as { value?: string | number };
        const play = formatLotteryPlayLabel(
          gameCode,
          String(b.betType || ''),
          payload.value ?? null,
        );
        cur.tags.push({ play, amount: b.amount });
        cur.total += b.amount;
        cur.winAmount = (cur.winAmount || 0) + b.payout;
        cur.profit = (cur.profit || 0) + (b.payout - b.amount);
        byPlayer.set(b.playerId, cur);
      }
      const realWins: RoomChatVerifyUser[] = [];
      for (const u of byPlayer.values()) {
        u.tags = this.mergePlayTags(u.tags);
        u.total = u.tags.reduce((s, t) => s + t.amount, 0);
        realWins.push(u);
      }

      const users: RoomChatVerifyUser[] = [
        ...robotWins.map((w) => {
          const tags = this.mergePlayTags(w.tags);
          return {
            name: w.name,
            isRobot: true,
            total: tags.reduce((s, t) => s + t.amount, 0),
            tags,
            winAmount: w.winAmount,
            profit: w.profit,
          };
        }),
        ...realWins,
      ];
      users.sort((a, b) => (b.profit || 0) - (a.profit || 0));

      await this.appendSystemOnce({
        roomId: room.id,
        gameCode,
        kind: 'win_verify',
        issueNo,
        payload: { issueNo, users, empty: users.length === 0 },
      });
    }
  }

  /**
   * 机器人氛围下注：每个 OPEN 房 × 每个聊天彩票，在可下注窗口写 1 条。
   * 关键：上一期已封盘、开奖结果/中奖核对尚未出来时，禁止抢先下下一期氛围注
   *（预创多期 PENDING 会导致「封盘线后机器人还在聊」）。
   */
  async tickRobotAtmosphere() {
    const now = new Date();
    for (const gameCode of CHAT_LOTTERY_GAMES) {
      const game = await this.prisma.game.findUnique({ where: { code: gameCode } });
      if (!game || game.status !== 'ONLINE') continue;

      /* 封盘中 / 应开未开：聊天流水安静等到开奖卡后再刷下一期 */
      const sealingOrDrawing = await this.prisma.lotteryIssue.findFirst({
        where: {
          gameId: game.id,
          status: { in: ['PENDING', 'LOCKED'] },
          OR: [
            { lockAt: { lte: now }, openAt: { gt: now } },
            { openAt: { lte: now } },
          ],
        },
        select: { id: true },
      });
      if (sealingOrDrawing) continue;

      const issue = await this.prisma.lotteryIssue.findFirst({
        where: {
          gameId: game.id,
          status: 'PENDING',
          lockAt: { gt: now },
          openAt: { gt: now },
        },
        orderBy: { openAt: 'asc' },
      });
      if (!issue) continue;

      const rooms = await this.listOpenRoomsForGame(gameCode);
      const tickKey = `${Math.floor(now.getTime() / 5000)}`;
      for (const room of rooms) {
        /* 每房每 5s 窗口最多 1 条氛围注，避免刷屏 */
        const recent = await this.prisma.roomChatMessage.findFirst({
          where: {
            roomId: room.id,
            gameCode,
            kind: 'bet',
            isRobot: true,
            createdAt: { gte: new Date(now.getTime() - 4500) },
          },
          select: { id: true },
        });
        if (recent) continue;

        const gen = genRobotBet(room.id, gameCode as ChatLotteryGame, issue.issueNo, tickKey + room.id);
        const payload: RoomChatBetPayload = {
          text: gen.text,
          issueNo: issue.issueNo,
          plays: gen.plays,
          totalAmount: gen.totalAmount,
        };
        await this.append({
          roomId: room.id,
          gameCode,
          kind: 'bet',
          issueNo: issue.issueNo,
          senderName: gen.name,
          senderAvatar: gen.avatar,
          isRobot: true,
          payload: payload as unknown as Record<string, unknown>,
        });
      }
    }
  }

  /** 确保房间有稳定机器名册（供调试/扩展） */
  ensureRoster(roomId: string, gameCode: string) {
    return robotRoster(roomId, gameCode);
  }
}
