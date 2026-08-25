import { Module, forwardRef } from '@nestjs/common';
import { PointsModule } from '../points/points.module';
import { AdminModule } from '../admin/admin.module';
import { AgentsModule } from '../agents/agents.module';
import { RebateModule } from '../rebate/rebate.module';
import { TableModule } from '../table/table.module';
import { ConsoleController } from './console.controller';
import { ConsoleLiveService } from './console-live.service';
import { ConsoleScopeService } from './console-scope.service';
import { ConsoleWalletService } from './console-wallet.service';
import { ConsoleRoomsService } from './console-rooms.service';
import { ConsoleControlService } from './console-control.service';
import { GlobalSoftControlService } from './global-soft-control.service';
import { ConsoleReportsService } from './console-reports.service';
import { ConsolePlayersService } from './console-players.service';
import { ConsoleRebatePolicyService } from './console-rebate-policy.service';
import { FlyDiskService } from './fly-disk.service';
import { FlyRebateService } from './fly-rebate.service';
import { SoftControlAuditService } from './soft-control-audit.service';
import { RoomSettleService } from './room-settle.service';
import { GeneralSettleService } from './general-settle.service';
import { CsStaffService } from './cs-staff.service';
import { CsSlaService } from './cs-sla.service';
import { CreditDiskUnifyService } from './credit-disk-unify.service';

@Module({
  imports: [
    PointsModule,
    forwardRef(() => AdminModule),
    AgentsModule,
    forwardRef(() => RebateModule),
    forwardRef(() => TableModule),
  ],
  controllers: [ConsoleController],
  providers: [
    ConsoleScopeService,
    ConsoleLiveService,
    ConsoleWalletService,
    ConsoleRoomsService,
    ConsoleControlService,
    GlobalSoftControlService,
    ConsoleReportsService,
    ConsolePlayersService,
    ConsoleRebatePolicyService,
    FlyDiskService,
    FlyRebateService,
    SoftControlAuditService,
    RoomSettleService,
    GeneralSettleService,
    CsStaffService,
    CsSlaService,
    CreditDiskUnifyService,
  ],
  exports: [
    ConsoleControlService,
    GlobalSoftControlService,
    ConsoleScopeService,
    ConsoleRoomsService,
    FlyDiskService,
    FlyRebateService,
    SoftControlAuditService,
    RoomSettleService,
    CsStaffService,
    CsSlaService,
  ],
})
export class ConsoleModule {}
