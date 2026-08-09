import { Module, forwardRef } from '@nestjs/common';
import { RechargeService } from './recharge.service';
import { RechargeController } from './recharge.controller';
import { PointsModule } from '../points/points.module';
import { AdminModule } from '../admin/admin.module';
import { CsModule } from '../cs/cs.module';

@Module({
  imports: [PointsModule, AdminModule, forwardRef(() => CsModule)],
  providers: [RechargeService],
  controllers: [RechargeController],
  exports: [RechargeService],
})
export class RechargeModule {}
