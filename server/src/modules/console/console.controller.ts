import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query,
  DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConsoleRoomsService } from './console-rooms.service';
import { ConsoleWalletService } from './console-wallet.service';
import { ConsoleControlService } from './console-control.service';
import { ConsoleReportsService } from './console-reports.service';
import { ConsolePlayersService } from './console-players.service';
import type { ConsoleActor } from './console-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLogService } from '../admin/admin-log.service';

const STAFF = ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] as const;

@Controller('console')
@Roles(...STAFF)
export class ConsoleController {
  constructor(
    private rooms: ConsoleRoomsService,
    private wallet: ConsoleWalletService,
    private control: ConsoleControlService,
    private reports: ConsoleReportsService,
    private players: ConsolePlayersService,
    private prisma: PrismaService,
    private adminLog: AdminLogService,
  ) {}

  private actor(u: { id: string; role: string; uid?: string }): ConsoleActor {
    return { id: u.id, role: u.role, uid: u.uid };
  }

  private parseRoomIdsQuery(roomIds?: string | string[]): string[] | undefined {
    if (roomIds == null) return undefined;
    const parts = (Array.isArray(roomIds) ? roomIds : [roomIds])
      .flatMap((s) => String(s).split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? [...new Set(parts)] : undefined;
  }

  // ── 余额 / 级联下发 ──
  @Get('wallet/me')
  myWallet(@CurrentUser() u: { id: string; role: string }) {
    return this.wallet.myBalance(this.actor(u));
  }

  @Post('wallet/issue')
  @Roles('ADMIN', 'BRANCH', 'AGENT')
  issue(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: { toUserId: string; amount: number; remark?: string },
  ) {
    return this.wallet.issue(this.actor(u), body.toUserId, Number(body.amount), body.remark);
  }

  /** 回收代理/子账号额度（下分） */
  @Post('wallet/recall')
  @Roles('ADMIN', 'BRANCH', 'AGENT')
  recall(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: { fromUserId: string; amount: number; remark?: string },
  ) {
    return this.wallet.recall(this.actor(u), body.fromUserId, Number(body.amount), body.remark);
  }

  /** 玩家上下分：代理主账号 + 代分客服；超管/房主只卖额度给代理 */
  @Post('wallet/credit-player')
  @Roles('AGENT', 'PROXY')
  creditPlayer(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: { playerId: string; amount: number; remark?: string; clientRequestId?: string },
  ) {
    return this.wallet.creditPlayer(
      this.actor(u), body.playerId, Number(body.amount), body.remark, body.clientRequestId,
    );
  }

  @Post('wallet/debit-player')
  @Roles('AGENT', 'PROXY')
  debitPlayer(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: { playerId: string; amount: number; remark?: string; clientRequestId?: string },
  ) {
    return this.wallet.debitPlayer(
      this.actor(u), body.playerId, Number(body.amount), body.remark, body.clientRequestId,
    );
  }

  // ── 房间 ──
  @Get('rooms')
  listRooms(
    @CurrentUser() u: { id: string; role: string },
    @Query('includeClosed') includeClosed?: string,
  ) {
    return this.rooms.list(this.actor(u), {
      includeClosed: includeClosed === '1' || includeClosed === 'true',
    });
  }

  @Post('rooms')
  @Roles('ADMIN', 'BRANCH')
  createRoom(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: {
      name: string;
      roomNo?: string;
      enabledGames?: string[];
      status?: string;
      robotCount?: number;
      ownerUserIds?: string[];
      agentUsername?: string;
      agentPassword?: string;
      agentNickname?: string;
      monthlyFee?: number;
      billingDay?: number;
      nextBillAt?: string;
    },
  ) {
    return this.rooms.create(this.actor(u), body);
  }

  @Get('rooms/:id')
  roomDetail(@CurrentUser() u: { id: string; role: string }, @Param('id') id: string) {
    return this.rooms.detail(this.actor(u), id);
  }

  @Post('rooms/:id/bind-agent')
  @Roles('ADMIN', 'BRANCH')
  bindAgent(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { agentUserId: string },
  ) {
    return this.rooms.bindAgent(this.actor(u), id, body.agentUserId);
  }

  /** 重置本房专属代理密码（不可换绑代理） */
  @Post('rooms/:id/reset-agent-password')
  @Roles('ADMIN', 'BRANCH')
  resetAgentPassword(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { password?: string },
  ) {
    return this.rooms.resetAgentPassword(this.actor(u), id, body);
  }

  @Post('rooms/:id/grant-owner')
  @Roles('ADMIN')
  grantOwner(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { ownerUserId: string },
  ) {
    return this.rooms.grantOwner(this.actor(u), id, body.ownerUserId);
  }

  @Post('rooms/:id/revoke-owner')
  @Roles('ADMIN')
  revokeOwner(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { ownerUserId: string },
  ) {
    return this.rooms.revokeOwner(this.actor(u), id, body.ownerUserId);
  }

  @Patch('rooms/:id/status')
  @Roles('ADMIN', 'BRANCH', 'AGENT')
  setRoomStatus(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.rooms.setStatus(this.actor(u), id, body.status);
  }

  @Patch('rooms/:id/billing')
  @Roles('ADMIN', 'BRANCH')
  updateRoomBilling(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { monthlyFee?: number; billingDay?: number; nextBillAt?: string | null },
  ) {
    return this.rooms.updateBilling(this.actor(u), id, body);
  }

  @Post('rooms/:id/delete')
  @Roles('ADMIN')
  deleteRoom(@CurrentUser() u: { id: string; role: string }, @Param('id') id: string) {
    return this.rooms.remove(this.actor(u), id);
  }

  @Post('rooms/:id/rotate-code')
  @Roles('ADMIN', 'BRANCH')
  rotateCode(@CurrentUser() u: { id: string; role: string }, @Param('id') id: string) {
    return this.rooms.rotateCode(this.actor(u), id);
  }

  @Get('rooms/:id/games')
  roomGames(@CurrentUser() u: { id: string; role: string }, @Param('id') id: string) {
    return this.rooms.getGameConfigs(this.actor(u), id);
  }

  @Patch('rooms/:id/games/:gameCode')
  @Roles('ADMIN', 'BRANCH', 'AGENT')
  patchRoomGame(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Param('gameCode') gameCode: string,
    @Body() body: { enabled?: boolean; robotCount?: number; rebateRate?: number | null },
  ) {
    return this.rooms.upsertGameConfig(this.actor(u), id, gameCode, body);
  }

  // ── 玩家 / 代理 ──
  @Get('players')
  listPlayers(
    @CurrentUser() u: { id: string; role: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
    @Query('q') q?: string,
    @Query('roomId') roomId?: string,
  ) {
    return this.players.list(this.actor(u), { page, pageSize, q, roomId });
  }

  @Get('agents')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY')
  listAgents(
    @CurrentUser() u: { id: string; role: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
    @Query('role') role?: string,
    @Query('q') q?: string,
    @Query('boundOnly') boundOnly?: string,
  ) {
    return this.players.listAgents(this.actor(u), {
      page,
      pageSize,
      role,
      q,
      boundOnly: boundOnly === '0' || boundOnly === 'false' ? false : undefined,
    });
  }

  @Get('agents/:userId')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY')
  agentDetail(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
  ) {
    return this.players.getAgentDetail(this.actor(u), userId);
  }

  /** 余额流水 / 上下分 / 操作记录（只读审计，不可删） */
  @Get('agents/:userId/audit')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY')
  agentAudit(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
    @Query('tab') tab?: 'balance' | 'fund' | 'ops',
  ) {
    return this.players.getAgentAudit(this.actor(u), userId, { page, pageSize, tab });
  }

  /** 值班由代理本人设置（玩家点客服时优先落到此人） */
  @Patch('agents/:userId/duty')
  @Roles('AGENT')
  setCsDuty(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Body() body: { dutyUserId?: string | null },
  ) {
    return this.players.setCsDuty(
      this.actor(u),
      userId,
      body.dutyUserId === undefined ? null : body.dutyUserId,
    );
  }

  @Patch('players/:id/status')
  @Roles('AGENT')
  setPlayerStatus(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' },
  ) {
    return this.players.setStatus(this.actor(u), id, body.status);
  }

  @Patch('agents/:userId/rebate-rate')
  @Roles('ADMIN', 'BRANCH', 'AGENT')
  setRebate(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Body() body: { rate: number },
  ) {
    return this.players.setRebateRate(this.actor(u), userId, Number(body.rate));
  }

  @Patch('agents/:userId/commission-rate')
  @Roles('ADMIN', 'BRANCH', 'AGENT')
  setCommission(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Body() body: { rate: number },
  ) {
    return this.players.setCommissionRate(this.actor(u), userId, Number(body.rate));
  }

  @Patch('players/:id/fly')
  @Roles('AGENT')
  setPlayerFly(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { flyEnabled: boolean; roomId?: string },
  ) {
    return this.players.setPlayerFly(this.actor(u), id, !!body.flyEnabled, body.roomId);
  }

  @Patch('players/:id/rebate-rate')
  @Roles('AGENT')
  setPlayerRebate(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { rate: number; roomId?: string },
  ) {
    return this.players.setPlayerRebateRate(this.actor(u), id, Number(body.rate), body.roomId);
  }

  @Post('rooms/:id/fund')
  @Roles('ADMIN', 'BRANCH')
  fundRoom(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { amount: number; remark?: string },
  ) {
    return this.wallet.fundRoom(this.actor(u), id, Number(body.amount), body.remark);
  }

  @Get('rooms/:id/pool')
  async roomPool(@CurrentUser() u: { id: string; role: string }, @Param('id') id: string) {
    await this.rooms.detail(this.actor(u), id);
    return this.wallet.roomPoolBalance(id);
  }

  @Post('agents')
  @Roles('ADMIN', 'BRANCH', 'AGENT')
  createAgent(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: {
      username: string;
      password: string;
      nickname?: string;
      role?: 'BRANCH' | 'AGENT' | 'PROXY';
      parentAgentUserId?: string;
    },
  ) {
    return this.players.createAgent(this.actor(u), body);
  }

  // ── 控奖（仅 ADMIN；Roles 在方法上收紧）──
  @Get('control-policies/meta')
  @Roles('ADMIN')
  controlMeta() {
    return this.control.meta();
  }

  @Get('control-policies')
  @Roles('ADMIN')
  listControl(@CurrentUser() u: { id: string; role: string }) {
    return this.control.list(this.actor(u));
  }

  @Post('control-policies')
  @Roles('ADMIN')
  createControl(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: {
      name: string;
      roomId?: string | null;
      /** 空/null/'__ALL__' = 该房全部彩票 */
      gameCode?: string | null;
      /** 庄家留存%：30 表示 30% */
      holdRatioPct?: number;
      targetValue?: number;
      /** 目标回血金额（必填） */
      goalAmount?: number;
      strength?: number;
      startAt?: string;
      endAt?: string;
      remark?: string;
      activate?: boolean;
    },
  ) {
    return this.control.create(this.actor(u), body);
  }

  @Patch('control-policies/:id/status')
  @Roles('ADMIN')
  controlStatus(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.control.setStatus(this.actor(u), id, body.status);
  }

  @Delete('control-policies/:id')
  @Roles('ADMIN')
  removeControl(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
  ) {
    return this.control.remove(this.actor(u), id);
  }

  // ── 工作台 / 报表 / 对账 ──
  @Get('dashboard')
  dashboard(@CurrentUser() u: { id: string; role: string }) {
    return this.reports.dashboard(this.actor(u));
  }

  @Get('reports/summary')
  reportSummary(
    @CurrentUser() u: { id: string; role: string },
    @Query('roomId') roomId?: string,
    @Query('roomIds') roomIds?: string | string[],
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.summary(this.actor(u), roomId, {
      range,
      from,
      to,
      roomIds: this.parseRoomIdsQuery(roomIds),
    });
  }

  @Get('reports/by-room')
  reportByRoom(
    @CurrentUser() u: { id: string; role: string },
    @Query('roomId') roomId?: string,
    @Query('roomIds') roomIds?: string | string[],
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.byRoom(this.actor(u), {
      range,
      from,
      to,
      roomId,
      roomIds: this.parseRoomIdsQuery(roomIds),
    });
  }

  @Get('reports/reconcile')
  reconcile(@CurrentUser() u: { id: string; role: string }) {
    return this.reports.reconcile(this.actor(u));
  }

  @Get('reports/export')
  exportReport(
    @CurrentUser() u: { id: string; role: string },
    @Query('roomId') roomId?: string,
    @Query('roomIds') roomIds?: string | string[],
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.exportSummaryCsv(this.actor(u), roomId, {
      range,
      from,
      to,
      roomIds: this.parseRoomIdsQuery(roomIds),
    });
  }

  @Get('logs')
  async listLogs(
    @CurrentUser() u: { id: string; role: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
  ) {
    const where =
      u.role === 'ADMIN'
        ? {}
        : { operatorId: u.id };
    const [total, list] = await this.prisma.$transaction([
      this.prisma.adminLog.count({ where }),
      this.prisma.adminLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { operator: { select: { uid: true, nickname: true } } },
      }),
    ]);
    return { total, page, pageSize, list };
  }

  // ── 回水全局政策 ──
  @Get('rebate-policy')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY')
  async getRebatePolicy() {
    const row = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    return row ?? { id: 1, minRate: 0, maxRate: 0.03, defaults: {} };
  }

  @Patch('rebate-policy')
  @Roles('ADMIN')
  async patchRebatePolicy(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: {
      minRate?: number; maxRate?: number; defaults?: object;
      totalRate?: number; playerMinRate?: number;
    },
  ) {
    const row = await this.prisma.rebatePolicy.upsert({
      where: { id: 1 },
      update: {
        ...(body.minRate != null ? { minRate: body.minRate } : {}),
        ...(body.maxRate != null ? { maxRate: body.maxRate } : {}),
        ...(body.defaults != null ? { defaults: body.defaults } : {}),
        ...(body.totalRate != null ? { totalRate: body.totalRate } : {}),
        ...(body.playerMinRate != null ? { playerMinRate: body.playerMinRate } : {}),
      },
      create: {
        id: 1,
        minRate: body.minRate ?? body.playerMinRate ?? 0.018,
        maxRate: body.maxRate ?? 0.05,
        totalRate: body.totalRate ?? 0.05,
        playerMinRate: body.playerMinRate ?? 0.018,
        defaults: body.defaults ?? {},
      },
    });
    await this.adminLog.log(u.id, 'REBATE_POLICY', '1', body as object);
    return row;
  }
}
