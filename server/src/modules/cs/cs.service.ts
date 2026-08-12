/**
 * 玩家客服会话：消息、上/下分申请建单、代理/客服回复。
 * 代理看团队全部；客服仅看系统随机派给自己的玩家（粘性会话）。
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { isRealImage } from '../../common/utils/image-magic';
import { RechargeService } from '../recharge/recharge.service';
import { CsStaffService } from '../console/cs-staff.service';

const UP_RE = /^上分\s*\/?\s*(\d+)$/;
const DOWN_RE = /^下分\s*\/?\s*(\d+)$/;

/** 聊天图只允许鉴权媒体接口，禁止公开静态路径与外链。 */
const CS_IMG_RE = /\[img\](\S+)/gi;
const CS_MEDIA_URL_RE = /^\/api\/cs\/media\/([A-Za-z0-9_-]{10,64})$/;

function parseCsMessageText(text: string): { text: string; mediaIds: string[] } {
  const mediaIds: string[] = [];
  const sanitized = text.replace(CS_IMG_RE, (_full, url: string) => {
    const u = String(url || '').trim();
    const match = CS_MEDIA_URL_RE.exec(u);
    if (match) {
      mediaIds.push(match[1]);
      return `[img]${u}`;
    }
    throw new BadRequestException('图片地址无效，请重新上传发送');
  });
  return { text: sanitized, mediaIds: [...new Set(mediaIds)] };
}

const CHANNEL_LABEL: Record<string, string> = {
  wechat: '微信',
  alipay: '支付宝',
  unionpay: '银联',
  bank: '银行卡',
  usdt: 'USDT',
};

export type CsUploadPolicy = 'PLAYER_CHAT' | 'STAFF_CHAT' | 'STAFF_PAY_QR';

const UPLOAD_WINDOW_SEC = 24 * 60 * 60;
const DEFAULT_PLAYER_UPLOAD_LIMIT = 10;
const DEFAULT_STAFF_UPLOAD_LIMIT = 30;
const DEFAULT_CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_PAY_QR_MAX_BYTES = 8_000_000;
const DEFAULT_MEDIA_RETENTION_DAYS = 90;
const DEFAULT_ORPHAN_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function fundChannelLabel(channel?: string | null): string {
  const ch = String(channel ?? '').trim();
  if (
    !ch ||
    ch === 'cs' ||
    ch === 'game' ||
    ch === 'manual' ||
    ch === '人工' ||
    ch === 'default'
  ) {
    return '';
  }
  return CHANNEL_LABEL[ch] || ch;
}

@Injectable()
export class CsService {
  private readonly logger = new Logger(CsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private redis: RedisService,
    @Inject(forwardRef(() => RechargeService))
    private recharge: RechargeService,
    private csStaff: CsStaffService,
  ) {}

  private mediaUrl(id: string): string {
    return `/api/cs/media/${id}`;
  }

  private mediaRoot(): string {
    const configured = String(
      this.config.get<string>('CS_PRIVATE_UPLOAD_DIR') ?? 'private-uploads/cs',
    ).trim();
    return resolve(process.cwd(), configured || 'private-uploads/cs');
  }

  private mediaFilePath(storageKey: string): string {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(storageKey)) {
      throw new NotFoundException('媒体文件不存在');
    }
    const root = this.mediaRoot();
    const file = resolve(root, storageKey);
    if (!file.startsWith(`${root}${sep}`)) {
      throw new NotFoundException('媒体文件不存在');
    }
    return file;
  }

  /** 团队玩家 agentPath 前缀：AGENT 用自身；CS 用上级主代理。子账号不可客服会话。 */
  private async teamPlayerPrefix(
    actorId: string,
  ): Promise<{ role: string; prefix: string; agentRootId: string } | null> {
    const reviewer = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { role: true, agentPath: true, parentId: true },
    });
    if (!reviewer || !['AGENT', 'CS'].includes(reviewer.role)) return null;
    if (reviewer.role === 'CS') {
      if (!reviewer.parentId) return null;
      const parent = await this.prisma.user.findUnique({
        where: { id: reviewer.parentId },
        select: { id: true, role: true, agentPath: true },
      });
      if (!parent || parent.role !== 'AGENT') return null;
      return {
        role: reviewer.role,
        prefix: `${parent.agentPath}${parent.id}/`,
        agentRootId: parent.id,
      };
    }
    return {
      role: reviewer.role,
      prefix: `${reviewer.agentPath}${actorId}/`,
      agentRootId: actorId,
    };
  }

  /** 主代理房间内成员（含尚未挂靠 agentPath 的玩家） */
  private async roomMemberPlayerIds(agentRootId: string): Promise<string[]> {
    const rooms = await this.prisma.room.findMany({
      where: { ownerAgent: { userId: agentRootId } },
      select: { id: true },
    });
    if (!rooms.length) return [];
    const members = await this.prisma.roomMember.findMany({
      where: { roomId: { in: rooms.map((r) => r.id) }, status: 'APPROVED' },
      select: { playerId: true },
    });
    return [...new Set(members.map((m) => m.playerId))];
  }

  private async isPlayerInTeam(
    playerId: string,
    team: { prefix: string; agentRootId: string },
  ): Promise<boolean> {
    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { role: true, agentPath: true },
    });
    if (!player || player.role !== 'PLAYER') return false;
    if (player.agentPath.startsWith(team.prefix)) return true;
    const hit = await this.prisma.roomMember.findFirst({
      where: {
        playerId,
        status: 'APPROVED',
        room: { ownerAgent: { userId: team.agentRootId } },
      },
      select: { id: true },
    });
    return !!hit;
  }

  private async assertPlayerInTeam(actorId: string, playerId: string) {
    const team = await this.teamPlayerPrefix(actorId);
    if (!team) throw new ForbiddenException('仅代理/客服可查看客服会话');
    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, role: true, agentPath: true },
    });
    if (!player || player.role !== 'PLAYER') throw new NotFoundException('玩家不存在');
    if (!(await this.isPlayerInTeam(playerId, team))) {
      throw new ForbiddenException('只能查看所属团队玩家的会话');
    }
    return { team, player };
  }

  /** 该玩家当前粘性指派人（最近一条带 assignee 的消息） */
  private async currentAssignee(playerId: string): Promise<string | null> {
    const last = await this.prisma.csMessage.findFirst({
      where: { playerId, assigneeId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { assigneeId: true },
    });
    return last?.assigneeId ?? null;
  }

  /** 客服只能操作派给自己的玩家 */
  private async assertCsOwnsSession(csUserId: string, playerId: string) {
    const assignee = await this.currentAssignee(playerId);
    if (assignee !== csUserId) {
      throw new ForbiddenException('该玩家未分配给你，无法查看或回复');
    }
  }

  /** 粘性派单归属，供上下分审核等会话外的入口复用同一口径 */
  async isAssignedToCs(csUserId: string, playerId: string): Promise<boolean> {
    return (await this.currentAssignee(playerId)) === csUserId;
  }

  /** 从上级链或所在房间解析主代理 */
  private async resolveAgentRootId(playerId: string): Promise<string | null> {
    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { parentId: true },
    });
    let cur: string | null = player?.parentId ?? null;
    for (let i = 0; i < 8 && cur; i++) {
      const u: { id: string; role: string; parentId: string | null } | null =
        await this.prisma.user.findUnique({
          where: { id: cur },
          select: { id: true, role: true, parentId: true },
        });
      if (!u) break;
      if (u.role === 'AGENT') return u.id;
      if (u.role === 'PROXY' || u.role === 'CS') {
        cur = u.parentId;
        continue;
      }
      break;
    }

    const mem = await this.prisma.roomMember.findFirst({
      where: {
        playerId,
        status: 'APPROVED',
        room: { status: 'OPEN', ownerAgent: { isNot: null } },
      },
      orderBy: { updatedAt: 'desc' },
      select: { room: { select: { ownerAgent: { select: { userId: true } } } } },
    });
    return mem?.room.ownerAgent?.userId ?? null;
  }

  /**
   * 玩家所属主代理 → 粘性客服；失效则空闲客服按权重随机；无人则主代理。
   */
  private async resolveAssignee(playerId: string): Promise<string | null> {
    const agentRootId = await this.resolveAgentRootId(playerId);
    if (!agentRootId) return null;

    const sticky = await this.currentAssignee(playerId);
    if (sticky && (await this.csStaff.isAssigneeValid(sticky, agentRootId))) {
      return sticky;
    }
    return this.csStaff.pickAssignee(agentRootId);
  }

  private serializeMsg(m: {
    id: string;
    playerId: string;
    sender: string;
    text: string;
    isRead: boolean;
    rechargeOrderId: string | null;
    assigneeId: string | null;
    createdAt: Date;
  }) {
    return {
      id: m.id,
      playerId: m.playerId,
      sender: m.sender,
      text: m.text,
      isRead: m.isRead,
      rechargeOrderId: m.rechargeOrderId,
      assigneeId: m.assigneeId,
      createdAt: m.createdAt.toISOString(),
    };
  }

  /** 玩家：会话历史 */
  async playerMessages(playerId: string, limit = 100) {
    const list = await this.prisma.csMessage.findMany({
      where: { playerId },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return { list: list.map((m) => this.serializeMsg(m)) };
  }

  /**
   * 游戏内/充值页提交上下分后同步到客服会话（玩家一条 + 系统回执）。
   * 客服页发「上分N」走 playerSend，会传 skipCsNotify，避免重复。
   */
  async notifyFundOrderSubmitted(
    playerId: string,
    opts: {
      type: 'UP' | 'DOWN';
      amount: number;
      orderId: string;
      channel?: string | null;
    },
  ) {
    const assigneeId = await this.resolveAssignee(playerId);
    const label = fundChannelLabel(opts.channel);
    const amount = opts.amount;
    const playerText =
      opts.type === 'UP'
        ? label
          ? `${label}上分${amount}`
          : `上分${amount}`
        : label
          ? `${label}下分${amount}`
          : `下分${amount}`;
    const sysText =
      opts.type === 'UP'
        ? `已收到上分申请${amount}积分，请等待客服审核。`
        : `已收到下分申请${amount}积分，余额已扣除，请等待客服审核。`;

    await this.prisma.csMessage.create({
      data: {
        playerId,
        sender: 'PLAYER',
        text: playerText,
        isRead: false,
        assigneeId,
        rechargeOrderId: opts.orderId,
      },
    });
    await this.prisma.csMessage.create({
      data: {
        playerId,
        sender: 'SYSTEM',
        text: sysText,
        isRead: true,
        assigneeId,
        rechargeOrderId: opts.orderId,
      },
    });
  }

  /** 审单结果等系统消息写入客服会话 */
  async pushSystemMessage(
    playerId: string,
    text: string,
    rechargeOrderId?: string,
  ) {
    const assigneeId = await this.resolveAssignee(playerId);
    await this.prisma.csMessage.create({
      data: {
        playerId,
        sender: 'SYSTEM',
        text,
        isRead: false,
        assigneeId,
        rechargeOrderId: rechargeOrderId ?? null,
      },
    });
  }

  private async assertCanAttachMedia(
    actorId: string,
    sender: 'PLAYER' | 'STAFF',
    mediaIds: string[],
  ) {
    if (!mediaIds.length) return;
    const uploads = await this.prisma.csUpload.findMany({
      where: { id: { in: mediaIds } },
      select: {
        id: true,
        ownerId: true,
        playerId: true,
        policy: true,
        expiresAt: true,
      },
    });
    if (uploads.length !== mediaIds.length) {
      throw new BadRequestException('图片不存在或已过期，请重新上传');
    }
    const now = Date.now();
    for (const upload of uploads) {
      const allowed =
        upload.ownerId === actorId &&
        upload.expiresAt.getTime() > now &&
        (sender === 'PLAYER'
          ? upload.policy === 'PLAYER_CHAT' && upload.playerId === actorId
          : upload.policy !== 'PLAYER_CHAT');
      if (!allowed) {
        throw new ForbiddenException('只能发送自己上传且未过期的图片');
      }
    }
  }

  private async markMediaAttached(mediaIds: string[]) {
    if (!mediaIds.length) return;
    await this.prisma.csUpload.updateMany({
      where: { id: { in: mediaIds }, attachedAt: null },
      data: { attachedAt: new Date() },
    });
  }

  private fundOrderNo(playerId: string, clientRequestId: string): string {
    const digest = createHash('sha256')
      .update(playerId)
      .update('\0')
      .update(clientRequestId)
      .digest('hex')
      .slice(0, 48);
    return `cs_${digest}`;
  }

  private exceptionMessage(e: HttpException): string {
    const response = e.getResponse();
    const msg =
      typeof response === 'string'
        ? response
        : ((response as { message?: string | string[] })?.message ?? e.message);
    return Array.isArray(msg) ? msg.join('；') : String(msg);
  }

  /** 有 clientRequestId 的消息用数据库事务做持久化重放；资金口令同时原子落单/冻结/回执。 */
  private async playerSendIdempotent(
    playerId: string,
    text: string,
    mediaIds: string[],
    clientRequestId: string,
    assigneeId: string | null,
    up: RegExpMatchArray | null,
    down: RegExpMatchArray | null,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<{ locked: string }[]>`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`cs-message:${playerId}:${clientRequestId}`}, 0)
        )::text AS locked
      `;
      const replay = await tx.csMessageRequest.findUnique({
        where: { playerId_clientRequestId: { playerId, clientRequestId } },
      });
      if (replay) {
        if (replay.text !== text) {
          throw new ConflictException('clientRequestId 已用于不同消息');
        }
        const ids = [replay.playerMessageId, replay.systemMessageId].filter(
          (id): id is string => !!id,
        );
        const messages = await tx.csMessage.findMany({ where: { id: { in: ids } } });
        const byId = new Map(messages.map((message) => [message.id, message]));
        const ordered = ids
          .map((id) => byId.get(id))
          .filter((m): m is (typeof messages)[number] => !!m);
        if (ordered.length !== ids.length) {
          throw new BadRequestException('消息幂等记录不完整，请联系客服');
        }
        return { list: ordered.map((m) => this.serializeMsg(m)), created: false, down: false };
      }

      const playerMsg = await tx.csMessage.create({
        data: {
          playerId,
          sender: 'PLAYER',
          text,
          isRead: false,
          assigneeId,
        },
      });
      if (mediaIds.length) {
        await tx.csUpload.updateMany({
          where: { id: { in: mediaIds }, attachedAt: null },
          data: { attachedAt: new Date() },
        });
      }

      let orderId: string | null = null;
      let sysMsg: typeof playerMsg | null = null;
      if (up || down) {
        const amount = Number(up?.[1] ?? down?.[1]);
        let sysText: string;
        try {
          const opts = {
            skipCsNotify: true,
            clientRequestId: this.fundOrderNo(playerId, clientRequestId),
          };
          const order = up
            ? await this.recharge.applyRechargeInTx(tx, playerId, amount, 'cs', opts)
            : await this.recharge.applyWithdrawInTx(tx, playerId, amount, 'cs', opts);
          orderId = order.id;
          sysText = up
            ? `已收到上分申请${amount}积分，请等待客服审核。`
            : `已收到下分申请${amount}积分，余额已扣除，请等待客服审核。`;
          await tx.csMessage.update({
            where: { id: playerMsg.id },
            data: { rechargeOrderId: orderId },
          });
        } catch (e: unknown) {
          if (!(e instanceof HttpException) || e.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR) {
            throw e;
          }
          sysText = this.exceptionMessage(e);
        }
        sysMsg = await tx.csMessage.create({
          data: {
            playerId,
            sender: 'SYSTEM',
            text: sysText,
            isRead: true,
            assigneeId,
            rechargeOrderId: orderId,
          },
        });
      }

      await tx.csMessageRequest.create({
        data: {
          playerId,
          clientRequestId,
          text,
          playerMessageId: playerMsg.id,
          systemMessageId: sysMsg?.id ?? null,
          rechargeOrderId: orderId,
        },
      });
      const list = [
        this.serializeMsg({ ...playerMsg, rechargeOrderId: orderId }),
        ...(sysMsg ? [this.serializeMsg(sysMsg)] : []),
      ];
      return { list, created: true, down: !!down && !!orderId };
    });
    if (result.created && result.down) {
      const amount = Number(down?.[1]);
      this.recharge.onWithdrawCommitted(playerId, amount);
    }
    return { list: result.list };
  }

  /** 玩家发消息；匹配上分/下分则建单并回执 */
  async playerSend(playerId: string, textRaw: string, clientRequestIdRaw?: string) {
    const parsed = parseCsMessageText(String(textRaw ?? '').trim());
    const { text, mediaIds } = parsed;
    if (!text) throw new BadRequestException('消息不能为空');
    if (text.length > 500) throw new BadRequestException('消息过长');
    const clientRequestId = String(clientRequestIdRaw || '').trim();
    if (clientRequestId && !/^[A-Za-z0-9_-]{8,64}$/.test(clientRequestId)) {
      throw new BadRequestException('clientRequestId 格式无效');
    }
    await this.assertCanAttachMedia(playerId, 'PLAYER', mediaIds);

    const up = text.match(UP_RE);
    const down = text.match(DOWN_RE);
    if ((up || down) && !clientRequestId) {
      throw new BadRequestException('上分/下分消息必须提供 clientRequestId');
    }
    const assigneeId = await this.resolveAssignee(playerId);
    if (clientRequestId) {
      return this.playerSendIdempotent(
        playerId,
        text,
        mediaIds,
        clientRequestId,
        assigneeId,
        up,
        down,
      );
    }

    const playerMsg = await this.prisma.csMessage.create({
      data: {
        playerId,
        sender: 'PLAYER',
        text,
        isRead: false,
        assigneeId,
      },
    });
    await this.markMediaAttached(mediaIds);

    const out = [this.serializeMsg(playerMsg)];

    if (up || down) {
      const amount = Number(up?.[1] ?? down?.[1]);
      let sysText: string;
      let orderId: string | null = null;
      try {
        if (up) {
          const order = await this.recharge.applyRecharge(playerId, amount, 'cs', {
            skipCsNotify: true,
          });
          orderId = order.id;
          sysText = `已收到上分申请${amount}积分，请等待客服审核。`;
        } else {
          const order = await this.recharge.applyWithdraw(playerId, amount, 'cs', {
            skipCsNotify: true,
          });
          orderId = order.id;
          sysText = `已收到下分申请${amount}积分，余额已扣除，请等待客服审核。`;
        }
        if (orderId) {
          await this.prisma.csMessage.update({
            where: { id: playerMsg.id },
            data: { rechargeOrderId: orderId },
          });
          out[0] = { ...out[0], rechargeOrderId: orderId };
        }
      } catch (e: unknown) {
        const msg =
          e instanceof BadRequestException
            ? (typeof e.getResponse() === 'string'
                ? String(e.getResponse())
                : ((e.getResponse() as { message?: string | string[] })?.message ??
                  e.message))
            : e instanceof Error
              ? e.message
              : '申请失败';
        sysText = Array.isArray(msg) ? msg.join('；') : String(msg);
      }

      const sys = await this.prisma.csMessage.create({
        data: {
          playerId,
          sender: 'SYSTEM',
          text: sysText!,
          isRead: true,
          assigneeId,
          rechargeOrderId: orderId,
        },
      });
      out.push(this.serializeMsg(sys));
    }

    return { list: out };
  }

  /**
   * 代理/客服：会话列表。
   * 代理：团队全部有消息的玩家；客服：仅当前粘性指派给自己的玩家。
   */
  async listSessions(actorId: string) {
    const team = await this.teamPlayerPrefix(actorId);
    if (!team) throw new ForbiddenException('仅代理/客服可查看客服会话');

    const memberIds = await this.roomMemberPlayerIds(team.agentRootId);
    const playerWhere: Prisma.UserWhereInput = {
      role: 'PLAYER',
      OR: [
        { agentPath: { startsWith: team.prefix } },
        ...(memberIds.length ? [{ id: { in: memberIds } }] : []),
      ],
    };

    const msgWhere: Prisma.CsMessageWhereInput = { player: playerWhere };
    // 客服：只拉指派给自己的消息，再按玩家最新粘性过滤
    if (team.role === 'CS') {
      msgWhere.assigneeId = actorId;
    }

    const recent = await this.prisma.csMessage.findMany({
      where: msgWhere,
      orderBy: { createdAt: 'desc' },
      take: 800,
      select: {
        id: true,
        playerId: true,
        sender: true,
        text: true,
        isRead: true,
        assigneeId: true,
        createdAt: true,
        player: { select: { id: true, uid: true, nickname: true, avatar: true } },
      },
    });

    const byPlayer = new Map<
      string,
      {
        playerId: string;
        uid: string;
        nickname: string;
        avatar: string | null;
        lastText: string;
        lastSender: string;
        lastAt: string;
        unread: number;
        lastAssigneeId: string | null;
      }
    >();

    for (const m of recent) {
      let row = byPlayer.get(m.playerId);
      if (!row) {
        row = {
          playerId: m.playerId,
          uid: m.player.uid,
          nickname: m.player.nickname,
          avatar: m.player.avatar,
          lastText: m.text,
          lastSender: m.sender,
          lastAt: m.createdAt.toISOString(),
          unread: 0,
          lastAssigneeId: m.assigneeId,
        };
        byPlayer.set(m.playerId, row);
      }
      if (m.sender === 'PLAYER' && !m.isRead) row.unread += 1;
    }

    let rows = [...byPlayer.values()];
    if (team.role === 'CS') {
      // 再核对粘性：玩家当前最新指派人必须是自己（防止旧消息污染）
      const owned: typeof rows = [];
      for (const row of rows) {
        const sticky = await this.currentAssignee(row.playerId);
        if (sticky === actorId) owned.push(row);
      }
      rows = owned;
    }

    const list = rows
      .map(({ lastAssigneeId: _a, ...rest }) => rest)
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    return { list };
  }

  async sessionMessages(actorId: string, playerId: string, limit = 100) {
    const { team } = await this.assertPlayerInTeam(actorId, playerId);
    if (team.role === 'CS') await this.assertCsOwnsSession(actorId, playerId);
    const list = await this.prisma.csMessage.findMany({
      where: { playerId },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return { list: list.map((m) => this.serializeMsg(m)) };
  }

  async agentReply(actorId: string, playerId: string, textRaw: string) {
    const { team } = await this.assertPlayerInTeam(actorId, playerId);
    if (team.role === 'CS') await this.assertCsOwnsSession(actorId, playerId);

    const parsed = parseCsMessageText(String(textRaw ?? '').trim());
    const { text, mediaIds } = parsed;
    if (!text) throw new BadRequestException('消息不能为空');
    if (text.length > 800) throw new BadRequestException('消息过长');
    await this.assertCanAttachMedia(actorId, 'STAFF', mediaIds);

    // 主代理回复时保留原客服粘性，避免会话被抢走
    let assigneeId = actorId;
    if (team.role === 'AGENT') {
      const sticky = await this.currentAssignee(playerId);
      if (sticky && (await this.csStaff.isAssigneeValid(sticky, team.agentRootId))) {
        assigneeId = sticky;
      }
    }

    const msg = await this.prisma.csMessage.create({
      data: {
        playerId,
        sender: 'AGENT',
        text,
        isRead: true,
        assigneeId,
      },
    });
    await this.markMediaAttached(mediaIds);
    return { message: this.serializeMsg(msg) };
  }

  async markRead(actorId: string, playerId: string) {
    const { team } = await this.assertPlayerInTeam(actorId, playerId);
    if (team.role === 'CS') await this.assertCsOwnsSession(actorId, playerId);
    await this.prisma.csMessage.updateMany({
      where: { playerId, sender: 'PLAYER', isRead: false },
      data: { isRead: true },
    });
    return { ok: true as const };
  }

  /** 客服当前粘性指派的玩家 id（审单过滤用） */
  async assignedPlayerIdsForCs(csUserId: string): Promise<string[]> {
    const team = await this.teamPlayerPrefix(csUserId);
    if (!team || team.role !== 'CS') return [];

    const recent = await this.prisma.csMessage.findMany({
      where: {
        assigneeId: csUserId,
        player: { role: 'PLAYER', agentPath: { startsWith: team.prefix } },
      },
      orderBy: { createdAt: 'desc' },
      take: 800,
      select: { playerId: true },
      distinct: ['playerId'],
    });

    const ids: string[] = [];
    for (const row of recent) {
      const sticky = await this.currentAssignee(row.playerId);
      if (sticky === csUserId) ids.push(row.playerId);
    }
    return ids;
  }

  private static readonly DEFAULT_QUICK = [
    '请提供付款截图',
    '已为您上分，请查收',
    '请稍等，正在为您处理',
  ];

  private normalizeDeskQrList(raw: unknown): Array<{ id: string; url: string; name: string }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ id: string; url: string; name: string }> = [];
    for (let i = 0; i < raw.length && out.length < 8; i++) {
      const item = raw[i] as { id?: string; url?: string; name?: string; note?: string } | null;
      const url = String(item?.url || '').trim();
      if (!url) continue;
      out.push({
        id: String(item?.id || `q-${i}-${Date.now().toString(36)}`),
        url,
        name: String(item?.name || item?.note || '').trim(),
      });
    }
    return out;
  }

  private normalizeDeskQuick(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [...CsService.DEFAULT_QUICK];
    const list = raw.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8);
    return list.length ? list : [...CsService.DEFAULT_QUICK];
  }

  private async assertDeskQrOwnership(
    userId: string,
    items: Array<{ url: string }>,
    kind: 'wechat' | 'alipay',
  ): Promise<string[]> {
    const ids = items.map((item) => {
      const match = CS_MEDIA_URL_RE.exec(item.url);
      if (!match) {
        throw new BadRequestException('收款码须重新上传为私有媒体');
      }
      return match[1];
    });
    if (!ids.length) return [];
    const uniqueIds = [...new Set(ids)];
    const count = await this.prisma.csUpload.count({
      where: {
        id: { in: uniqueIds },
        ownerId: userId,
        policy: 'STAFF_PAY_QR',
        kind,
        expiresAt: { gt: new Date() },
      },
    });
    if (count !== uniqueIds.length) {
      throw new ForbiddenException('收款码不存在、已过期或不属于当前账号');
    }
    return uniqueIds;
  }

  /** GET 客服桌面设置（话术+收款码）；无记录返回默认话术 */
  async getDeskSettings(userId: string) {
    const row = await this.prisma.csDeskSetting.findUnique({ where: { userId } });
    if (!row) {
      return {
        quickReplies: [...CsService.DEFAULT_QUICK],
        wechatQrs: [] as Array<{ id: string; url: string; name: string }>,
        alipayQrs: [] as Array<{ id: string; url: string; name: string }>,
      };
    }
    return {
      quickReplies: this.normalizeDeskQuick(row.quickReplies),
      wechatQrs: this.normalizeDeskQrList(row.wechatQrs),
      alipayQrs: this.normalizeDeskQrList(row.alipayQrs),
    };
  }

  /** PUT 客服桌面设置（多端同步权威源） */
  async saveDeskSettings(
    userId: string,
    body: {
      quickReplies?: string[];
      wechatQrs?: Array<{ id?: string; url?: string; name?: string; note?: string }>;
      alipayQrs?: Array<{ id?: string; url?: string; name?: string; note?: string }>;
    },
  ) {
    const quickReplies = this.normalizeDeskQuick(body.quickReplies);
    const wechatQrs = this.normalizeDeskQrList(body.wechatQrs);
    const alipayQrs = this.normalizeDeskQrList(body.alipayQrs);
    const mediaIds = [
      ...(await this.assertDeskQrOwnership(userId, wechatQrs, 'wechat')),
      ...(await this.assertDeskQrOwnership(userId, alipayQrs, 'alipay')),
    ];
    await this.prisma.csDeskSetting.upsert({
      where: { userId },
      create: {
        userId,
        quickReplies: quickReplies as unknown as Prisma.InputJsonValue,
        wechatQrs: wechatQrs as unknown as Prisma.InputJsonValue,
        alipayQrs: alipayQrs as unknown as Prisma.InputJsonValue,
      },
      update: {
        quickReplies: quickReplies as unknown as Prisma.InputJsonValue,
        wechatQrs: wechatQrs as unknown as Prisma.InputJsonValue,
        alipayQrs: alipayQrs as unknown as Prisma.InputJsonValue,
      },
    });
    await this.markMediaAttached([...new Set(mediaIds)]);
    return { quickReplies, wechatQrs, alipayQrs };
  }

  private positiveConfigInt(key: string, fallback: number, max: number): number {
    const n = Math.floor(Number(this.config.get<string | number>(key) ?? fallback));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
  }

  private async assertPlayerCanUpload(playerId: string) {
    const member = await this.prisma.roomMember.findFirst({
      where: {
        playerId,
        status: 'APPROVED',
        room: {
          status: 'OPEN',
          ownerAgentId: { not: null },
        },
      },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenException('请先加入房间并通过审核后再上传图片');
    }
  }

  private async consumeUploadQuota(actorId: string, policy: CsUploadPolicy) {
    const isPlayer = policy === 'PLAYER_CHAT';
    const limit = this.positiveConfigInt(
      isPlayer ? 'CS_PLAYER_UPLOAD_DAILY_LIMIT' : 'CS_STAFF_UPLOAD_DAILY_LIMIT',
      isPlayer ? DEFAULT_PLAYER_UPLOAD_LIMIT : DEFAULT_STAFF_UPLOAD_LIMIT,
      500,
    );
    const key = `cs:upload:24h:${isPlayer ? 'player' : 'staff'}:${actorId}`;
    let count: number;
    try {
      count = await this.redis.consumeFixedWindow(key, UPLOAD_WINDOW_SEC);
    } catch {
      /* 文件上传不是核心登录链路：配额不可用时宁可暂时拒绝，也不能静默无限落盘 */
      throw new HttpException('上传配额服务暂不可用，请稍后再试', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (count > limit) {
      throw new HttpException('今日图片上传次数已达上限', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * 客服聊天图 / 收款码写入私有目录并登记元数据。
   * 返回的是鉴权 API URL，不再返回可长期转发的公开静态路径。
   */
  async saveUploadedImage(
    actorId: string,
    dataUrl: string,
    kind: 'chat' | 'wechat' | 'alipay',
    policy: CsUploadPolicy,
  ): Promise<{ kind: string; url: string }> {
    if (policy === 'PLAYER_CHAT') {
      await this.assertPlayerCanUpload(actorId);
    }
    const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
      String(dataUrl || '').trim(),
    );
    if (!m) throw new BadRequestException('仅支持 png/jpg/webp 图片');
    const mime = m[1].toLowerCase();
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    let buf: Buffer;
    try {
      buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    } catch {
      throw new BadRequestException('图片数据无效');
    }
    if (buf.length < 64) throw new BadRequestException('图片过小');
    const maxBytes = policy === 'STAFF_PAY_QR'
      ? DEFAULT_PAY_QR_MAX_BYTES
      : this.positiveConfigInt(
        'CS_CHAT_IMAGE_MAX_BYTES',
        DEFAULT_CHAT_IMAGE_MAX_BYTES,
        DEFAULT_PAY_QR_MAX_BYTES,
      );
    if (buf.length > maxBytes) {
      throw new BadRequestException(
        `图片请小于 ${Math.max(1, Math.floor(maxBytes / 1024 / 1024))}MB`,
      );
    }
    if (!isRealImage(buf)) throw new BadRequestException('文件不是有效图片');

    await this.consumeUploadQuota(actorId, policy);
    const safeKind = String(kind || 'chat').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'chat';
    const dir = join(this.mediaRoot(), actorId);
    await mkdir(dir, { recursive: true });
    const filename = `${safeKind}_${Date.now()}_${randomBytes(6).toString('hex')}.${ext}`;
    const storageKey = `${actorId}/${filename}`;
    const filePath = this.mediaFilePath(storageKey);
    await writeFile(filePath, buf, { flag: 'wx' });

    try {
      const retentionDays = this.positiveConfigInt(
        'CS_MEDIA_RETENTION_DAYS',
        DEFAULT_MEDIA_RETENTION_DAYS,
        3650,
      );
      const upload = await this.prisma.csUpload.create({
        data: {
          ownerId: actorId,
          playerId: policy === 'PLAYER_CHAT' ? actorId : null,
          policy,
          kind: safeKind,
          mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime,
          sizeBytes: buf.length,
          storageKey,
          expiresAt: new Date(Date.now() + retentionDays * DAY_MS),
        },
        select: { id: true },
      });
      return { kind: safeKind, url: this.mediaUrl(upload.id) };
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  async openMedia(
    actor: { id: string; role: string },
    mediaId: string,
  ): Promise<{
    path: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    const upload = await this.prisma.csUpload.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        ownerId: true,
        playerId: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        expiresAt: true,
      },
    });
    if (!upload || upload.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('媒体文件不存在或已过期');
    }

    let allowed = upload.ownerId === actor.id;
    const url = this.mediaUrl(upload.id);
    if (!allowed && actor.role === 'PLAYER') {
      allowed =
        upload.playerId === actor.id ||
        !!(await this.prisma.csMessage.findFirst({
          where: { playerId: actor.id, text: { contains: url } },
          select: { id: true },
        }));
    }
    if (!allowed && (actor.role === 'AGENT' || actor.role === 'CS')) {
      const refs = await this.prisma.csMessage.findMany({
        where: { text: { contains: url } },
        select: { playerId: true },
        distinct: ['playerId'],
        take: 200,
      });
      for (const ref of refs) {
        try {
          const { team } = await this.assertPlayerInTeam(
            actor.id,
            ref.playerId,
          );
          if (team.role === 'CS') {
            await this.assertCsOwnsSession(actor.id, ref.playerId);
          }
          allowed = true;
          break;
        } catch (error) {
          if (
            !(error instanceof ForbiddenException) &&
            !(error instanceof NotFoundException)
          ) {
            throw error;
          }
        }
      }
    }
    if (!allowed) {
      throw new ForbiddenException('无权读取该客服媒体');
    }

    const path = this.mediaFilePath(upload.storageKey);
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new NotFoundException('媒体文件不存在');
    }
    if (!info.isFile()) throw new NotFoundException('媒体文件不存在');
    if (info.size !== upload.sizeBytes) {
      this.logger.warn(`客服媒体大小与元数据不符：${upload.id}`);
      throw new NotFoundException('媒体文件校验失败');
    }
    return {
      path,
      filename: basename(path),
      mimeType: upload.mimeType,
      sizeBytes: info.size,
    };
  }

  /** 每日清理 7 天未发送的孤儿文件，以及超过业务保留期的媒体。 */
  @Cron('40 4 * * *', { timeZone: 'Asia/Shanghai' })
  async cleanupExpiredMedia(): Promise<number> {
    const orphanDays = this.positiveConfigInt(
      'CS_MEDIA_ORPHAN_DAYS',
      DEFAULT_ORPHAN_RETENTION_DAYS,
      365,
    );
    const now = new Date();
    const orphanBefore = new Date(now.getTime() - orphanDays * DAY_MS);
    const rows = await this.prisma.csUpload.findMany({
      where: {
        OR: [
          { attachedAt: null, createdAt: { lt: orphanBefore } },
          { expiresAt: { lt: now } },
        ],
      },
      select: { id: true, storageKey: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    let removed = 0;
    for (const row of rows) {
      const path = this.mediaFilePath(row.storageKey);
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(
            `清理客服媒体失败 ${row.id}: ${(error as Error).message}`,
          );
          continue;
        }
      }
      await this.prisma.csUpload.deleteMany({ where: { id: row.id } });
      removed += 1;
    }
    if (removed) this.logger.log(`已清理 ${removed} 个过期客服媒体`);
    return removed;
  }
}
