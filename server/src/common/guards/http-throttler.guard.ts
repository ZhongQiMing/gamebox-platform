import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** 只对 HTTP 计数：WebSocket 上下文没有 req.ip / res.header，套上去会直接抛类型错误 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  /* eslint-disable-next-line @typescript-eslint/require-await
     -- 父类 shouldSkip 的签名就是 Promise<boolean>，去掉 async 会破坏覆写类型 */
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return context.getType() !== 'http';
  }
}
