import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { RechargeAdminController } from './recharge-admin.controller';
import { GameAdminController } from './game-admin.controller';
import { AgentAdminController } from './agent-admin.controller';
import { RiskAdminController } from './risk-admin.controller';
import { AdminLogController } from './admin-log.controller';
import { AdminLogService } from './admin-log.service';
import { GameOpsScheduler } from './game-ops.scheduler';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [PointsModule],
  providers: [AdminLogService, GameOpsScheduler],
  controllers: [
    DashboardController,
    RechargeAdminController,
    GameAdminController,
    AgentAdminController,
    RiskAdminController,
    AdminLogController,
  ],
  exports: [AdminLogService],
})
export class AdminModule {}
