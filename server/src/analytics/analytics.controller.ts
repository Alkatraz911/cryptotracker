import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { UsageService } from './usage.service';
import { LogUsageDto } from './dto/log-usage.dto';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

interface AuthRequest { user: JwtPayload }

@Controller()
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly usage: UsageService) {}

  // Beacon for client-only modules (CSV import, merge, …).
  @Post('usage')
  log(@Request() req: AuthRequest, @Body() dto: LogUsageDto) {
    this.usage.record(req.user.uid, dto.module);
    return { ok: true };
  }

  // Admin: module-demand + per-user analytics over the last `days` (default 30).
  @Get('admin/analytics')
  @UseGuards(AdminGuard)
  analytics(@Query('days') days: string) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 365);
    return this.usage.analytics(d);
  }
}
