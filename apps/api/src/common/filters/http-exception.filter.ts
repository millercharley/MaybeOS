import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';

interface RequestWithUser extends Request {
  user?: { userId?: string; email?: string };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithUser>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      message =
        typeof exResponse === 'string'
          ? exResponse
          : ((exResponse as Record<string, unknown>).message as string) ||
            exception.message;
    } else if (exception instanceof Error) {
      // Some middleware throws plain Errors that already carry an HTTP status —
      // body-parser's "request entity too large" is a 413, not a server fault.
      // Without this it surfaced as a 500 and was reported to Sentry as a
      // defect, burying real failures in noise from oversized uploads.
      const carried = (exception as Error & { status?: number; statusCode?: number });
      const carriedStatus = carried.status ?? carried.statusCode;

      if (typeof carriedStatus === 'number' && carriedStatus >= 400 && carriedStatus < 600) {
        status = carriedStatus;
        message = exception.message;
        if (status < 500) {
          this.logger.warn(`${status} ${exception.message}`);
        } else {
          this.logger.error(exception.message, exception.stack);
        }
      } else {
        this.logger.error(exception.message, exception.stack);
        if (process.env.NODE_ENV !== 'production') {
          message = exception.message;
        }
      }
    }

    // Report 5xx and anything unrecognized. 4xx is deliberately excluded: a
    // wrong password or a 404 is normal traffic, not a defect, and routing it
    // to Sentry buries real failures in noise. A 5xx thrown as an
    // HttpException is still a defect, though — the previous implementation
    // reported only non-HttpException errors and silently missed those.
    if (status >= 500) {
      this.reportToSentry(exception, request, status);
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  private reportToSentry(
    exception: unknown,
    request: RequestWithUser | undefined,
    status: number,
  ) {
    // Skip entirely when unconfigured — init was never called, so this would
    // be a no-op anyway, but the guard keeps local logs clean.
    if (!process.env.SENTRY_DSN) return;

    try {
      Sentry.withScope((scope) => {
        scope.setLevel('error');
        scope.setTag('http.status_code', String(status));

        if (request) {
          scope.setTag('http.method', request.method);
          scope.setContext('request', {
            method: request.method,
            // route path rather than the full URL: keeps ids out of issue
            // titles and stops every distinct org from grouping separately
            path: request.path,
            orgId: request.params?.orgId,
          });
          if (request.user?.userId) {
            scope.setUser({ id: request.user.userId });
          }
        }

        Sentry.captureException(exception);
      });
    } catch (err) {
      // Telemetry must never take down a request.
      this.logger.warn(
        `Failed to report exception to Sentry: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
