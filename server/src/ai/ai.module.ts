import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { LlmProvider } from './llm.provider';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeEntryEntity } from './entities/knowledge-entry.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeEntryEntity])],
  providers: [AiService, LlmProvider, KnowledgeService],
  controllers: [AiController],
})
export class AiModule {}
