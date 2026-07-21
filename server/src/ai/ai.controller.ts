import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService, AnalyzeInput } from './ai.service';
import { KnowledgeService } from './knowledge.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly knowledge: KnowledgeService,
  ) {}

  // Which engine is active (provider/model) + whether it's configured.
  @Get('health')
  health() {
    return this.ai.health();
  }

  // Analyze a posted subgraph: narrative + risk signals (RAG + heuristics).
  @Post('analyze')
  analyze(@Body() body: AnalyzeInput) {
    if (!body?.nodes?.length) {
      return { narrative: '', signals: [], used: null, diag: 'Пустой подграф для анализа.' };
    }
    return this.ai.analyze(body);
  }

  // Capture analyst feedback (👍/👎 + optional correction) into the dataset.
  @Post('feedback')
  feedback(@Body() body: { rating: 'up' | 'down'; correction?: string; focusAddress?: string; focusNetwork?: string }) {
    return this.knowledge
      .recordFeedback({
        rating: body?.rating === 'down' ? 'down' : 'up',
        correction: body?.correction,
        focusAddress: body?.focusAddress ?? null,
        focusNetwork: body?.focusNetwork ?? null,
      })
      .then((entry) => ({ ok: true, stored: !!entry }));
  }

  // RAG knowledge base CRUD (labelled addresses, custom patterns).
  @Get('knowledge')
  async listKnowledge() {
    return { entries: await this.knowledge.list() };
  }

  @Post('knowledge')
  addKnowledge(@Body() body: { kind: 'address' | 'pattern'; network?: string; address?: string; title: string; content: string; weight?: number }) {
    if (!body?.title || !body?.content) return { ok: false, error: 'title и content обязательны' };
    return this.knowledge
      .add({
        kind: body.kind === 'address' ? 'address' : 'pattern',
        network: body.network ?? null,
        address: body.address ?? null,
        title: body.title,
        content: body.content,
        weight: body.weight ?? (body.kind === 'address' ? 3 : 2),
        source: 'analyst',
      })
      .then((entry) => ({ ok: true, entry }));
  }

  @Delete('knowledge/:id')
  removeKnowledge(@Param('id') id: string) {
    return this.knowledge.remove(id).then((ok) => ({ ok }));
  }
}
