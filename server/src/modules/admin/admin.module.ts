import { Module, forwardRef } from '@nestjs/common';
import { RechargeAdminController } from './recharge-admin.controller';
import { GameAdminController } from './game-admin.controller';
import { RiskAdminController } from './risk-admin.controller';
import { AdminLogController } from './admin-log.controller';
import { AdminLogService } from './admin-log.service';
import { AdminPasswordService } from './admin-password.service';
import { GameOpsScheduler } from './game-ops.scheduler';
import { PointsModule } from '../points/points.module';
import { ConsoleModule } from '../console/console.module';

@Module({
  imports: [PointsModule, forwardRef(() => ConsoleModule)],
  providers: [AdminLogService, AdminPasswordService, GameOpsScheduler],
  controllers: [
    RechargeAdminController,
    GameAdminController,
    RiskAdminController,
    AdminLogController,
  ],
  exports: [AdminLogService, AdminPasswordService],
})
export class AdminModule {}
