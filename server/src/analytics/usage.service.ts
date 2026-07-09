import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { UsageEvent } from './entities/usage-event.entity';
import { UsersService } from '../users/users.service';

export interface ModuleStat { module: string; count: number; users: number }
export interface UserStat {
  userId: string; email: string; role: string;
  events: number; lastActive: string | null;
  modules: { module: string; count: number }[];
}
export interface Analytics {
  days: number; since: string; totalEvents: number; activeUsers: number;
  byModule: ModuleStat[]; byUser: UserStat[];
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @InjectRepository(UsageEvent) private readonly repo: Repository<UsageEvent>,
    private readonly users: UsersService,
  ) {}

  // Fire-and-forget: never block or fail the originating request.
  record(userId: string, module: string): void {
    if (!userId || !module) return;
    void this.repo.insert({ userId, module }).catch((e) => this.logger.warn(`usage record failed: ${(e as Error)?.message}`));
  }

  async analytics(days = 30): Promise<Analytics> {
    const since = new Date(Date.now() - days * 86_400_000);
    const sinceWhere = { createdAt: MoreThanOrEqual(since) };

    const byModuleRaw = await this.repo.createQueryBuilder('e')
      .select('e.module', 'module')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COUNT(DISTINCT e.user_id)', 'users')
      .where(sinceWhere)
      .groupBy('e.module')
      .orderBy('count', 'DESC')
      .getRawMany<{ module: string; count: string; users: string }>();

    const byUserRaw = await this.repo.createQueryBuilder('e')
      .select('e.user_id', 'userId')
      .addSelect('COUNT(*)', 'events')
      .addSelect('MAX(e.created_at)', 'lastActive')
      .where(sinceWhere)
      .groupBy('e.user_id')
      .getRawMany<{ userId: string; events: string; lastActive: string }>();

    const perUserModuleRaw = await this.repo.createQueryBuilder('e')
      .select('e.user_id', 'userId')
      .addSelect('e.module', 'module')
      .addSelect('COUNT(*)', 'count')
      .where(sinceWhere)
      .groupBy('e.user_id')
      .addGroupBy('e.module')
      .getRawMany<{ userId: string; module: string; count: string }>();

    const emailById = new Map((await this.users.list()).map((u) => [u.id, u]));
    const modulesByUser = new Map<string, { module: string; count: number }[]>();
    for (const r of perUserModuleRaw) {
      const arr = modulesByUser.get(r.userId) ?? [];
      arr.push({ module: r.module, count: Number(r.count) });
      modulesByUser.set(r.userId, arr);
    }

    const byUser: UserStat[] = byUserRaw
      .map((r) => {
        const u = emailById.get(r.userId);
        return {
          userId: r.userId,
          email: u?.email ?? '(удалён)',
          role: u?.role ?? '—',
          events: Number(r.events),
          lastActive: r.lastActive ? new Date(r.lastActive).toISOString() : null,
          modules: (modulesByUser.get(r.userId) ?? []).sort((a, b) => b.count - a.count),
        };
      })
      .sort((a, b) => b.events - a.events);

    const byModule: ModuleStat[] = byModuleRaw.map((r) => ({ module: r.module, count: Number(r.count), users: Number(r.users) }));
    const totalEvents = byModule.reduce((s, m) => s + m.count, 0);

    return { days, since: since.toISOString(), totalEvents, activeUsers: byUser.length, byModule, byUser };
  }
}
