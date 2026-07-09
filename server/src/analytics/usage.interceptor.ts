import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { UsageService } from './usage.service';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

// Maps a request to a user-facing "module" name. undefined → not tracked
// (auth, /me, admin, listings, project autosave, etc.).
function moduleFor(method: string, rawPath: string): string | undefined {
  const path = rawPath.replace(/^\/api/, '');
  if (/^\/chaindata\/wallet/.test(path)) return 'Транзакции';
  if (/^\/explorer\/trace/.test(path)) return 'Авто-трейс';
  if (/^\/explorer\/(orbiter|debridge)\/resolve/.test(path)) return 'Мосты';
  if (/^\/explorer\/(orbiter|debridge)\/feed/.test(path)) return 'Кроссчейн-фид';
  if (/^\/explorer\/tx/.test(path)) return 'Tx по ссылке';
  if (/^\/explorer\/label/.test(path)) return 'Метки адресов';
  if (/^\/explorer\/balance/.test(path)) return 'Баланс';
  if (/^\/ai\//.test(path)) return 'ИИ-анализ';
  if (method === 'POST' && /^\/projects\/?$/.test(path)) return 'Проекты';
  return undefined;
}

@Injectable()
export class UsageInterceptor implements NestInterceptor {
  constructor(private readonly usage: UsageService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{ method: string; path: string; user?: JwtPayload }>();
    const module = moduleFor(req.method, req.path || '');
    return next.handle().pipe(tap(() => {
      const uid = req.user?.uid;
      if (uid && module) this.usage.record(uid, module);
    }));
  }
}
