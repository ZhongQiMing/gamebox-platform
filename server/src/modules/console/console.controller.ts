import {
  BadRequestException,
  Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query,
  DefaultValuePipe, ParseIntPipe, forwardRef,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConsoleRoomsService } from './console-rooms.service';
import { ConsoleWalletService } from './console-wallet.service';
import { ConsoleControlService } from './console-control.service';
import { GlobalSoftControlService } from './global-soft-control.service';
import { SoftControlAuditService } from './soft-control-audit.service';
import { ConsoleReportsService } from './console-reports.service';
import { ConsolePlayersService } from './console-players.service';
import { CsStaffService } from './cs-staff.service';
import { CsSlaService } from './cs-sla.service';
import { isTimeRangeKey, shanghaiRangeBounds } from '../../common/shanghai-range';
import { RoomSettleService } from './room-settle.service';
import { GeneralSettleService } from './general-settle.service';
import { ConsoleLiveService } from './console-live.service';
import type { ConsoleActor } from './console-scope.service';
import { ConsoleRebatePolicyService } from './console-rebate-policy.service';
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

/** 结算页签取值归一化：本期 / 上期 / 提前结账，非法值一律当上期 */
function settlePeriodKey(v?: string): 'current' | 'last' | 'early' {
  return v === 'current' || v === 'early' ? v : 'last';
}

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
    private softAudit: SoftControlAuditService,
    private reports: ConsoleReportsService,
    private players: ConsolePlayersService,
    private csStaff: CsStaffService,
    private csSla: CsSlaService,
    private settle: RoomSettleService,
    private generalSettle: GeneralSettleService,
    private live: ConsoleLiveService,
    private rebatePolicy: ConsoleRebatePolicyService,
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

  /**
   * 下发额度给总代/代理。
   *
   * PROXY 留着是给**总代侧子账号**用的（服务里按 isGeneralSide 当成总代）；
   * AGENT 曾在这里，但代理无论发给谁都会被层级校验拒掉，是个点了必失败的空入口，已摘。
   */
  @Post('wallet/issue')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
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

  /** 回收总代/代理额度（下分）；PROXY 同 issue，仅总代侧子账号有效 */
  @Post('wallet/recall')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
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
  @Roles('AGENT', 'PROXY', 'ADMIN', 'BRANCH', 'GENERAL')
  pendingJoins(@CurrentUser() u: { id: string; role: string }) {
    return this.rooms.listPendingMembers(this.actor(u));
  }

  @Post('room-members/:id/approve')
  @Roles('AGENT', 'ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
  approveJoin(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
  ) {
    return this.rooms.approveMember(this.actor(u), id);
  }

  @Post('room-members/:id/reject')
  @Roles('AGENT', 'ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
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
      /* 总代/代理传这个也不给已关闭，服务里还要验角色 */
      includeClosed: includeClosed === '1' || includeClosed === 'true',
    });
  }

  @Post('rooms')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
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

  /** 某总代当前对哪些总监可见（含全部总监名单，供前端做勾选） */
  @Get('generals/:id/owners')
  @Roles('ADMIN', 'BRANCH')
  generalOwners(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
  ) {
    return this.players.generalOwners(this.actor(u), id);
  }

  /**
   * 开/关某个总监对该总代的可见性。
   * 关掉后这个总监看不到该总代本人、名下房间、代理、玩家、报表与结算。
   */
  @Post('generals/:id/owner')
  @Roles('ADMIN')
  setGeneralOwner(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { ownerUserId: string; visible: boolean },
  ) {
    return this.players.setGeneralOwner(
      this.actor(u),
      id,
      body.ownerUserId,
      !!body.visible,
    );
  }

  @Patch('rooms/:id/status')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
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
  @Roles('GENERAL', 'PROXY')
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
  bumpCreditLimit(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: {
      amount?: number;
      remark?: string;
      direction?: 'up' | 'down';
      clientRequestId?: string;
    },
  ) {
    return this.rooms.bumpCreditLimitByAmount(
      this.actor(u),
      id,
      Number(body?.amount),
      body?.remark,
      body?.direction,
      body?.clientRequestId,
    );
  }

  /**
   * 「删房」其实是关房（status=CLOSED），注单与账本一律保留、不做物理删除。
   * 玩家仍能申请下分把分取走，代理照样能审。
   * 之所以要二次验密：关房会让全房玩家进不去，影响面等同改软控参数。
   */
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

  /**
   * 真删除空房。有过注单/账本的会拒绝，避免对账断档。
   */
  @Post('rooms/:id/purge')
  @Roles('ADMIN')
  async purgeRoom(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: AdminPasswordDto,
  ) {
    const actor = this.actor(u);
    await this.globalSoft.verifyAdminPassword(actor, body?.adminPassword);
    return this.rooms.purge(actor, id);
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
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

  /**
   * 应付账龄：已结账但线下一直没交割的单子。
   *
   * 现金盘占成交割在系统外完成，漏确认就等于漏付，原先没有任何看板与提醒。
   * 定时巡检每天会把逾期的记进风控事件，这个接口给后台直接查。
   */
  @Get('settle/aged-payables')
  @Roles('ADMIN', 'BRANCH')
  agedPayables(
    @CurrentUser() u: { id: string; role: string },
    @Query('overdueDays') overdueDays?: string,
  ) {
    const days = Number(overdueDays);
    return this.settle.agedPayables(
      Number.isFinite(days) && days > 0 ? days : undefined,
      this.actor(u),
    );
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
  markRoomWeekSettle(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { weekStart?: string; note?: string; early?: boolean },
  ) {
    return this.settle.markSettled(this.actor(u), id, body);
  }

  /** 信用盘：确认线下已交割实付 */
  @Post('rooms/:id/week-settle/confirm-payment')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY', 'CS')
  playerDetail(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Query('roomId') roomId?: string,
  ) {
    return this.players.getPlayerDetail(this.actor(u), id, roomId);
  }

  /** 玩家画像：资金/风险/游戏偏好，只给管理与总监 */
  @Get('players/:id/profile')
  @Roles('ADMIN', 'BRANCH')
  playerProfile(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Query('roomId') roomId?: string,
  ) {
    return this.players.getPlayerProfile(this.actor(u), id, roomId);
  }

  @Get('agents')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
  agentDetail(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
  ) {
    return this.players.getAgentDetail(this.actor(u), userId);
  }

  /** 余额流水 / 上下分 / 操作记录（只读审计，不可删） */
  @Get('agents/:userId/audit')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY', 'CS')
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
  setProxyStatus(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' },
  ) {
    return this.players.setProxyStatus(this.actor(u), userId, body.status);
  }

  @Post('agents/:userId/reset-password')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
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

  /** 重置玩家密码并解冻：管理/总监全部可见玩家；总代仅名下房间 */
  @Post('players/:id/reset-password')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
  resetPlayerPassword(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: PasswordDto,
  ) {
    return this.players.resetPlayerPassword(this.actor(u), id, body?.password);
  }

  // ── 总代账期结算（平台 ↔ 总代，按总代自己的周期汇总名下所有房间）──
  /** 汇总对账单：一行总代、下面每房一行 */
  @Get('general-settle/statement')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
  generalSettleStatement(
    @CurrentUser() u: { id: string; role: string },
    @Query('generalUserId') generalUserId?: string,
    @Query('period') period?: 'current' | 'last' | 'early',
    @Query('periodStart') periodStart?: string,
  ) {
    return this.generalSettle.statement(this.actor(u), {
      generalUserId,
      period: settlePeriodKey(period),
      periodStart,
    });
  }

  @Get('general-settle/history')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
  generalSettleHistory(
    @CurrentUser() u: { id: string; role: string },
    @Query('generalUserId') generalUserId?: string,
    @Query('take', new DefaultValuePipe(20), ParseIntPipe) take = 20,
  ) {
    return this.generalSettle.history(this.actor(u), generalUserId, take);
  }

  /** 总代工资条：汇总 + 分房明细，Excel 可直接打开 */
  @Get('general-settle/export')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
  generalSettleExport(
    @CurrentUser() u: { id: string; role: string },
    @Query('generalUserId') generalUserId?: string,
    @Query('period') period?: 'current' | 'last' | 'early',
    @Query('periodStart') periodStart?: string,
  ) {
    return this.generalSettle.exportStatementCsv(this.actor(u), {
      generalUserId,
      period: settlePeriodKey(period),
      periodStart,
    });
  }

  /** 未挂总代房间总表（礼拜一账期） */
  @Get('general-settle/direct-statement')
  @Roles('ADMIN', 'BRANCH')
  generalSettleDirectStatement(
    @CurrentUser() u: { id: string; role: string },
    @Query('period') period?: 'current' | 'last',
  ) {
    return this.generalSettle.directStatement(this.actor(u), {
      period: period === 'current' ? 'current' : 'last',
    });
  }

  @Get('general-settle/direct-export')
  @Roles('ADMIN', 'BRANCH')
  generalSettleDirectExport(
    @CurrentUser() u: { id: string; role: string },
    @Query('period') period?: 'current' | 'last',
  ) {
    return this.generalSettle.exportDirectCsv(this.actor(u), {
      period: period === 'current' ? 'current' : 'last',
    });
  }

  /** 结清一个账期：汇总与每房明细定格成快照 */
  @Post('general-settle/:generalUserId/settle')
  @Roles('ADMIN', 'BRANCH')
  settleGeneralPeriod(
    @CurrentUser() u: { id: string; role: string },
    @Param('generalUserId') generalUserId: string,
    @Body() body: { period?: 'current' | 'last' | 'early'; note?: string },
  ) {
    return this.generalSettle.settle(this.actor(u), generalUserId, {
      period: settlePeriodKey(body?.period),
      note: body?.note,
    });
  }

  /** 调整总代与平台的合同信用额度：合同与剩余信用同增同减 */
  @Post('agents/:userId/credit-limit/bump')
  @Roles('ADMIN', 'BRANCH')
  bumpGeneralCreditLimit(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Body() body: {
      amount?: number;
      direction?: 'up' | 'down';
      remark?: string;
      clientRequestId?: string;
    },
  ) {
    return this.players.bumpGeneralCreditLimit(
      this.actor(u),
      userId,
      Number(body?.amount ?? 0),
      body?.direction === 'down' ? 'down' : 'up',
      body?.remark,
      body?.clientRequestId,
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
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
      /** 以下四项仅总代：与平台的盘口、合同额度、结算周期、每间房月费单价 */
      bookMode?: string;
      creditLimit?: number;
      settleCycle?: string;
      roomMonthlyFee?: number;
      /** 建总代时勾选哪些总监可见；仅管理有效，不传=全员可见 */
      ownerUserIds?: string[];
    },
  ) {
    return this.players.createAgent(this.actor(u), body);
  }

  /** 改总代每间房缴给平台的月费单价：只有平台自己能定价 */
  @Patch('agents/:userId/room-monthly-fee')
  @Roles('ADMIN', 'BRANCH')
  setGeneralRoomMonthlyFee(
    @CurrentUser() u: { id: string; role: string },
    @Param('userId') userId: string,
    @Body() body: { amount: number },
  ) {
    return this.players.setGeneralRoomMonthlyFee(
      this.actor(u),
      userId,
      Number(body?.amount ?? 0),
    );
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

  /**
   * 软控介入明细：每一次「放弃自然结果」都在这里，含本来会开什么。
   * 仅 ADMIN；总监/总代/代理/客服一律看不到。
   */
  @Get('soft-control-audit')
  @Roles('ADMIN')
  softControlAudit(
    @Query('category') category?: 'lottery' | 'table' | 'arcade',
    @Query('gameCode') gameCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize = 50,
  ) {
    return this.softAudit.list({
      category,
      gameCode: gameCode?.trim() || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page,
      pageSize,
    });
  }

  /** 软控介入率概览：分母取同期实开局数，仅 ADMIN */
  @Get('soft-control-audit/summary')
  @Roles('ADMIN')
  softControlAuditSummary(@Query('from') from?: string, @Query('to') to?: string) {
    const to2 = to ? new Date(to) : new Date();
    const from2 = from ? new Date(from) : new Date(to2.getTime() - 7 * 24 * 3600_000);
    return this.softAudit.summary({ from: from2, to: to2 });
  }

  /**
   * 二次密码校验，是全站软控和资金补记的最后一道闸，必须比普通接口更紧：
   * 全局 120/分 足够在一分钟里试两千次常见口令。会话已经是 ADMIN 才走到这，
   * 所以限的是「拿到别人电脑/会话后暴力猜密码」，正常人点确认不会超过几次。
   */
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
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

  /*
   * 原先这里还有一个 GET console/logs：非超管只按 operatorId 过滤，
   * 看不到下级操作、却能翻到自己以外的分页边界，隔离比 /admin/logs 弱一截。
   * 前端一直走 /admin/logs（那边按管辖用户树收窄），这个入口没人用，已删。
   */

  // ── 实时开奖（每期结果 + 当期/今日下注）──
  @Get('live-draws')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
  liveDraws(@CurrentUser() u: { id: string; role: string; uid?: string }) {
    return this.live.list(this.actor(u));
  }

  // ── 回水规则（管理定三层框；总代改代理/玩家；代理只改玩家）──
  @Get('rebate-policy')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
  getRebatePolicy(
    @CurrentUser() u: { id: string; role: string; uid?: string },
    @Query('roomId') roomId?: string,
  ) {
    return this.rebatePolicy.getForActor(this.actor(u), roomId);
  }

  @Patch('rebate-policy')
  @Roles('ADMIN', 'GENERAL', 'AGENT', 'PROXY')
  patchRebatePolicy(
    @CurrentUser() u: { id: string; role: string; uid?: string },
    @Body() body: {
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
      downlineFlowRate?: number;
      rebateRate?: number;
      games?: Array<{
        gameCode?: string;
        mineRate?: number;
        generalMin?: number; generalDefault?: number; generalMax?: number;
        agentMin?: number; agentDefault?: number; agentMax?: number;
        playerMin?: number; playerDefault?: number; playerMax?: number;
      }>;
      gameCode?: string;
      mineRate?: number;
    },
  ) {
    return this.rebatePolicy.patchForActor(this.actor(u), body ?? {});
  }

  // ── 客服响应考核（代理设规则、看绩效、解锁、免除处罚） ──

  /** 本代理的考核规则；时限与奖惩金额都由代理自己定 */
  @Get('cs-sla/policy')
  @Roles('AGENT', 'PROXY')
  async getCsSlaPolicy(@CurrentUser() u: { id: string; role: string }) {
    const agentId = await this.scope.scopeRootUserId(this.actor(u));
    return this.csSla.getPolicy(agentId);
  }

  @Put('cs-sla/policy')
  @Roles('AGENT')
  async saveCsSlaPolicy(
    @CurrentUser() u: { id: string; role: string },
    @Body() body: Record<string, unknown>,
  ) {
    const agentId = await this.scope.scopeRootUserId(this.actor(u));
    return this.csSla.savePolicy(agentId, body as never);
  }

  /** 绩效：每个客服的及时 / 超时 / 漏接 / 罚款 / 今日在线时长 */
  @Get('cs-sla/stats')
  @Roles('AGENT', 'PROXY')
  async csSlaStats(
    @CurrentUser() u: { id: string; role: string },
    @Query('range') range?: string,
  ) {
    const agentId = await this.scope.scopeRootUserId(this.actor(u));
    const [from, to] = shanghaiRangeBounds(isTimeRangeKey(range) ? range : 'today');
    return this.csSla.statsByAgent(agentId, from, to);
  }

  /** 某客服的超时明细，出争议时逐条对账 */
  @Get('cs-sla/events')
  @Roles('AGENT', 'PROXY')
  async csSlaEvents(
    @CurrentUser() u: { id: string; role: string },
    @Query('csUserId') csUserId: string,
    @Query('range') range?: string,
  ) {
    await this.scope.assertUserInScope(this.actor(u), csUserId);
    const [from, to] = shanghaiRangeBounds(isTimeRangeKey(range) ? range : 'today');
    return this.csSla.eventsByCs(csUserId, from, to);
  }

  /** 客服线下报备后免除这一次处罚 */
  @Post('cs-sla/events/:id/waive')
  @Roles('AGENT')
  async csSlaWaive(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.csSla.waive(this.actor(u), id, body?.reason);
  }

  /**
   * 客服端心跳：App 活着就每 30 秒报一次。
   * 断了服务端就当他把 App 划掉了，自动转休息，不再派单也不再按漏接罚。
   */
  @Post('cs-sla/heartbeat')
  @Roles('CS')
  csHeartbeat(@CurrentUser() u: { id: string }) {
    return this.csSla.heartbeat(u.id);
  }

  /** 漏接被锁号后，代理点这里才能让客服重新登录 */
  @Post('cs-staff/:csUserId/sla-unlock')
  @Roles('AGENT')
  async csSlaUnlock(
    @CurrentUser() u: { id: string; role: string },
    @Param('csUserId') csUserId: string,
  ) {
    await this.scope.assertUserInScope(this.actor(u), csUserId);
    return this.csSla.unlock(this.actor(u), csUserId);
  }

  // ── 客服账号（管理员/房主开号；代理划额与设置） ──
  @Get('cs-staff/me')
  @Roles('CS')
  myCsStaff(@CurrentUser() u: { id: string; role: string }) {
    return this.csStaff.detail(u.id);
  }

  @Get('cs-staff')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
  listCsStaff(
    @CurrentUser() u: { id: string; role: string },
    @Query('parentAgentUserId') parentAgentUserId?: string,
  ) {
    return this.csStaff.list(this.actor(u), parentAgentUserId);
  }

  @Post('cs-staff')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
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
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
  setCsStaffStatus(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' },
  ) {
    return this.csStaff.setStatus(this.actor(u), id, body.status);
  }

  @Post('cs-staff/:id/reset-password')
  @Roles('ADMIN', 'BRANCH', 'GENERAL', 'PROXY')
  resetCsStaffPassword(
    @CurrentUser() u: { id: string; role: string },
    @Param('id') id: string,
    @Body() body: PasswordDto,
  ) {
    return this.csStaff.resetPassword(this.actor(u), id, body?.password);
  }
}
