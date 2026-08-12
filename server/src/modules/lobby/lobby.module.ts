import { Module } from '@nestjs/common';
import { LobbyController } from './lobby.controller';
import { LobbyService } from './lobby.service';
import { LotteryModule } from '../lottery/lottery.module';
import { TableModule } from '../table/table.module';

@Module({
  imports: [LotteryModule, TableModule],
  controllers: [LobbyController],
  providers: [LobbyService],
})
export class LobbyModule {}
