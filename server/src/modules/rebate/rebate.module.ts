import { Module } from '@nestjs/common';
import { RebateService } from './rebate.service';
import { RebateController } from './rebate.controller';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [PointsModule],
  providers: [RebateService],
  controllers: [RebateController],
  exports: [RebateService],
})
export class RebateModule {}
