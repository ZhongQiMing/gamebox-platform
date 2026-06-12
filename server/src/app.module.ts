import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PointsModule } from './modules/points/points.module';
import { DownloadModule } from './modules/download/download.module';
import { RechargeModule } from './modules/recharge/recharge.module';
import { GamesModule } from './modules/games/games.module';
import { GameCoreModule } from './modules/game-core/game-core.module';
import { AgentsModule } from './modules/agents/agents.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

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
    PrismaModule,
    AuthModule,
    UsersModule,
    PointsModule,
    DownloadModule,
    RechargeModule,
    GamesModule,
    GameCoreModule,
    AgentsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
