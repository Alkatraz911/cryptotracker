import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: true, credentials: true });
  // Graphs with large transfer histories can exceed Express's default 100kb body limit.
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ limit: '25mb', extended: true }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 8787);
  const isProd = (config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';
  const log = new Logger('Bootstrap');

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

  await app.listen(port, '0.0.0.0');
  log.log(`CryptoTracker server on http://localhost:${port}`);
}
bootstrap();
