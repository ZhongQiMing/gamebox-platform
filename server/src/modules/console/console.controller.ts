import {
  BadRequestException,
  Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query,
  DefaultValuePipe, ParseIntPipe, forwardRef,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConsoleRoomsService } from './console-rooms.service';
import { ConsoleWalletService } from './console-wallet.service';
import { ConsoleControlService } from './console-control.service';
import { GlobalSoftControlService } from './global-soft-control.service';
import { ConsoleReportsService } from './console-reports.service';
import { ConsolePlayersService } from './console-players.service';
import { CsStaffService } from './cs-staff.service';
import { RoomSettleService } from './room-settle.service';
import type { ConsoleActor } from './console-scope.service';
import { ConsoleScopeService } from './console-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLogService } from '../admin/admin-log.service';
import { RebateService } from '../rebate/rebate.service';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 控制台默认可见角色，**不含客服**。
 *
 * RolesGuard 在方法上找不到 @Roles 时会退到类级，而类级又是「谁都能进」的兜底，
 * 所以只要类级带上 CS，此后每加一个接口客服就自动能读——房间账本、周结对账单、
 * 经营报表、CSV 导出全是这么漏出去的。客服的本职只有给玩家上下分，
 * 需要什么就在方法上单独写 @Roles(..., 'CS')，别再放进这个默认集合。
 *
 * 客服实际可达的接口集合被 console.controller.cs-scope.spec.ts 钉死，改动会被测试拦下。
 *
 * 总代（GENERAL）在里面：它是范围收窄版的管理端，工作台/房间/报表/日志都要看，
 * 数据由 ConsoleScopeService 按 Room.generalAgentId 收到自己名下。
 * 新增**写**接口时务必单独写 @Roles，别让总代顺着兜底拿到不该有的操作。
 */
const OPS = ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'] as const;

/** 回水比例硬上限（20%）：超过这个量级只可能是误配 */
const REBATE_RATE_MAX = 0.2;

/** 代理额度上下分：clientRequestId 兼作订单号与幂等键，缺了会被服务层拒绝 */
export class WalletIssueDto {
  @IsString() @MaxLength(64) toUserId!: string;
  @IsInt() @Min(1) @Max(50_000_000) @Type(() => Number) amount!: number;
  @IsOptional() @IsString() @MaxLength(200) remark?: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: '订单号格式无效' })
  clientRequestId!: string;
}

export class WalletRecallDto {
  @IsString() @MaxLength(64) fromUserId!: string;
  @IsInt() @Min(1) @Max(50_000_000) @Type(() => Number) amount!: number;
  @IsOptional() @IsString() @MaxLength(200) remark?: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: '订单号格式无效' })
  clientRequestId!: string;
}

/** 客服额度划拨/收回：clientRequestId 兼作订单号与幂等键，缺了会被服务层拒绝 */
export class CsStaffFundDto {
  @IsNumber() @Min(0.01) @Max(50_000_000) @Type(() => Number) amount!: number;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: '订单号格式无效' })
  clientRequestId!: string;
}

/**
 * 玩家上下分。
 *
 * 原来是裸对象 body，全局 ValidationPipe 的 whitelist/forbidNonWhitelisted 对它不生效，
 * 金额和订单号只能靠服务层兜。这是真金白银的入口，必须走 DTO。
 */
export class PlayerFundDto {
  @IsString() @MaxLength(64) playerId!: string;
  @IsNumber() @Min(0.01) @Max(50_000_000) @Type(() => Number) amount!: number;
  @IsString() @MaxLength(64) roomId!: string;
  @IsOptional() @IsString() @MaxLength(200) remark?: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: '订单号格式无效' })
  clientRequestId!: string;
}

/**
 * 只含密码的请求体（重置密码 / 二次验密）。
 *
 * 原来是裸对象，whitelist 对 TS 接口不生效：多余字段照进，长度也没有上限。
 * 密码要过 bcrypt，放任超长串等于白送一个廉价的 CPU 消耗面。
 */
export class PasswordDto {
  @IsOptional() @IsString() @MaxLength(128) password?: string;
}

/** 软控偏置：写操作一律带管理员密码二次验证 */
export class SoftBiasCreateDto {
  @IsString() @MaxLength(32) kind!: string;
  @IsString() @MaxLength(64) roomId!: string;
  @IsOptional() @IsString() @MaxLength(64) playerId?: string | null;
  @IsOptional() @IsNumber() @Type(() => Number) biasPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000_000) @Type(() => Number) goalAmount?: number;
  @IsOptional() @IsString() @MaxLength(32) weight?: string;
  @IsOptional() @IsString() @MaxLength(200) remark?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsString() @MaxLength(200) adminPassword!: string;
}

export class SoftBiasToggleDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @MaxLength(200) adminPassword!: string;
}

/** 删除类操作没有 body 也要验密，走 query 之外的显式 body */
export class AdminPasswordDto {
  @IsString() @MaxLength(200) adminPassword!: string;
}

@Controller('console')
@Roles(...OPS)
export class ConsoleController {
  constructor(
    private rooms: ConsoleRoomsService,
    private wallet: ConsoleWalletService,
    private control: ConsoleControlService,
    private globalSoft: GlobalSoftControlService,
    private reports: ConsoleReportsService,
    private players: ConsolePlayersService,
    private csStaff: CsStaffService,
    private settle: RoomSettleService,
    private prisma: PrismaService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
    @Inject(forwardRef(() => RebateService))
    private rebate: RebateService,
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
  /** 客服要看自己口袋里的额度，返回的是本人账户，不含盘口数据 */
  @Get('wallet/me')
  @Roles(...OPS, 'CS')
  myWallet(@CurrentUser() u: { id: string; role: string }) {
    return this.wallet.myBalance(this.actor(u));
  }

  @Post('wallet/issue')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT')
  issue(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: WalletIssueDto,
  ) {
    return this.wallet.issue(
      this.actor(u),
      body.toUserId,
      Number(body.amount),
      body.remark,
      body.clientRequestId,
    );
  }

  /** 回收总代/代理/子账号额度（下分） */
  @Post('wallet/recall')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT')
  recall(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: WalletRecallDto,
  ) {
    return this.wallet.recall(
      this.actor(u),
      body.fromUserId,
      Number(body.amount),
      body.remark,
      body.clientRequestId,
    );
  }

  /** 玩家上下分：主代理 + 客服 */
  @Post('wallet/credit-player')
  @Roles('AGENT', 'CS')
  creditPlayer(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: PlayerFundDto,
  ) {
    return this.wallet.creditPlayer(
      this.actor(u),
      body.playerId,
      Number(body.amount),
      body.roomId,
      body.remark,
      body.clientRequestId,
    );
  }

  @Post('wallet/debit-player')
  @Roles('AGENT', 'CS')
  debitPlayer(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: PlayerFundDto,
  ) {
    return this.wallet.debitPlayer(
      this.actor(u),
      body.playerId,
      Number(body.amount),
      body.roomId,
      body.remark,
      body.clientRequestId,
    );
  }

  // ── 进房审核：列表可读；通过/拒绝仅主代理与管理/房主（子账号只读）──
  @Get('room-members/pending')
  @Roles('AGENT', 'PROXY', 'ADMIN', 'BRANCH')
  pendingJoins(@CurrentUser() u: { id: string; role: string }) {
    return this.rooms.listPendingMembers(this.actor(u));
  }

  @Post('room-members/:id/approve')
  @Roles('AGENT', 'ADMIN', 'BRANCH')
  approveJoin(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
  ) {
    return this.rooms.approveMember(this.actor(u), id);
  }

  @Post('room-members/:id/reject')
  @Roles('AGENT', 'ADMIN', 'BRANCH')
  rejectJoin(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
  ) {
    return this.rooms.rejectMember(this.actor(u), id);
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL')
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
      bookMode?: string;
      generalAgentUserId?: string;
      agentFlowRate?: number;
      agentShareRate?: number;
      creditLimit?: number;
      overIssueLimit?: number;
      settleCycle?: string;
      iconImage?: string;
    },
  ) {
    return this.rooms.create(this.actor(u), body);
  }

  @Get('rooms/:id')
  roomDetail(@CurrentUser() u: { id: string; role: string }, @Param('id') id: string) {
    return this.rooms.detail(this.actor(u), id);
  }

  /** PATCH /api/console/rooms/:id/icon — 上传房间图标（管理/总监/总代/代理） */
  @Patch('rooms/:id/icon')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT')
  updateRoomIcon(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { image?: string },
  ) {
    return this.rooms.updateIcon(this.actor(u), id, String(body?.image || ''));
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
    @Body() body: PasswordDto,
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT')
  setRoomStatus(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.rooms.setStatus(this.actor(u), id, body.status);
  }

  /** 整房飞盘：一键全开/全关本房玩家飞盘开关（仅主代理） */
  @Patch('rooms/:id/fly')
  @Roles('AGENT')
  setRoomFly(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { flyEnabled: boolean },
  ) {
    return this.rooms.setRoomFly(this.actor(u), id, !!body.flyEnabled);
  }

  @Patch('rooms/:id/general-fly')
  @Roles('GENERAL')
  setGeneralRoomFly(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { flyEnabled: boolean },
  ) {
    return this.rooms.setGeneralRoomFly(this.actor(u), id, !!body.flyEnabled);
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

  /** 信用盘：永久加减代理额度（合同+剩余信用同步；direction=up|down） */
  @Post('rooms/:id/credit-limit/bump')
  @Roles('ADMIN', 'BRANCH')
  bumpCreditLimit(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { amount?: number; remark?: string; direction?: 'up' | 'down' },
  ) {
    return this.rooms.bumpCreditLimitByAmount(
      this.actor(u),
      id,
      Number(body?.amount),
      body?.remark,
      body?.direction,
    );
  }

  /** 删房会连带清掉该房的注单/账本关联，跟改软控参数同级：要二次验密 */
  @Post('rooms/:id/delete')
  @Roles('ADMIN')
  async deleteRoom(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: AdminPasswordDto,
  ) {
    const actor = this.actor(u);
    await this.globalSoft.verifyAdminPassword(actor, body?.adminPassword);
    return this.rooms.remove(actor, id);
  }

  // 进房码仅创建时可设，创建后不可换——换码接口停用
  // @Post('rooms/:id/rotate-code')
  // @Roles('ADMIN', 'BRANCH')
  // rotateCode(@CurrentUser() u: { id: string; role: string }, @Param('id') id: string) {
  //   return this.rooms.rotateCode(this.actor(u), id);
  // }

  @Get('rooms/:id/games')
  roomGames(@CurrentUser() u: { id: string; role: string }, @Param('id') id: string) {
    return this.rooms.getGameConfigs(this.actor(u), id);
  }

  /** 代理进本房游戏大厅（自动成员 APPROVED） */
  /** 手机运营端游戏大厅进桌（StaffLobby）；PC 进房间详情不走此接口 */
  @Post('rooms/:id/play-enter')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY')
  playEnter(@CurrentUser() u: { id: string; role: string }, @Param('id') id: string) {
    return this.rooms.playEnter(this.actor(u), id);
  }

  @Patch('rooms/:id/games/:gameCode')
  @Roles('ADMIN', 'BRANCH', 'AGENT')
  patchRoomGame(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Param('gameCode') gameCode: string,
    @Body() body: {
      enabled?: boolean
      robotCount?: number
      rebateRate?: number | null
      robotPlan?: unknown
    },
  ) {
    return this.rooms.upsertGameConfig(this.actor(u), id, gameCode, body);
  }

  @Get('rooms/:id/week-settle')
  roomWeekSettle(@CurrentUser() u: { id: string; role: string }, @Param('id') id: string) {
    return this.settle.overview(this.actor(u), id);
  }

  /** 结账对账单（明细+净应付方向），供结账前给代理确认 */
  @Get('rooms/:id/week-settle/statement')
  roomWeekSettleStatement(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Query('period') period?: 'current' | 'last' | 'early',
    @Query('weekStart') weekStart?: string,
  ) {
    return this.settle.statement(this.actor(u), id, { period, weekStart });
  }

  /** 导出对账单 CSV */
  @Get('rooms/:id/week-settle/export')
  roomWeekSettleExport(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Query('period') period?: 'current' | 'last' | 'early',
    @Query('weekStart') weekStart?: string,
  ) {
    return this.settle.exportStatementCsv(this.actor(u), id, { period, weekStart });
  }

  @Post('rooms/:id/week-settle/mark')
  @Roles('ADMIN', 'BRANCH')
  markRoomWeekSettle(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { weekStart?: string; note?: string; early?: boolean },
  ) {
    return this.settle.markSettled(this.actor(u), id, body);
  }

  /** 信用盘：确认线下已交割实付 */
  @Post('rooms/:id/week-settle/confirm-payment')
  @Roles('ADMIN', 'BRANCH')
  confirmRoomWeekSettlePayment(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { settleId?: string; weekStart?: string; note?: string },
  ) {
    return this.settle.confirmPayment(this.actor(u), id, body);
  }

  // ── 玩家 / 代理 ──
  /** 客服不可浏览玩家列表（仅会话派单可见） */
  @Get('players')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY')
  listPlayers(
    @CurrentUser() u: { id: string; role: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
    @Query('q') q?: string,
    @Query('roomId') roomId?: string,
    @Query('points') points?: string,
  ) {
    return this.players.list(this.actor(u), { page, pageSize, q, roomId, points });
  }

  /** 把好友挂到推荐人名下（仅主代理；按 roomId 隔离） */
  @Post('players/hang')
  @Roles('AGENT')
  hangPlayer(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: { friendUid: string; underUid: string; roomId?: string },
  ) {
    return this.players.hangPlayer(
      this.actor(u),
      body.friendUid,
      body.underUid,
      body.roomId,
    );
  }

  /** 客服仅可查系统派给自己的玩家详情 */
  @Get('players/:id')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS')
  playerDetail(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Query('roomId') roomId?: string,
  ) {
    return this.players.getPlayerDetail(this.actor(u), id, roomId);
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
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS')
  agentAudit(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
    @Query('tab') tab?: 'balance' | 'fund' | 'ops' | 'wage',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('fundType') fundType?: string,
  ) {
    return this.players.getAgentAudit(this.actor(u), userId, {
      page,
      pageSize,
      tab,
      from,
      to,
      fundType,
    });
  }

  /** 值班仅代理本人可设（玩家点客服时优先落到此人） */
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

  @Patch('agents/:userId/status')
  @Roles('ADMIN', 'BRANCH')
  setProxyStatus(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' },
  ) {
    return this.players.setProxyStatus(this.actor(u), userId, body.status);
  }

  @Post('agents/:userId/reset-password')
  @Roles('ADMIN', 'BRANCH')
  resetProxyPassword(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Body() body: PasswordDto,
  ) {
    return this.players.resetProxyPassword(this.actor(u), userId, body.password);
  }

  /** 改子账号显示名：管理员/房主/所属主代理 */
  @Patch('agents/:userId/nickname')
  @Roles('ADMIN', 'BRANCH', 'AGENT')
  renameProxyNickname(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Body() body: { nickname: string },
  ) {
    return this.players.renameProxyNickname(this.actor(u), userId, body.nickname);
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

  /** 重置玩家密码并解冻（仅管理 / 房主） */
  @Post('players/:id/reset-password')
  @Roles('ADMIN', 'BRANCH')
  resetPlayerPassword(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: PasswordDto,
  ) {
    return this.players.resetPlayerPassword(this.actor(u), id, body?.password);
  }

  /** 调整总代与平台的合同信用额度：合同与剩余信用同增同减 */
  @Post('agents/:userId/credit-limit/bump')
  @Roles('ADMIN', 'BRANCH')
  bumpGeneralCreditLimit(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Body() body: { amount?: number; direction?: 'up' | 'down'; remark?: string },
  ) {
    return this.players.bumpGeneralCreditLimit(
      this.actor(u),
      userId,
      Number(body?.amount ?? 0),
      body?.direction === 'down' ? 'down' : 'up',
      body?.remark,
    );
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

  /** 批量查玩家待领回水（回水设置列表） */
  @Post('players/rebate-brief')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY')
  async playersRebateBrief(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: { playerIds?: string[] },
  ) {
    const ids = [...new Set((body.playerIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
    if (ids.length > 50) throw new BadRequestException('一次最多 50 个玩家');
    const actor = this.actor(u);
    for (const id of ids) {
      if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, id);
    }
    return this.rebate.getClaimableBriefs(ids);
  }

  /** 单玩家回水状态（含待领） */
  @Get('players/:id/rebate')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY')
  async playerRebateStatus(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
  ) {
    const actor = this.actor(u);
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, id);
    return this.rebate.getStatus(id, 'today');
  }

  /** 代理代玩家提前领取全部可领回水（含今日，对应 6:00 自动逻辑的手动版） */
  @Post('players/:id/rebate/claim')
  @Roles('AGENT')
  async claimPlayerRebate(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
  ) {
    const actor = this.actor(u);
    await this.scope.assertUserInScope(actor, id);
    const res = await this.rebate.claimAll(id, 'MANUAL');
    await this.adminLog.log(actor.id, 'PLAYER_REBATE_CLAIM', id, {
      amount: res.amount,
      dates: res.dates,
    });
    return res;
  }

  @Post('agents')
  @Roles('ADMIN', 'BRANCH')
  createAgent(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: {
      username: string;
      password: string;
      nickname?: string;
      role?: 'BRANCH' | 'AGENT' | 'PROXY' | 'GENERAL';
      parentAgentUserId?: string;
      flowRate?: number;
      shareRate?: number;
      /** 以下三项仅总代：与平台的盘口、合同额度、结算周期 */
      bookMode?: string;
      creditLimit?: number;
      settleCycle?: string;
    },
  ) {
    return this.players.createAgent(this.actor(u), body);
  }

  // ── 控奖（仅 ADMIN；Roles 在方法上收紧）──
  @Get('control-games')
  @Roles('ADMIN')
  listControlGames(@CurrentUser() u: { id: string; role: string }) {
    return this.control.listControlGames(this.actor(u));
  }

  @Get('control-policies')
  @Roles('ADMIN')
  listControl(@CurrentUser() u: { id: string; role: string }) {
    return this.control.list(this.actor(u));
  }

  @Post('control-policies')
  @Roles('ADMIN')
  createControl(@CurrentUser() u: { id: string; role: string }) {
    return this.control.create(this.actor(u), {} as never);
  }

  @Get('global-soft-biases')
  @Roles('ADMIN')
  listSoftBiases(@CurrentUser() u: { id: string; role: string }) {
    return this.globalSoft.listBiases(this.actor(u));
  }

  /*
   * 偏置与控奖策略的写操作一律二次验密。
   *
   * 改全局软控参数早就要验密了，可「给某房某人开一条偏置」同样能左右开奖结果，
   * 之前却只认 JWT——token 一旦外泄，攻击者不必碰参数页也能把结果往一边带。
   */
  @Post('global-soft-biases')
  @Roles('ADMIN')
  async createSoftBias(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: SoftBiasCreateDto,
  ) {
    const actor = this.actor(u);
    await this.globalSoft.verifyAdminPassword(actor, body.adminPassword);
    const { adminPassword: _pwd, ...bias } = body;
    return this.globalSoft.createBias(actor, bias);
  }

  @Patch('global-soft-biases/:id')
  @Roles('ADMIN')
  async patchSoftBias(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: SoftBiasToggleDto,
  ) {
    const actor = this.actor(u);
    await this.globalSoft.verifyAdminPassword(actor, body.adminPassword);
    return this.globalSoft.setBiasEnabled(actor, id, body.enabled);
  }

  @Delete('global-soft-biases/:id')
  @Roles('ADMIN')
  async removeSoftBias(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: AdminPasswordDto,
  ) {
    const actor = this.actor(u);
    await this.globalSoft.verifyAdminPassword(actor, body?.adminPassword);
    return this.globalSoft.removeBias(actor, id);
  }

  @Patch('control-policies/:id/status')
  @Roles('ADMIN')
  async controlStatus(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { status: string } & AdminPasswordDto,
  ) {
    const actor = this.actor(u);
    await this.globalSoft.verifyAdminPassword(actor, body?.adminPassword);
    return this.control.setStatus(actor, id, body.status);
  }

  @Delete('control-policies/:id')
  @Roles('ADMIN')
  async removeControl(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: AdminPasswordDto,
  ) {
    const actor = this.actor(u);
    await this.globalSoft.verifyAdminPassword(actor, body?.adminPassword);
    return this.control.remove(actor, id);
  }

  /** 全站全局软控：配置 + 上海日账实况 */
  @Get('global-soft-control')
  @Roles('ADMIN')
  globalSoftControl(@CurrentUser() u: { id: string; role: string }) {
    return this.globalSoft.getOverview(this.actor(u));
  }

  @Post('verify-admin-password')
  @Roles('ADMIN')
  verifyAdminPassword(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: PasswordDto,
  ) {
    return this.globalSoft.verifyAdminPassword(this.actor(u), String(body?.password || ''));
  }

  @Put('global-soft-control')
  @Roles('ADMIN')
  saveGlobalSoftControl(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: {
      enabled?: boolean;
      minFlowToControl?: number;
      targetNetPct?: number;
      bandLowPct?: number;
      bandHighPct?: number;
      maxPeriodWinPct?: number;
      maxPeriodLossPct?: number;
      candidateTries?: number;
      candidateTriesHalt?: number;
      candidateTriesBoost?: number;
      playerBrakeEnabled?: boolean;
      playerBrakeMultiple?: number;
      arcadeRtpTarget?: number;
      arcadeCandidateTries?: number;
      arcadePoolWindowDays?: number;
      cooldownEnabled?: boolean;
      gearMode?: 'AUTO' | 'FORCE_NORMAL' | 'FORCE_RECOVER';
      adminPassword?: string;
    },
  ) {
    return this.globalSoft.update(this.actor(u), body);
  }

  // ── 工作台 / 报表 / 对账 ──
  @Get('dashboard')
  dashboard(@CurrentUser() u: { id: string; role: string }) {
    return this.reports.dashboard(this.actor(u));
  }

  @Get('dashboard/trend')
  @Roles('ADMIN', 'BRANCH')
  dashboardTrend(
    @CurrentUser() u: { id: string; role: string },
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days = 7,
  ) {
    return this.reports.landlordTrend(this.actor(u), days);
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

  @Get('reports/room-bets')
  reportRoomBets(
    @CurrentUser() u: { id: string; role: string },
    @Query('roomId') roomId?: string,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('playerId') playerId?: string,
    @Query('gameCode') gameCode?: string,
  ) {
    if (!roomId?.trim()) throw new BadRequestException('缺少 roomId');
    return this.reports.listRoomBets(this.actor(u), roomId.trim(), {
      range,
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      playerId,
      gameCode,
    });
  }

  /** 代理团队玩家有效流水榜（早茶对照）；默认昨日。客服不可浏览全量玩家。 */
  @Get('reports/player-flow')
  @Roles('AGENT', 'PROXY')
  reportPlayerFlow(
    @CurrentUser() u: { id: string; role: string },
    @Query('range') range?: string,
    @Query('limit') limit?: string,
    @Query('playerId') playerId?: string,
  ) {
    return this.reports.playerFlow(this.actor(u), {
      range,
      limit: limit ? Number(limit) : undefined,
      playerId,
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
    const take = Math.min(Math.max(pageSize, 1), 100);
    const [total, list] = await this.prisma.$transaction([
      this.prisma.adminLog.count({ where }),
      this.prisma.adminLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(page, 1) - 1) * take,
        take,
        include: { operator: { select: { uid: true, nickname: true } } },
      }),
    ]);
    return { total, page, pageSize: take, list };
  }

  // ── 回水全局政策 ──
  @Get('rebate-policy')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
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
      generalDefaultRate?: number; generalMaxRate?: number; agentDefaultRate?: number;
    },
  ) {
    /* 回水比例误配成 1（100%）会让飞盘每笔流水都从平台池往外打钱，必须有硬上限 */
    const assertRate = (v: number | undefined, label: string) => {
      if (v == null) return;
      if (!Number.isFinite(v) || v < 0 || v > REBATE_RATE_MAX) {
        throw new BadRequestException(
          `${label}须在 0~${REBATE_RATE_MAX}（${REBATE_RATE_MAX * 100}%）之间`,
        );
      }
    };
    assertRate(body.minRate, '最低回水比例');
    assertRate(body.maxRate, '最高回水比例');
    assertRate(body.totalRate, '回水总比例');
    assertRate(body.playerMinRate, '玩家最低回水比例');
    assertRate(body.generalDefaultRate, '总代整包默认');
    assertRate(body.generalMaxRate, '总代整包上限');
    assertRate(body.agentDefaultRate, '代理整包默认');
    if (body.playerMinRate != null && body.totalRate != null
      && body.playerMinRate > body.totalRate) {
      throw new BadRequestException('玩家最低回水比例不能高于总比例');
    }

    const row = await this.prisma.rebatePolicy.upsert({
      where: { id: 1 },
      update: {
        ...(body.minRate != null ? { minRate: body.minRate } : {}),
        ...(body.maxRate != null ? { maxRate: body.maxRate } : {}),
        ...(body.defaults != null ? { defaults: body.defaults } : {}),
        ...(body.totalRate != null ? { totalRate: body.totalRate } : {}),
        ...(body.playerMinRate != null ? { playerMinRate: body.playerMinRate } : {}),
        ...(body.generalDefaultRate != null ? { generalDefaultRate: body.generalDefaultRate } : {}),
        ...(body.generalMaxRate != null ? { generalMaxRate: body.generalMaxRate } : {}),
        ...(body.agentDefaultRate != null ? { agentDefaultRate: body.agentDefaultRate } : {}),
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

  // ── 客服账号（管理员/房主开号；代理划额与设置） ──
  @Get('cs-staff/me')
  @Roles('CS')
  myCsStaff(@CurrentUser() u: { id: string; role: string }) {
    return this.csStaff.detail(u.id);
  }

  @Get('cs-staff')
  @Roles('ADMIN', 'BRANCH', 'AGENT')
  listCsStaff(
    @CurrentUser() u: { id: string; role: string },
    @Query('parentAgentUserId') parentAgentUserId?: string,
  ) {
    return this.csStaff.list(this.actor(u), parentAgentUserId);
  }

  @Post('cs-staff')
  @Roles('ADMIN', 'BRANCH')
  createCsStaff(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: {
      username?: string;
      password?: string;
      nickname?: string;
      parentAgentUserId?: string;
    },
  ) {
    return this.csStaff.create(this.actor(u), body ?? {});
  }

  @Get('cs-staff/wage/bills')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'CS')
  listCsWageBills(
    @CurrentUser() u: { id: string; role: string },
    @Query('csUserId') csUserId?: string,
    @Query('status') status?: 'PENDING' | 'SETTLED' | 'ALL',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.csStaff.listWageBills(this.actor(u), {
      csUserId,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('cs-staff/wage/settle')
  @Roles('AGENT')
  settleCsWage(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: { billId?: string; csUserId?: string },
  ) {
    return this.csStaff.settleWage(this.actor(u), body ?? {});
  }

  @Post('cs-staff/:id/allocate')
  @Roles('AGENT')
  allocateCsStaff(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: CsStaffFundDto,
  ) {
    return this.csStaff.allocate(
      this.actor(u),
      id,
      Number(body.amount),
      body.clientRequestId,
    );
  }

  @Post('cs-staff/:id/recall')
  @Roles('AGENT')
  recallCsStaff(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: CsStaffFundDto,
  ) {
    return this.csStaff.recall(
      this.actor(u),
      id,
      Number(body.amount),
      body.clientRequestId,
    );
  }

  @Patch('cs-staff/:id')
  @Roles('ADMIN', 'BRANCH', 'AGENT', 'CS')
  patchCsStaff(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: {
      wageRate?: number;
      idleWeight?: number;
      workStatus?: string;
      nickname?: string;
    },
  ) {
    return this.csStaff.patchSettings(this.actor(u), id, body ?? {});
  }

  @Patch('cs-staff/:id/status')
  @Roles('ADMIN', 'BRANCH')
  setCsStaffStatus(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' },
  ) {
    return this.csStaff.setStatus(this.actor(u), id, body.status);
  }

  @Post('cs-staff/:id/reset-password')
  @Roles('ADMIN', 'BRANCH')
  resetCsStaffPassword(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: PasswordDto,
  ) {
    return this.csStaff.resetPassword(this.actor(u), id, body?.password);
  }
}
