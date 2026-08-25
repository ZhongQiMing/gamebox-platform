import { Module, forwardRef } from '@nestjs/common';
import { RechargeService } from './recharge.service';
import { RechargeController } from './recharge.controller';
import { PointsModule } from '../points/points.module';
import { AdminModule } from '../admin/admin.module';
import { CsModule } from '../cs/cs.module';

@Module({
  /*
   * 出款闸门用的是 payout-gate.helper 里的纯函数（只吃 Prisma），
   * 刻意不 import FundReconModule：那会形成
   * ConsoleModule → FundReconModule → AdminModule → ConsoleModule 的环，
   * Nest 在模块实例化阶段直接卡死。
   */
  imports: [PointsModule, AdminModule, forwardRef(() => CsModule)],
  providers: [RechargeService],
  controllers: [RechargeController],
  exports: [RechargeService],
})
export class RechargeModule {}
