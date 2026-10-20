import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Client metadata recorded on sessions and audit entries. */
export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function requestContextFrom(request: Request): RequestContext {
  const userAgent = request.headers['user-agent'];
  const id = (request as Request & { id?: unknown }).id;
  return {
    // req.ip honours the TRUST_PROXY setting; never read X-Forwarded-For directly.
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    requestId: typeof id === 'string' ? id : null,
  };
}

export const ReqContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext =>
    requestContextFrom(ctx.switchToHttp().getRequest<Request>()),
);
