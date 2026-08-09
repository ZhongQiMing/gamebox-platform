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
  /*
   * Socket.IO 网关默认不注册：产品主路径是 HTTP /api/table/*，
   * 全仓库没有一处客户端连它，但它一注册就对外开着一个额外端口面。
   * 需要内部推送/调试时才设 TABLE_WS_ENABLED=1，并且必须同时配 CORS_ORIGIN。
   */
  providers: [
    ...(String(process.env.TABLE_WS_ENABLED || '') === '1' ? [TableGateway] : []),
    TableService,
  ],
  controllers: [TableController],
  exports: [TableService],
})
export class TableModule {}
