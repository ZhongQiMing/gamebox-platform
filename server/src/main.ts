import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { assertProdSecrets } from './common/utils/assert-prod-secrets';
import { CAPACITOR_APP_ORIGINS } from './common/security.constants';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const isProd = (config.get<string>('NODE_ENV') ?? 'development') === 'production';

  assertProdSecrets(config, isProd);

  /**
   * 宝塔 Nginx 反代一跳：信任紧邻代理，Express 据此解析 req.ip。
   * TRUST_PROXY=0 可关；TRUST_PROXY=2 表示前有两层代理。默认 1。
   */
  const trustRaw = (config.get<string>('TRUST_PROXY') ?? '1').trim().toLowerCase();
  if (trustRaw !== '0' && trustRaw !== 'false' && trustRaw !== 'off') {
    const hops = Number(trustRaw);
    app.set('trust proxy', Number.isFinite(hops) && hops > 0 ? hops : 1);
  }

  /**
   * 请求体上限 12mb：覆盖客服/玩家收款码等 base64 图片上传；
   * 普通 JSON 业务字段远小于此，由 Nginx 可再收一层。
   */
  app.useBodyParser('json', { limit: '12mb' });
  app.useBodyParser('urlencoded', { limit: '12mb', extended: true });

  app.use(requestIdMiddleware);
  /* 管理后台走 HttpOnly Cookie 认证，需要先把 Cookie 解出来 */
  app.use(cookieParser());

  /*
   * CSP。
   *
   * 这一层只覆盖 API 与公开头像/房间图标——前端页面由 web 容器的 Nginx 发，
   * 它那份 CSP 在 client-app/deploy/nginx.conf 里，两边别互相指望。
   * 这里的目标很窄：万一有人把 HTML 塞进上传目录，浏览器打开时不许它加载任何外部脚本。
   * 之前整个关掉是因为管理端要内联样式，可 API 侧根本不返回页面，没有关的理由。
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'img-src': ["'self'", 'data:'],
          'media-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  /*
   * 历史客服文件路径必须先封死；新客服媒体只走 /api/cs/media/:id 鉴权读取。
   * /uploads 仅继续承载可公开的头像与房间图标。
   */
  app.use('/uploads/cs', (_req: Request, res: Response) => res.sendStatus(404));
  /* 须在 helmet 之后注册，否则公开上传目录不带 nosniff 等安全响应头 */
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    index: false,
    dotfiles: 'deny',
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  /* SIGTERM/SIGINT：等进行中的 HTTP 请求收尾再退出（维护窗另见牌桌 drain） */
  app.enableShutdownHooks();

  /*
   * CORS。
   *
   * 管理后台与玩家端网页都跟接口同域（Nginx 同一个 server 块），根本不走 CORS。
   * 真正需要它的只有 App：WebView 里的页面来源是 localhost 系，跟正式域名跨域。
   * 所以 App 来源无条件放行，CORS_ORIGIN 只用来额外追加（例如独立域名的后台）。
   */
  const extraOrigins = String(config.get<string>('CORS_ORIGIN') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const allowedOrigins = [...new Set([...CAPACITOR_APP_ORIGINS, ...extraOrigins])];
  if (!isProd) {
    app.enableCors();
  } else {
    app.enableCors({ origin: allowedOrigins, credentials: true });
    console.log(`[server] CORS 允许来源: ${allowedOrigins.join(', ')}`);
  }

  const port = config.get<number>('PORT') ?? 3000;
  /*
   * Compose 内必须监听 0.0.0.0 供 web 容器访问，且 server 不映射宿主机端口；
   * 只有裸机同机 Nginx 部署才应改为 127.0.0.1。
   */
  const host = (config.get<string>('HOST') ?? '0.0.0.0').trim() || '0.0.0.0';
  await app.listen(port, host);
   
  console.log(`[server] listening on http://${host}:${port}/api`);
}
void bootstrap();
