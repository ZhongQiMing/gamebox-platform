import { Module, forwardRef } from '@nestjs/common';
import { LotteryService } from './lottery.service';
import { LotteryController } from './lottery.controller';
import { LotteryScheduler } from './lottery.scheduler';
import { LotteryGameRegistry } from './lottery-game.registry';
import { PointsModule } from '../points/points.module';
import { AgentsModule } from '../agents/agents.module';
import { RoomsModule } from '../rooms/rooms.module';
import { ConsoleModule } from '../console/console.module';

@Module({
  imports: [PointsModule, AgentsModule, RoomsModule, forwardRef(() => ConsoleModule)],
  providers: [LotteryService, LotteryScheduler, LotteryGameRegistry],
  controllers: [LotteryController],
  exports: [LotteryService, LotteryGameRegistry],
})
export class LotteryModule {}
