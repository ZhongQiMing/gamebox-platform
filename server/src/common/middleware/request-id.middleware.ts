import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export const REQUEST_ID_HEADER = 'x-request-id'

export type RequestWithId = Request & { requestId?: string }

export function getRequestId(req: Request): string {
  return (req as RequestWithId).requestId || req.header(REQUEST_ID_HEADER) || '-'
}

/** 透传或生成 x-request-id，写入 req 与响应头，便于日志串联 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(REQUEST_ID_HEADER)?.trim()
  const id = incoming && incoming.length <= 128 ? incoming : randomUUID()
  ;(req as RequestWithId).requestId = id
  res.setHeader(REQUEST_ID_HEADER, id)
  next()
}
