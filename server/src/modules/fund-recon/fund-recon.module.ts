import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { FundReconService } from './fund-recon.service';
import { FundReconController, ReconHealthController } from './fund-recon.controller';

@Module({
  imports: [AdminModule],
  providers: [FundReconService],
  controllers: [FundReconController, ReconHealthController],
  exports: [FundReconService],
})
export class FundReconModule {}
