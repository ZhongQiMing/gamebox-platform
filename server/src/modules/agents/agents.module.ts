import { Module } from '@nestjs/common';
import { CommissionService } from './commission.service';
import { HangService } from './hang.service';
import { AgentController } from './agent.controller';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [PointsModule],
  providers: [CommissionService, HangService],
  controllers: [AgentController],
  exports: [CommissionService, HangService],
})
export class AgentsModule {}
