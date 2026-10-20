import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';
import { Prisma } from '../../generated/prisma/client';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  /** Stable machine-readable code for errors clients handle specifically. */
  code?: string;
  /** Extra data for that code (never secrets or internals). */
  details?: Record<string, unknown>;
  requestId?: string;
  timestamp: string;
  path: string;
}

/** Prisma error codes that map to client errors instead of 500s. */
const PRISMA_ERROR_STATUS: Record<string, HttpStatus> = {
  P2002: HttpStatus.CONFLICT, // unique constraint
  P2003: HttpStatus.CONFLICT, // foreign key constraint
  P2025: HttpStatus.NOT_FOUND, // record required but not found
};

/**
 * Single place that shapes error responses. Internal details (stack traces,
 * SQL, constraint names) are logged server-side and never returned to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { id?: unknown }>();

    const { statusCode, message, code, details } = this.resolve(exception);

    if (statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      statusCode,
      error: httpErrorName(statusCode),
      message,
      ...(code && { code }),
      ...(details && { details }),
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(request) as string,
    };
    if (typeof request.id === 'string') body.requestId = request.id;

    httpAdapter.reply(ctx.getResponse(), body, statusCode);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    message: string | string[];
    code?: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') {
        return { statusCode: exception.getStatus(), message: response };
      }
      const { message, code, details } = response as {
        message?: unknown;
        code?: unknown;
        details?: unknown;
      };
      return {
        statusCode: exception.getStatus(),
        ...(typeof code === 'string' && { code }),
        ...(details !== null &&
          typeof details === 'object' && {
            details: details as Record<string, unknown>,
          }),
        message:
          typeof message === 'string' || Array.isArray(message)
            ? (message as string | string[])
            : exception.message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const statusCode = PRISMA_ERROR_STATUS[exception.code];
      if (statusCode !== undefined) {
        return {
          statusCode,
          message:
            statusCode === HttpStatus.NOT_FOUND
              ? 'Resource not found'
              : 'Request conflicts with the current state of the resource',
        };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}

function httpErrorName(statusCode: number): string {
  const name: string | undefined = HttpStatus[statusCode];
  if (name === undefined) return 'Error';
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
