import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TableGateway } from './table.gateway';
import { TableService } from './table.service';
import { TableController } from './table.controller';
import { PointsModule } from '../points/points.module';
import { AgentsModule } from '../agents/agents.module';
import { ConsoleModule } from '../console/console.module';

@Module({
  imports: [
    PointsModule,
    AgentsModule,
    forwardRef(() => ConsoleModule),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [TableGateway, TableService],
  controllers: [TableController],
  exports: [TableService],
})
export class TableModule {}
