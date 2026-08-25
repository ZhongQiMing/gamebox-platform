import { Module, forwardRef } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { FundReconService } from './fund-recon.service';
import { FundReconController, ReconHealthController } from './fund-recon.controller';

@Module({
  /*
   * 必须 forwardRef：出款闸门让 Console/Recharge 依赖了本模块，于是形成
   * ConsoleModule → FundReconModule → AdminModule → ConsoleModule 的环。
   * 这一段不加 forwardRef 会让 Nest 在模块实例化阶段直接卡死——
   * 表现是启动停在路由注册之后，既不报错也不监听端口。
   */
  imports: [forwardRef(() => AdminModule)],
  providers: [FundReconService],
  controllers: [FundReconController, ReconHealthController],
  exports: [FundReconService],
})
export class FundReconModule {}
