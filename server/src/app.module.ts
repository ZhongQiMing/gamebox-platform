import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { GameConfigModule } from './modules/game-core/game-config.cache';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PointsModule } from './modules/points/points.module';
import { DownloadModule } from './modules/download/download.module';
import { RechargeModule } from './modules/recharge/recharge.module';
import { GamesModule } from './modules/games/games.module';
import { GameCoreModule } from './modules/game-core/game-core.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AdminModule } from './modules/admin/admin.module';
import { LotteryModule } from './modules/lottery/lottery.module';
import { TableModule } from './modules/table/table.module';
import { ActivityModule } from './modules/activity/activity.module';
import { HealthModule } from './modules/health/health.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { RiskModule } from './modules/risk/risk.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { RebateModule } from './modules/rebate/rebate.module';

/**
 * 应用根模块。
 * 全局注册 JwtAuthGuard（需 @Public() 才放行）和 RolesGuard。
 * 后续模块按 docs/05-工程实施清单.md 逐步加入：
 *   agents / game-core / games(lottery·table·slot·arcade) / realtime / scheduler
 *   activity / recharge / cs / admin / risk
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => [
        {
          name: 'default',
          ttl: Number(cfg.get('THROTTLE_TTL_MS') ?? 60_000),
          limit: Number(cfg.get('THROTTLE_LIMIT') ?? 120),
        },
      ],
    }),
    PrismaModule,
    RedisModule,
    GameConfigModule,
    AuthModule,
    UsersModule,
    PointsModule,
    DownloadModule,
    RechargeModule,
    GamesModule,
    GameCoreModule,
    AgentsModule,
    AdminModule,
    LotteryModule,
    TableModule,
    ActivityModule,
    RiskModule,
    RoomsModule,
    RebateModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
