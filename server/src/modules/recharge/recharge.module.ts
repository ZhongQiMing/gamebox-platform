import { Module } from '@nestjs/common';
import { RechargeService } from './recharge.service';
import { RechargeController } from './recharge.controller';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [PointsModule],
  providers: [RechargeService],
  controllers: [RechargeController],
  exports: [RechargeService],
})
export class RechargeModule {}
