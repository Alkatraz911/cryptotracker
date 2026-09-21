import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

interface AuthRequest { user: JwtPayload }

@Controller()
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  // Any signed-in user: file a bug report / improvement idea.
  @Post('feedback')
  async create(@Request() req: AuthRequest, @Body() dto: CreateFeedbackDto) {
    const e = await this.feedback.create(req.user.uid, req.user.email, dto);
    return { id: e.id, createdAt: e.createdAt };
  }

  // Admin: inbox.
  @Get('admin/feedback')
  @UseGuards(AdminGuard)
  list(@Query('status') status?: string) {
    return this.feedback.list(status === 'new' || status === 'done' ? status : undefined);
  }

  @Patch('admin/feedback/:id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateFeedbackDto) {
    return this.feedback.setStatus(id, dto.status);
  }
}
