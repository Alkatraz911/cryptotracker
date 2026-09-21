import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedbackEntry } from './entities/feedback-entry.entity';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';

// In-app feedback form: bug reports + improvement ideas, reviewed by admins.
@Module({
  imports: [TypeOrmModule.forFeature([FeedbackEntry])],
  providers: [FeedbackService],
  controllers: [FeedbackController],
})
export class FeedbackModule {}
