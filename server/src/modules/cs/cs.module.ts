import { Module, forwardRef } from '@nestjs/common';
import { RechargeModule } from '../recharge/recharge.module';
import { ConsoleModule } from '../console/console.module';
import { CsService } from './cs.service';
import { CsController } from './cs.controller';
import { CsConsoleController } from './cs-console.controller';

@Module({
  imports: [forwardRef(() => RechargeModule), forwardRef(() => ConsoleModule)],
  providers: [CsService],
  controllers: [CsController, CsConsoleController],
  exports: [CsService],
})
export class CsModule {}
