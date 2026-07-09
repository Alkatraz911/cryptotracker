import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { LlmProvider } from './llm.provider';
import { KnowledgeService } from './knowledge.service';

@Module({
  providers: [AiService, LlmProvider, KnowledgeService],
  controllers: [AiController],
})
export class AiModule {}
