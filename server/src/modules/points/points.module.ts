import { Module } from '@nestjs/common';
import { PointsService } from './points.service';
import { PointsController } from './points.controller';
import { PlatformEmergencyService } from './platform-emergency.service';
import { PlatformBalanceMergerService } from './platform-balance-merger.service';

@Module({
  providers: [PointsService, PlatformEmergencyService, PlatformBalanceMergerService],
  controllers: [PointsController],
  exports: [PointsService, PlatformEmergencyService, PlatformBalanceMergerService],
})
export class PointsModule {}
