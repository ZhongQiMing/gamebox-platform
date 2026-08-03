import { Module } from '@nestjs/common';
import { PointsModule } from '../points/points.module';
import { AdminModule } from '../admin/admin.module';
import { ConsoleController } from './console.controller';
import { ConsoleScopeService } from './console-scope.service';
import { ConsoleWalletService } from './console-wallet.service';
import { ConsoleRoomsService } from './console-rooms.service';
import { ConsoleControlService } from './console-control.service';
import { ConsoleReportsService } from './console-reports.service';
import { ConsolePlayersService } from './console-players.service';
import { FlyDiskService } from './fly-disk.service';
import { FlyRebateService } from './fly-rebate.service';
import { RoomBillingService } from './room-billing.service';

@Module({
  imports: [PointsModule, AdminModule],
  controllers: [ConsoleController],
  providers: [
    ConsoleScopeService,
    ConsoleWalletService,
    ConsoleRoomsService,
    ConsoleControlService,
    ConsoleReportsService,
    ConsolePlayersService,
    FlyDiskService,
    FlyRebateService,
    RoomBillingService,
  ],
  exports: [
    ConsoleControlService,
    ConsoleScopeService,
    ConsoleRoomsService,
    FlyDiskService,
    FlyRebateService,
    RoomBillingService,
  ],
})
export class ConsoleModule {}
