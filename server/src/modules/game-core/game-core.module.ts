import { Module } from '@nestjs/common';
import { SlotEngine } from './slot-engine';
import { BcbmEngine } from './bcbm-engine';
import { FruitMachineEngine } from './fruit-machine-engine';
import { BetController } from './bet.controller';
import { PointsModule } from '../points/points.module';
import { AgentsModule } from '../agents/agents.module';
import { MahjongEngine } from './mahjong-engine';
import { SettlementKernel } from './settlement-kernel';

@Module({
  imports: [PointsModule, AgentsModule],
  providers: [SettlementKernel, SlotEngine, BcbmEngine, FruitMachineEngine, MahjongEngine],
  controllers: [BetController],
  exports: [SettlementKernel, SlotEngine, BcbmEngine, FruitMachineEngine, MahjongEngine],
})
export class GameCoreModule {}
