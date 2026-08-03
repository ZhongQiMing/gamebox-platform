import { Global, Module } from '@nestjs/common';
import { RiskService } from './risk.service';
import { RiskDetectorService } from './risk-detector.service';

@Global()
@Module({
  providers: [RiskService, RiskDetectorService],
  exports: [RiskService, RiskDetectorService],
})
export class RiskModule {}
