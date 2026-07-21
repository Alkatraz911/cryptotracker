import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

// Shared Express/Nest wiring used by BOTH the local/non-Vercel process
// (main.ts, node dist/main) and the Vercel serverless entrypoint (api/index.ts)
// so the two never drift out of sync.
export function configureApp(app: INestApplication): void {
  app.enableCors({ origin: true, credentials: true });
  // Graphs with large transfer histories can exceed Express's default 100kb body limit.
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ limit: '25mb', extended: true }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
}

// Fail loudly on insecure defaults in production. Runs in both entrypoints —
// under Vercel this throws on the cached bootstrap promise, which surfaces as
// a 500 on every request until the env var is fixed, rather than silently
// booting with a public JWT secret.
export function assertSecureConfig(app: INestApplication): void {
  const config = app.get(ConfigService);
  const log = new Logger('Bootstrap');
  const isProd = (config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';

  // Refuse to boot in production with the default (weak) JWT secret — signing
  // tokens with a public value is an auth-bypass risk. In dev it's only a warning.
  const secret = config.get<string>('JWT_SECRET', 'dev-secret-change-me');
  if (secret === 'dev-secret-change-me') {
    const msg = 'JWT_SECRET is the default dev value — set a strong random secret in .env.';
    if (isProd) throw new Error(`Refusing to start in production: ${msg}`);
    log.warn(msg);
  }
  // Flag the default local DB credentials in production (rotate before exposing).
  if (isProd && /:\/\/crypto:crypto@/.test(config.get<string>('DATABASE_URL', ''))) {
    log.warn('DATABASE_URL uses the default crypto:crypto credentials — change them for production.');
  }
}
