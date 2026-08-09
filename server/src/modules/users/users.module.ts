import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { RebateModule } from '../rebate/rebate.module';
import { PointsModule } from '../points/points.module';

@Module({
  /* 注销前要拦「还有未领回水」，可领金额只有 RebateService 算得出 */
  imports: [forwardRef(() => RebateModule), PointsModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
