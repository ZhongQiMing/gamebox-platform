import { Module } from '@nestjs/common';
import { GameEngineRegistry } from './game-engine.registry';
import { SlotEngine } from './slot-engine';
import { BetController } from './bet.controller';
import { PointsModule } from '../points/points.module';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [PointsModule, AgentsModule],
  providers: [GameEngineRegistry, SlotEngine],
  controllers: [BetController],
  exports: [GameEngineRegistry, SlotEngine],
})
export class GameCoreModule {}
