import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { getRequestId } from '../middleware/request-id.middleware'

const GENERIC_5XX_MSG = '服务器内部错误'

/** 统一失败响应信封：{ code, data:null, message } */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<Request>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message: string | string[] = GENERIC_5XX_MSG

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const r = exception.getResponse()
      if (typeof r === 'string') {
        message = r
      } else {
        const body = r as { message?: string | string[] }
        message = body.message ?? message
      }
    }

    const msgText = Array.isArray(message) ? message.join('; ') : String(message)
    const requestId = getRequestId(req)
    const path = `${req.method} ${req.originalUrl || req.url}`

    /* 5xx 与非 HttpException：打 stack，方便宝塔/PM2 日志排查 */
    if (status >= 500 || !(exception instanceof HttpException)) {
      const stack =
        exception instanceof Error
          ? exception.stack
          : typeof exception === 'string'
            ? exception
            : JSON.stringify(exception)
      this.logger.error(`[${requestId}] ${path} → ${status} ${msgText}`, stack)
    } else if (status >= 400) {
      this.logger.warn(`[${requestId}] ${path} → ${status} ${msgText}`)
    }

    /* 5xx 细节只进日志，不回给客户端，避免堆栈/SQL/内部路径外泄 */
    const isProd = (process.env.NODE_ENV ?? 'development') === 'production'
    res.status(status).json({
      code: status * 100,
      data: null,
      message: isProd && status >= 500 ? GENERIC_5XX_MSG : msgText,
      requestId,
    })
  }
}
