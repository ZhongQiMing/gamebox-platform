import { Module } from '@nestjs/common';
import { CommissionService } from './commission.service';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [PointsModule],
  providers: [CommissionService],
  exports: [CommissionService],
})
export class AgentsModule {}
