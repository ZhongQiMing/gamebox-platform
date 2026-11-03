import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AdminLogService } from '../admin/admin-log.service';
import { SHANGHAI_TZ_OFFSET_MS } from '../../common/shanghai-range';
import type { ConsoleActor } from './console-scope.service';

/**
 * 客服响应考核。
 *
 * 一轮 =「玩家问 → 客服答」。计时从玩家发出消息那一刻起算，**已读不算回复**，
 * 必须客服真的回一条、或者直接把这条消息触发的上下分单审掉，才算这一轮结束。
 * 玩家连发多条只开一轮，不叠加罚款。
 *
 * 超过 remindSec 提醒代理；超过 kickSec 强制休息、踢下线、锁号，必须代理点解锁才能再登。
 * 客服线下报备（手机没电之类）后，代理可以免除某一次处罚。
 */

/** 玩家刚发完消息、推送还在路上的这几秒不该算迟到 */
const GRACE_SEC = 30;

/**
 * 心跳超过这么久没来就当人已经走了（划掉 App / 断网 / 关机）。
 * 客服端每 30 秒发一次，这里容忍丢两次再判离线。
 */
const CS_OFFLINE_AFTER_MS = 100_000;

/** 连续休息超过这么久自动锁号，必须代理解锁 */
const CS_REST_LOCK_MS = 60 * 60_000;

export interface CsSlaPolicyView {
  enabled: boolean;
  remindSec: number;
  kickSec: number;
  lateFine: number;
  missFine: number;
  dailyFineCapRate: number;
  bonusMinRate: number;
  bonusMinRounds: number;
  dailyBonus: number;
  streakDays: number;
  streakBonus: number;
}

export function shanghaiDayKey(at: Date | number = Date.now()): string {
  const ms = at instanceof Date ? at.getTime() : at;
  const sh = new Date(ms + SHANGHAI_TZ_OFFSET_MS);
  const y = sh.getUTCFullYear();
  const m = String(sh.getUTCMonth() + 1).padStart(2, '0');
  const d = String(sh.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Injectable()
export class CsSlaService {
  private readonly logger = new Logger(CsSlaService.name);
  private scanning = false;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private adminLog: AdminLogService,
  ) {}

  // ── 规则 ──────────────────────────────────────────────

  async getPolicy(agentUserId: string): Promise<CsSlaPolicyView> {
    const row = await this.prisma.csSlaPolicy.findUnique({ where: { agentUserId } });
    return {
      enabled: row?.enabled ?? true,
      remindSec: row?.remindSec ?? 180,
      kickSec: row?.kickSec ?? 480,
      lateFine: asMoney(row?.lateFine ?? 10),
      missFine: asMoney(row?.missFine ?? 50),
      dailyFineCapRate: row?.dailyFineCapRate ?? 0.5,
      bonusMinRate: row?.bonusMinRate ?? 0.95,
      bonusMinRounds: row?.bonusMinRounds ?? 20,
      dailyBonus: asMoney(row?.dailyBonus ?? 100),
      streakDays: row?.streakDays ?? 7,
      streakBonus: asMoney(row?.streakBonus ?? 500),
    };
  }

  async savePolicy(
    agentUserId: string,
    body: Partial<CsSlaPolicyView>,
  ): Promise<CsSlaPolicyView> {
    const data: Prisma.CsSlaPolicyUncheckedCreateInput = { agentUserId };

    if (body.enabled !== undefined) data.enabled = !!body.enabled;
    if (body.remindSec !== undefined) data.remindSec = this.posInt(body.remindSec, '提醒时限');
    if (body.kickSec !== undefined) data.kickSec = this.posInt(body.kickSec, '踢下线时限');
    if (data.remindSec !== undefined && data.kickSec !== undefined && data.kickSec <= data.remindSec) {
      throw new BadRequestException('踢下线时限必须大于提醒时限');
    }
    if (body.lateFine !== undefined) data.lateFine = this.money(body.lateFine, '超时罚款');
    if (body.missFine !== undefined) data.missFine = this.money(body.missFine, '漏接罚款');
    if (body.dailyFineCapRate !== undefined) {
      data.dailyFineCapRate = this.rate(body.dailyFineCapRate, '单日罚款上限比例');
    }
    if (body.bonusMinRate !== undefined) data.bonusMinRate = this.rate(body.bonusMinRate, '及时率门槛');
    if (body.bonusMinRounds !== undefined) {
      data.bonusMinRounds = this.posInt(body.bonusMinRounds, '接单轮数门槛');
    }
    if (body.dailyBonus !== undefined) data.dailyBonus = this.money(body.dailyBonus, '日奖励');
    if (body.streakDays !== undefined) data.streakDays = this.posInt(body.streakDays, '连续天数');
    if (body.streakBonus !== undefined) data.streakBonus = this.money(body.streakBonus, '连续奖励');

    const { agentUserId: _omit, ...update } = data;
    await this.prisma.csSlaPolicy.upsert({
      where: { agentUserId },
      create: data,
      update,
    });
    return this.getPolicy(agentUserId);
  }

  private posInt(v: unknown, label: string): number {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n <= 0) throw new BadRequestException(`${label}无效`);
    return n;
  }

  private money(v: unknown, label: string): number {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${label}无效`);
    return roundMoney(n);
  }

  private rate(v: unknown, label: string): number {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new BadRequestException(`${label}须在 0~1`);
    return n;
  }

  // ── 值班时长 ──────────────────────────────────────────

  /**
   * 切换空闲/休息时调用：结掉上一段，开一段新的。
   * 值班状态存在服务器，App 被划掉不影响，所以时长不会因为误操作断掉。
   */
  async onWorkStatusChanged(csUserId: string, status: 'IDLE' | 'REST', at = new Date()) {
    await this.closeOpenSpan(csUserId, at);
    await this.prisma.csDutySpan.create({
      data: {
        csUserId,
        status,
        startedAt: at,
        dayKey: shanghaiDayKey(at),
      },
    });
    /* 休息起点单独记一份：连续休息超时要据此锁号，不能靠翻 span 表 */
    await this.prisma.csStaff
      .update({
        where: { userId: csUserId },
        data: { restSinceAt: status === 'REST' ? at : null },
      })
      .catch(() => undefined);
  }

  /**
   * 客服端心跳。
   *
   * App 从最近任务被划掉时进程直接结束，前端跑不了任何「我下班了」的代码，
   * 服务端只能靠心跳断没断来判断人还在不在。
   */
  async heartbeat(csUserId: string, at = new Date()) {
    await this.prisma.csStaff
      .update({ where: { userId: csUserId }, data: { lastSeenAt: at } })
      .catch(() => undefined);
    return { ok: true as const };
  }

  private async closeOpenSpan(csUserId: string, at: Date) {
    const open = await this.prisma.csDutySpan.findFirst({
      where: { csUserId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!open) return;
    const seconds = Math.max(0, Math.round((at.getTime() - open.startedAt.getTime()) / 1000));
    await this.prisma.csDutySpan.update({
      where: { id: open.id },
      data: { endedAt: at, seconds },
    });
  }

  /** 今日空闲/休息秒数。未结束的那一段按「到此刻」实时补上 */
  async dutyToday(csUserId: string, now = new Date()) {
    const dayKey = shanghaiDayKey(now);
    const spans = await this.prisma.csDutySpan.findMany({
      where: { csUserId, dayKey },
    });
    let idleSec = 0;
    let restSec = 0;
    for (const s of spans) {
      const sec = s.endedAt
        ? s.seconds
        : Math.max(0, Math.round((now.getTime() - s.startedAt.getTime()) / 1000));
      if (s.status === 'IDLE') idleSec += sec;
      else restSec += sec;
    }
    return { dayKey, idleSec, restSec };
  }

  // ── 计时开始 / 结束 ───────────────────────────────────

  /**
   * 玩家发来消息：如果该客服在这个玩家身上没有未结的轮次，就开一轮。
   * 连发多条只开一轮——第二条进来时已有未结轮次，直接跳过。
   */
  async openRound(opts: {
    csUserId: string;
    agentUserId: string;
    playerId: string;
    askMessageId: string;
    askedAt: Date;
  }) {
    /* 派回代理本人的会话不考核客服 */
    if (opts.csUserId === opts.agentUserId) return;
    const pending = await this.prisma.csSlaEvent.findFirst({
      where: { csUserId: opts.csUserId, playerId: opts.playerId, repliedAt: null },
      select: { id: true },
    });
    if (pending) return;
    await this.prisma.csSlaEvent
      .create({
        data: {
          csUserId: opts.csUserId,
          agentUserId: opts.agentUserId,
          playerId: opts.playerId,
          askedAt: opts.askedAt,
          askMessageId: opts.askMessageId,
          dayKey: shanghaiDayKey(opts.askedAt),
        },
      })
      .catch(() => undefined); /* askMessageId 唯一，重复写入忽略 */
  }

  /**
   * 会话列表用：这些玩家各自还有没有「等着回复」的轮次，起算时间是几点。
   * 客服端拿它在本地跑秒，不必每秒问服务器。
   */
  async openRoundsByPlayer(playerIds: string[]): Promise<Map<string, Date>> {
    const map = new Map<string, Date>();
    if (!playerIds.length) return map;
    const rows = await this.prisma.csSlaEvent.findMany({
      where: { playerId: { in: playerIds }, repliedAt: null },
      select: { playerId: true, askedAt: true },
      orderBy: { askedAt: 'asc' },
    });
    for (const r of rows) {
      /* 同一玩家理论上只有一轮；真有多轮就以最早那条为准，罚则也是从最早算起 */
      if (!map.has(r.playerId)) map.set(r.playerId, r.askedAt);
    }
    return map;
  }

  /**
   * 客服（或代理）回了一条，或者直接把单审掉了：结掉这个玩家所有未结轮次。
   * 已读不走这里——看了不算回复是刻意的。
   */
  async closeRound(playerId: string, at = new Date()) {
    const open = await this.prisma.csSlaEvent.findMany({
      where: { playerId, repliedAt: null },
    });
    for (const ev of open) {
      const policy = await this.getPolicy(ev.agentUserId);
      const sec = Math.max(0, Math.round((at.getTime() - ev.askedAt.getTime()) / 1000));
      const level = ev.kickedAt
        ? 'MISSED'
        : sec > policy.remindSec + GRACE_SEC
          ? 'LATE'
          : 'ON_TIME';
      const fine = this.fineFor(level, policy);
      await this.prisma.csSlaEvent.update({
        where: { id: ev.id },
        data: { repliedAt: at, responseSec: sec, level, fineAmount: fine },
      });
    }
  }

  private fineFor(level: string, policy: CsSlaPolicyView): number {
    if (level === 'MISSED') return policy.missFine;
    if (level === 'LATE') return policy.lateFine;
    return 0;
  }

  // ── 定时扫描 ──────────────────────────────────────────

  /** 每 20 秒扫一遍未回复的轮次，够钟就提醒 / 踢人 */
  @Cron('*/20 * * * * *')
  async scanOverdue() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      /* 扫描会给客服记罚：取锁失败时跳过，下一分钟就补上，重跑会重复计罚 */
      await this.redis.runExclusive('gamebox:cron:cs-sla', 60_000, async () => {
        await this.doScan();
      }, { onLockError: 'skip' });
    } catch (e) {
      this.logger.error(`cs-sla scan failed: ${(e as Error).message}`);
    } finally {
      this.scanning = false;
    }
  }

  private async doScan(now = new Date()) {
    await this.scanOfflineAndRest(now);

    const open = await this.prisma.csSlaEvent.findMany({
      where: { repliedAt: null },
      take: 500,
    });
    if (!open.length) return;

    /* 同一个代理的规则只读一次 */
    const policies = new Map<string, CsSlaPolicyView>();
    for (const ev of open) {
      if (!policies.has(ev.agentUserId)) {
        policies.set(ev.agentUserId, await this.getPolicy(ev.agentUserId));
      }
      const policy = policies.get(ev.agentUserId)!;
      if (!policy.enabled) continue;

      const waited = Math.round((now.getTime() - ev.askedAt.getTime()) / 1000);

      if (!ev.remindedAt && waited >= policy.remindSec + GRACE_SEC) {
        await this.prisma.csSlaEvent.update({
          where: { id: ev.id },
          data: { remindedAt: now, level: 'LATE', fineAmount: this.fineFor('LATE', policy) },
        });
      }

      if (!ev.kickedAt && waited >= policy.kickSec + GRACE_SEC) {
        /*
         * 罚款在这里就落定，不能等回复时再算。
         * 一直没人回的会话本来就是最该罚的，若只在 closeRound 里算，
         * 它会永远挂着 0 元，代理在绩效页上看到的是「漏接 1 次、罚款 0」。
         */
        await this.prisma.csSlaEvent.update({
          where: { id: ev.id },
          data: {
            kickedAt: now,
            level: 'MISSED',
            fineAmount: this.fineFor('MISSED', policy),
          },
        });
        await this.forceRest(ev.csUserId, `漏接玩家消息超过 ${this.durationText(policy.kickSec)}`);
      }
    }
  }

  /** 不满一分钟就按秒说，否则代理把时限设成 30 秒时提示会变成「超过 0 分钟」 */
  private durationText(sec: number): string {
    if (sec < 60) return `${sec} 秒`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
  }

  /** 强制休息 + 锁号；同时结掉值班时长的那一段 */
  /**
   * 两件事，都在这一趟里做完：
   *
   * 1. 接单中但心跳断了 → 判定人已离开（多半是把 App 划掉了），自动转休息。
   *    不这么做的话，他人早走了，新会话还在往他身上派，几分钟后按漏接罚款并锁号。
   * 2. 连续休息超过上限 → 锁号，必须代理解锁才能再登录。
   */
  private async scanOfflineAndRest(now: Date) {
    /* 心跳每 30 秒一次，容忍两次丢包再判离线 */
    const offlineBefore = new Date(now.getTime() - CS_OFFLINE_AFTER_MS);
    const idle = await this.prisma.csStaff.findMany({
      where: {
        workStatus: 'IDLE',
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: offlineBefore } }],
      },
      select: { userId: true, lastSeenAt: true },
      take: 200,
    });
    for (const staff of idle) {
      /* 刚点「接单」还没来得及发第一次心跳的，先放过一轮 */
      if (!staff.lastSeenAt) {
        await this.prisma.csStaff
          .update({ where: { userId: staff.userId }, data: { lastSeenAt: now } })
          .catch(() => undefined);
        continue;
      }
      await this.onWorkStatusChanged(staff.userId, 'REST', now);
      await this.prisma.csStaff
        .update({ where: { userId: staff.userId }, data: { workStatus: 'REST' } })
        .catch(() => undefined);
      this.logger.log(`客服 ${staff.userId} 心跳中断，自动转为休息`);
    }

    const restLimit = new Date(now.getTime() - CS_REST_LOCK_MS);
    const resting = await this.prisma.csStaff.findMany({
      where: {
        workStatus: 'REST',
        slaLockedAt: null,
        restSinceAt: { not: null, lt: restLimit },
      },
      select: { userId: true },
      take: 200,
    });
    for (const staff of resting) {
      await this.lockAccount(
        staff.userId,
        `连续休息超过 ${Math.round(CS_REST_LOCK_MS / 60_000)} 分钟`,
      );
    }
  }

  /** 锁号并让已签发的令牌立刻失效 */
  private async lockAccount(csUserId: string, reason: string) {
    await this.prisma.csStaff.update({
      where: { userId: csUserId },
      data: { slaLockedAt: new Date(), slaLockReason: reason },
    });
    /* tokenVersion +1 会让已签发的令牌立刻失效，等于把人踢下线 */
    await this.prisma.user
      .update({ where: { id: csUserId }, data: { tokenVersion: { increment: 1 } } })
      .catch(() => undefined);
    this.logger.warn(`客服 ${csUserId} 已锁号：${reason}`);
  }

  private async forceRest(csUserId: string, reason: string) {
    const staff = await this.prisma.csStaff.findUnique({ where: { userId: csUserId } });
    if (!staff) return;
    if (staff.workStatus !== 'REST') {
      await this.onWorkStatusChanged(csUserId, 'REST');
    }
    await this.prisma.csStaff.update({
      where: { userId: csUserId },
      data: { workStatus: 'REST', slaLockedAt: new Date(), slaLockReason: reason },
    });
    /* tokenVersion +1 会让已签发的令牌立刻失效，等于把人踢下线 */
    await this.prisma.user
      .update({ where: { id: csUserId }, data: { tokenVersion: { increment: 1 } } })
      .catch(() => undefined);
    this.logger.warn(`客服 ${csUserId} 因漏接被强制休息并锁号：${reason}`);
  }

  /** 登录/请求时校验：锁住的客服不能再进来，必须代理解锁 */
  async assertNotLocked(csUserId: string) {
    const staff = await this.prisma.csStaff.findUnique({
      where: { userId: csUserId },
      select: { slaLockedAt: true, slaLockReason: true },
    });
    if (staff?.slaLockedAt) {
      throw new ForbiddenException(
        `账号已锁定：${staff.slaLockReason || '漏接玩家消息'}。请联系代理报备后解锁`,
      );
    }
  }

  async unlock(actor: ConsoleActor, csUserId: string) {
    await this.prisma.csStaff.update({
      where: { userId: csUserId },
      data: { slaLockedAt: null, slaLockReason: null },
    });
    await this.adminLog.log(actor.id, 'CS_SLA_UNLOCK', csUserId, {});
    return { ok: true as const };
  }

  /** 代理免除某一次处罚：客服线下报备手机没电之类 */
  async waive(actor: ConsoleActor, eventId: string, reason?: string) {
    const ev = await this.prisma.csSlaEvent.findUnique({ where: { id: eventId } });
    if (!ev) throw new BadRequestException('记录不存在');
    if (ev.waived) return { ok: true as const };
    await this.prisma.csSlaEvent.update({
      where: { id: eventId },
      data: {
        waived: true,
        waivedBy: actor.id,
        waivedAt: new Date(),
        waiveReason: reason?.trim()?.slice(0, 100) || null,
      },
    });
    await this.adminLog.log(actor.id, 'CS_SLA_WAIVE', ev.csUserId, { eventId, reason });
    return { ok: true as const };
  }

  // ── 日结奖惩 ──────────────────────────────────────────

  /**
   * 每天上海时间 04:10 结算前一天的奖惩，写进客服佣金账。
   *
   * 只动佣金，不动客服手里的上分额度——额度是拿去给玩家上分的，扣了会直接影响干活；
   * 佣金才是客服自己的钱，赏罚都该走那里。
   */
  @Cron('10 4 * * *', { timeZone: 'Asia/Shanghai' })
  async settleYesterday() {
    /* 结的是客服工资：取锁失败宁可不跑，漏一天可人工补，重跑要查账 */
    await this.redis.runExclusive('gamebox:cron:cs-sla-settle', 10 * 60_000, async () => {
      const dayKey = shanghaiDayKey(Date.now() - 86_400_000);
      await this.settleDay(dayKey);
    }, { onLockError: 'skip' });
  }

  /** 结算某一天；重复调用不会重复记账（同一天同一客服只写一笔） */
  async settleDay(dayKey: string) {
    const events = await this.prisma.csSlaEvent.findMany({ where: { dayKey } });
    if (!events.length) return { settled: 0 };

    const byCs = new Map<string, typeof events>();
    for (const ev of events) {
      const arr = byCs.get(ev.csUserId) ?? [];
      arr.push(ev);
      byCs.set(ev.csUserId, arr);
    }

    let settled = 0;
    for (const [csUserId, rows] of byCs) {
      const agentUserId = rows[0]!.agentUserId;
      const policy = await this.getPolicy(agentUserId);
      if (!policy.enabled) continue;

      const onTime = rows.filter((r) => r.level === 'ON_TIME').length;
      const total = rows.filter((r) => r.level !== 'PENDING').length;
      /* 被免除的不罚：客服线下报备过，代理认了 */
      const rawFine = rows
        .filter((r) => !r.waived)
        .reduce((sum, r) => sum + asMoney(r.fineAmount), 0);
      const fine = roundMoney(rawFine);

      const rate = total ? onTime / total : 0;
      const hitBonus = total >= policy.bonusMinRounds && rate >= policy.bonusMinRate;
      let bonus = hitBonus ? policy.dailyBonus : 0;
      if (hitBonus && (await this.streakReached(csUserId, dayKey, policy))) {
        bonus = roundMoney(bonus + policy.streakBonus);
      }

      const net = roundMoney(bonus - fine);
      if (net === 0) continue;

      /* refId 唯一化到「客服+日期」，重复结算会被唯一约束或存在性检查挡住 */
      const refId = `cs-sla:${csUserId}:${dayKey}`;
      const exists = await this.prisma.csWageBill.findFirst({
        where: { refType: 'CS_SLA', refId },
        select: { id: true },
      });
      if (exists) continue;

      await this.prisma.csWageBill.create({
        data: {
          csUserId,
          agentUserId,
          playerId: '',
          kind: net >= 0 ? 'SLA_BONUS' : 'SLA_FINE',
          fundAmount: 0,
          wageAmount: net,
          wageRate: 0,
          status: 'PENDING',
          refType: 'CS_SLA',
          refId,
        },
      });
      settled += 1;
    }
    return { settled };
  }

  /** 连续 N 天达标（含当天）才发额外奖 */
  private async streakReached(
    csUserId: string,
    dayKey: string,
    policy: CsSlaPolicyView,
  ): Promise<boolean> {
    const [y, m, d] = dayKey.split('-').map(Number);
    const base = Date.UTC(y!, m! - 1, d!);
    for (let i = 1; i < policy.streakDays; i++) {
      const key = shanghaiDayKey(base - i * 86_400_000 - SHANGHAI_TZ_OFFSET_MS);
      const rows = await this.prisma.csSlaEvent.findMany({ where: { csUserId, dayKey: key } });
      const total = rows.filter((r) => r.level !== 'PENDING').length;
      const onTime = rows.filter((r) => r.level === 'ON_TIME').length;
      if (total < policy.bonusMinRounds) return false;
      if (onTime / total < policy.bonusMinRate) return false;
    }
    return true;
  }

  // ── 统计 ──────────────────────────────────────────────

  /** 代理端绩效页：每个客服一行 */
  async statsByAgent(agentUserId: string, from: Date, to: Date) {
    const [staffRows, events] = await Promise.all([
      this.prisma.csStaff.findMany({
        where: { parentAgentUserId: agentUserId },
        include: { user: { select: { id: true, nickname: true, username: true, status: true } } },
      }),
      this.prisma.csSlaEvent.findMany({
        where: { agentUserId, askedAt: { gte: from, lt: to } },
      }),
    ]);

    const byCs = new Map<string, typeof events>();
    for (const ev of events) {
      const arr = byCs.get(ev.csUserId) ?? [];
      arr.push(ev);
      byCs.set(ev.csUserId, arr);
    }

    const now = new Date();
    const list = [];
    for (const s of staffRows) {
      const rows = byCs.get(s.userId) ?? [];
      const onTime = rows.filter((r) => r.level === 'ON_TIME').length;
      const late = rows.filter((r) => r.level === 'LATE').length;
      const missed = rows.filter((r) => r.level === 'MISSED').length;
      const total = onTime + late + missed;
      const fine = rows
        .filter((r) => !r.waived)
        .reduce((sum, r) => sum + asMoney(r.fineAmount), 0);
      const duty = await this.dutyToday(s.userId, now);
      list.push({
        csUserId: s.userId,
        nickname: s.user.nickname,
        username: s.user.username,
        workStatus: s.workStatus,
        locked: !!s.slaLockedAt,
        lockReason: s.slaLockReason,
        rounds: total,
        onTime,
        late,
        missed,
        onTimeRate: total ? Number((onTime / total).toFixed(4)) : null,
        fine: roundMoney(fine),
        waivedCount: rows.filter((r) => r.waived).length,
        idleSec: duty.idleSec,
        restSec: duty.restSec,
      });
    }
    return { list };
  }

  /** 某客服的超时明细，用于争议时对账 */
  async eventsByCs(csUserId: string, from: Date, to: Date) {
    const rows = await this.prisma.csSlaEvent.findMany({
      where: {
        csUserId,
        askedAt: { gte: from, lt: to },
        level: { in: ['LATE', 'MISSED'] },
      },
      orderBy: { askedAt: 'desc' },
      take: 200,
    });
    const playerIds = [...new Set(rows.map((r) => r.playerId))];
    const players = playerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: playerIds } },
          select: { id: true, nickname: true, uid: true },
        })
      : [];
    const pMap = new Map(players.map((p) => [p.id, p]));
    return {
      list: rows.map((r) => ({
        id: r.id,
        playerId: r.playerId,
        playerNickname: pMap.get(r.playerId)?.nickname ?? '',
        playerUid: pMap.get(r.playerId)?.uid ?? '',
        askedAt: r.askedAt.toISOString(),
        repliedAt: r.repliedAt?.toISOString() ?? null,
        responseSec: r.responseSec,
        level: r.level,
        fine: asMoney(r.fineAmount),
        waived: r.waived,
        waiveReason: r.waiveReason,
      })),
    };
  }
}
