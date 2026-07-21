import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp, assertSecureConfig } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  configureApp(app);
  assertSecureConfig(app);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 8787);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`CryptoTracker server on http://localhost:${port}`);
}
bootstrap();
