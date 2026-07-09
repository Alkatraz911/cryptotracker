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
  const secret = config.get<string>('JWT_SECRET', 'dev-secret-change-me');
  if (secret === 'dev-secret-change-me') {
    new Logger('Bootstrap').warn('JWT_SECRET is the default dev value — set it in .env for real use.');
  }

  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`CryptoTracker server on http://localhost:${port}`);
}
bootstrap();
