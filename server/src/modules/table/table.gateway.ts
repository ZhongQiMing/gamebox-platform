/**
 * TableGateway — Socket.IO（已冻结为主路径旁路，默认不启用）
 *
 * 产品主路径：AssetsGameView iframe + HTTP `/api/table/*`
 * 本网关仅保留给内部推送 / 旧调试；新功能不要往这里加下注入口。
 * 客户端正式路径：`/game/table/:code` → AssetsGame 壳（旧 `/game/lottery/*` 牌桌链会 redirect 过来）。
 *
 * 默认不注册（见 table.module.ts）。要开必须显式设 TABLE_WS_ENABLED=1，
 * 因为它推的是整桌快照（含他人下注），开着就是白送数据。
 * CORS 跟 HTTP 用同一份 CORS_ORIGIN 白名单：早先这里写死 origin:'*'，
 * 等于任何网站都能连上来收快照，把主程序好不容易收紧的跨域又敞开了。
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

/** 与 main.ts 的 HTTP CORS 同源同策略：没配白名单就不接跨域 */
function wsCorsOrigin(): string[] | false {
  const raw = String(process.env.CORS_ORIGIN || '').trim();
  if (!raw) return false;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : false;
}

@WebSocketGateway({
  namespace: '/table',
  cors: { origin: wsCorsOrigin(), credentials: true },
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

  /**
   * 连接必须带有效 JWT：过期 / 改密(tv) / 冻结 / 停用 一律断开。
   *
   * 原先没带 token 也放行当「旁观者」，可整桌快照里有别人的下注，
   * 匿名旁观等于把这些数据公开，所以改成一律要登录。
   */
  async handleConnection(client: Socket) {
    const token: string | undefined = client.handshake.auth?.token;
    if (!token) {
      client.emit('table:error', { message: '请先登录' });
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { status: true, tokenVersion: true, loginLockedAt: true },
      });
      const tv = payload.tv ?? 0;
      if (
        !user
        || user.status !== 'ACTIVE'
        || user.loginLockedAt
        || tv !== user.tokenVersion
      ) {
        client.emit('table:error', { message: '登录已失效，请重新登录' });
        client.disconnect(true);
        return;
      }
      client.data.userId = payload.sub;
    } catch {
      client.emit('table:error', { message: '登录已失效，请重新登录' });
      client.disconnect(true);
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
      await client.join(`room:${gameCode}`);
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
  handleBet(@ConnectedSocket() client: Socket, @MessageBody() _payload: TableBetPayload) {
    client.emit('table:error', {
      message: '请从大厅进入游戏下注（WebSocket 下注已关闭）',
    });
  }
}
