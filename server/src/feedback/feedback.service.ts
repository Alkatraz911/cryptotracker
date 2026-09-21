import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeedbackEntry, FeedbackStatus } from './entities/feedback-entry.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

const KIND_LABEL: Record<string, string> = { bug: '🐞 Ошибка', idea: '💡 Предложение' };

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @InjectRepository(FeedbackEntry) private readonly repo: Repository<FeedbackEntry>,
    private readonly cfg: ConfigService,
  ) {}

  async create(userId: string, email: string, dto: CreateFeedbackDto): Promise<FeedbackEntry> {
    const entry = await this.repo.save(this.repo.create({
      userId, email,
      kind: dto.kind,
      title: dto.title.trim(),
      message: dto.message.trim(),
      context: dto.context ?? null,
    }));
    this.notify(entry);
    return entry;
  }

  list(status?: FeedbackStatus): Promise<FeedbackEntry[]> {
    return this.repo.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
      take: 500,
    });
  }

  async setStatus(id: string, status: FeedbackStatus): Promise<FeedbackEntry> {
    const entry = await this.repo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('отзыв не найден');
    entry.status = status;
    return this.repo.save(entry);
  }

  async countNew(): Promise<number> {
    return this.repo.count({ where: { status: 'new' } });
  }

  // Optional push to wherever the team watches (Slack/Discord/Telegram-bridge
  // webhook taking `{ text }`). Fire-and-forget: the report is already stored.
  private notify(e: FeedbackEntry): void {
    const url = this.cfg.get<string>('FEEDBACK_WEBHOOK_URL', '');
    if (!url) return;
    const ctx = e.context ?? {};
    const text = [
      `${KIND_LABEL[e.kind] ?? e.kind}: ${e.title}`,
      `от ${e.email}`,
      '',
      e.message,
      '',
      ctx['url'] ? `страница: ${ctx['url']}` : '',
      ctx['projectId'] ? `дело: ${ctx['projectId']}` : '',
      ctx['userAgent'] ? `браузер: ${ctx['userAgent']}` : '',
    ].filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n');
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
    }).catch((err) => this.logger.warn(`feedback webhook failed: ${(err as Error)?.message}`));
  }
}
