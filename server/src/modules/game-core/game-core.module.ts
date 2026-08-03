import { Module, forwardRef } from '@nestjs/common';
import { SlotEngine } from './slot-engine';
import { BcbmEngine } from './bcbm-engine';
import { FruitMachineEngine } from './fruit-machine-engine';
import { BetController } from './bet.controller';
import { PointsModule } from '../points/points.module';
import { AgentsModule } from '../agents/agents.module';
import { ConsoleModule } from '../console/console.module';
import { SettlementKernel } from './settlement-kernel';

@Module({
  imports: [PointsModule, AgentsModule, forwardRef(() => ConsoleModule)],
  providers: [SettlementKernel, SlotEngine, BcbmEngine, FruitMachineEngine],
  controllers: [BetController],
  exports: [SettlementKernel, SlotEngine, BcbmEngine, FruitMachineEngine],
})
export class GameCoreModule {}
