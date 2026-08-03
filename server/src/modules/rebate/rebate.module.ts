import { Module, forwardRef } from '@nestjs/common';
import { RebateService } from './rebate.service';
import { RebateController } from './rebate.controller';
import { PointsModule } from '../points/points.module';
import { ConsoleModule } from '../console/console.module';

@Module({
  imports: [PointsModule, forwardRef(() => ConsoleModule)],
  providers: [RebateService],
  controllers: [RebateController],
  exports: [RebateService],
})
export class RebateModule {}
