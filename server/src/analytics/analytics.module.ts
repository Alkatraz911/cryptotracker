import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { UsageEvent } from './entities/usage-event.entity';
import { UsageService } from './usage.service';
import { UsageInterceptor } from './usage.interceptor';
import { AnalyticsController } from './analytics.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([UsageEvent]), UsersModule],
  providers: [UsageService, { provide: APP_INTERCEPTOR, useClass: UsageInterceptor }],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
