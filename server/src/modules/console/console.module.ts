import { Module, forwardRef } from '@nestjs/common';
import { PointsModule } from '../points/points.module';
import { AdminModule } from '../admin/admin.module';
import { AgentsModule } from '../agents/agents.module';
import { RebateModule } from '../rebate/rebate.module';
import { ConsoleController } from './console.controller';
import { ConsoleScopeService } from './console-scope.service';
import { ConsoleWalletService } from './console-wallet.service';
import { ConsoleRoomsService } from './console-rooms.service';
import { ConsoleControlService } from './console-control.service';
import { GlobalSoftControlService } from './global-soft-control.service';
import { ConsoleReportsService } from './console-reports.service';
import { ConsolePlayersService } from './console-players.service';
import { FlyDiskService } from './fly-disk.service';
import { FlyRebateService } from './fly-rebate.service';
import { RoomBillingService } from './room-billing.service';
import { RoomSettleService } from './room-settle.service';
import { CsStaffService } from './cs-staff.service';

@Module({
  imports: [
    PointsModule,
    forwardRef(() => AdminModule),
    AgentsModule,
    forwardRef(() => RebateModule),
  ],
  controllers: [ConsoleController],
  providers: [
    ConsoleScopeService,
    ConsoleWalletService,
    ConsoleRoomsService,
    ConsoleControlService,
    GlobalSoftControlService,
    ConsoleReportsService,
    ConsolePlayersService,
    FlyDiskService,
    FlyRebateService,
    RoomBillingService,
    RoomSettleService,
    CsStaffService,
  ],
  exports: [
    ConsoleControlService,
    GlobalSoftControlService,
    ConsoleScopeService,
    ConsoleRoomsService,
    FlyDiskService,
    FlyRebateService,
    RoomBillingService,
    RoomSettleService,
    CsStaffService,
  ],
})
export class ConsoleModule {}
