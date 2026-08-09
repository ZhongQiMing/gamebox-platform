/**
 * 玩家客服会话：消息、上/下分申请建单、代理/客服回复。
 * 代理看团队全部；客服仅看系统随机派给自己的玩家（粘性会话）。
 */
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { isRealImage } from '../../common/utils/image-magic';
import { RechargeService } from '../recharge/recharge.service';
import { CsStaffService } from '../console/cs-staff.service';

const UP_RE = /^上分\s*\/?\s*(\d+)$/;
const DOWN_RE = /^下分\s*\/?\s*(\d+)$/;

/** 聊天图只允许本站上传路径，禁止外链 */
const CS_IMG_RE = /\[img\](\S+)/gi;
function sanitizeCsMessageText(text: string): string {
  return text.replace(CS_IMG_RE, (_full, url: string) => {
    const u = String(url || '').trim();
    if (/^\/uploads\/[A-Za-z0-9/_.\-]+$/i.test(u) && !u.includes('..')) {
      return `[img]${u}`;
    }
    throw new BadRequestException('图片地址无效，请重新上传发送');
  });
}

const CHANNEL_LABEL: Record<string, string> = {
  wechat: '微信',
  alipay: '支付宝',
  unionpay: '银联',
  bank: '银行卡',
  usdt: 'USDT',
};

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
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => RechargeService))
    private recharge: RechargeService,
    private csStaff: CsStaffService,
  ) {}

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

  /** 玩家发消息；匹配上分/下分则建单并回执 */
  async playerSend(playerId: string, textRaw: string) {
    const text = sanitizeCsMessageText(String(textRaw ?? '').trim());
    if (!text) throw new BadRequestException('消息不能为空');
    if (text.length > 500) throw new BadRequestException('消息过长');

    const assigneeId = await this.resolveAssignee(playerId);
    const playerMsg = await this.prisma.csMessage.create({
      data: {
        playerId,
        sender: 'PLAYER',
        text,
        isRead: false,
        assigneeId,
      },
    });

    const out = [this.serializeMsg(playerMsg)];
    const up = text.match(UP_RE);
    const down = text.match(DOWN_RE);

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

    const text = sanitizeCsMessageText(String(textRaw ?? '').trim());
    if (!text) throw new BadRequestException('消息不能为空');
    if (text.length > 800) throw new BadRequestException('消息过长');

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
    return { quickReplies, wechatQrs, alipayQrs };
  }

  /**
   * 客服聊天图 / 收款码：dataUrl → /uploads/cs/{actorId}/…
   * kind 仅影响文件名前缀（wechat / alipay / chat）
   */
  saveUploadedImage(
    actorId: string,
    dataUrl: string,
    kind = 'chat',
  ): { kind: string; url: string } {
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
    if (buf.length > 8_000_000) throw new BadRequestException('图片请小于 8MB');
    if (!isRealImage(buf)) throw new BadRequestException('文件不是有效图片');

    const safeKind = String(kind || 'chat').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'chat';
    const dir = join(process.cwd(), 'uploads', 'cs', actorId);
    mkdirSync(dir, { recursive: true });
    const filename = `${safeKind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    writeFileSync(join(dir, filename), buf);
    return { kind: safeKind, url: `/uploads/cs/${actorId}/${filename}` };
  }
}
