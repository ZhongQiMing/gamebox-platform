/**
 * TableGateway — Socket.IO（已冻结为主路径旁路）
 *
 * 产品主路径：AssetsGameView iframe + HTTP `/api/table/*`
 * 本网关仅保留给内部推送 / 旧调试；新功能不要往这里加下注入口。
 * 客户端 `/game/table/:code` 已 redirect 到 AssetsGame 壳。
 */
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { TableService } from './table.service';
import type { TableBetPayload, TableSnapshot } from './table.types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeGameCode } from './table-rules';

@WebSocketGateway({
  namespace: '/table',
  cors: { origin: '*' },
})
export class TableGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private tableService: TableService,
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  afterInit() {
    this.tableService.setBroadcast((gameCode: string, snap: TableSnapshot) => {
      this.server.to(`room:${gameCode}`).emit('table:snapshot', snap);
    });
  }

  /** 连接时校验 JWT，把真实 userId 存入 socket.data（伪造 token 会校验失败） */
  async handleConnection(client: Socket) {
    const token: string | undefined = client.handshake.auth?.token;
    if (!token) return; // 旁观者
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { status: true },
      });
      if (user?.status === 'ACTIVE') client.data.userId = payload.sub;
    } catch {
      // token 无效 → 按旁观者处理，不断开（前端会在下注时收到提示）
    }
  }

  @SubscribeMessage('table:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameCode: string },
  ) {
    const gameCode = normalizeGameCode(data.gameCode);
    try {
      const snap = await this.tableService.snapshot(gameCode);
      client.join(`room:${gameCode}`);
      client.emit('table:snapshot', snap);
      return { joined: gameCode };
    } catch (err: unknown) {
      client.emit('table:error', { message: (err as Error).message });
      return { joined: null };
    }
  }

  /**
   * 已关闭：下注只走 HTTP `/api/table/:code/bet`（AssetsGameView 桥接）。
   * 保留消息以免旧客户端报 unknown event，但一律拒绝。
   */
  @SubscribeMessage('table:bet')
  async handleBet(@ConnectedSocket() client: Socket, @MessageBody() _payload: TableBetPayload) {
    client.emit('table:error', {
      message: '请从大厅进入游戏下注（WebSocket 下注已关闭）',
    });
  }
}
