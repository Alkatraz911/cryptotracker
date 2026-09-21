import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { LlmProvider } from './llm.provider';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeEntryEntity } from './entities/knowledge-entry.entity';
import { AiModelCheck } from './entities/ai-model-check.entity';
import { ModelCatalogService } from './model-catalog.service';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeEntryEntity, AiModelCheck])],
  providers: [AiService, LlmProvider, KnowledgeService, ModelCatalogService],
  controllers: [AiController],
})
export class AiModule {}
