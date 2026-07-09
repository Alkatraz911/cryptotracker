import {
  CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

// Logs each request as "METHOD /path Xms".
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const started = Date.now();
    return next.handle().pipe(
      tap(() => this.logger.log(`${req.method} ${req.originalUrl} ${Date.now() - started}ms`)),
    );
  }
}
