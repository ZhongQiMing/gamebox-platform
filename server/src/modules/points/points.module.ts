import { Module } from '@nestjs/common';
import { PointsService } from './points.service';
import { PointsController } from './points.controller';
import { PlatformEmergencyService } from './platform-emergency.service';

@Module({
  providers: [PointsService, PlatformEmergencyService],
  controllers: [PointsController],
  exports: [PointsService, PlatformEmergencyService],
})
export class PointsModule {}
