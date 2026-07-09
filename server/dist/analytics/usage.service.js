"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var UsageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const usage_event_entity_1 = require("./entities/usage-event.entity");
const users_service_1 = require("../users/users.service");
let UsageService = UsageService_1 = class UsageService {
    constructor(repo, users) {
        this.repo = repo;
        this.users = users;
        this.logger = new common_1.Logger(UsageService_1.name);
    }
    record(userId, module) {
        if (!userId || !module)
            return;
        void this.repo.insert({ userId, module }).catch((e) => this.logger.warn(`usage record failed: ${e?.message}`));
    }
    async analytics(days = 30) {
        const since = new Date(Date.now() - days * 86_400_000);
        const sinceWhere = { createdAt: (0, typeorm_2.MoreThanOrEqual)(since) };
        const byModuleRaw = await this.repo.createQueryBuilder('e')
            .select('e.module', 'module')
            .addSelect('COUNT(*)', 'count')
            .addSelect('COUNT(DISTINCT e.user_id)', 'users')
            .where(sinceWhere)
            .groupBy('e.module')
            .orderBy('count', 'DESC')
            .getRawMany();
        const byUserRaw = await this.repo.createQueryBuilder('e')
            .select('e.user_id', 'userId')
            .addSelect('COUNT(*)', 'events')
            .addSelect('MAX(e.created_at)', 'lastActive')
            .where(sinceWhere)
            .groupBy('e.user_id')
            .getRawMany();
        const perUserModuleRaw = await this.repo.createQueryBuilder('e')
            .select('e.user_id', 'userId')
            .addSelect('e.module', 'module')
            .addSelect('COUNT(*)', 'count')
            .where(sinceWhere)
            .groupBy('e.user_id')
            .addGroupBy('e.module')
            .getRawMany();
        const emailById = new Map((await this.users.list()).map((u) => [u.id, u]));
        const modulesByUser = new Map();
        for (const r of perUserModuleRaw) {
            const arr = modulesByUser.get(r.userId) ?? [];
            arr.push({ module: r.module, count: Number(r.count) });
            modulesByUser.set(r.userId, arr);
        }
        const byUser = byUserRaw
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
        const byModule = byModuleRaw.map((r) => ({ module: r.module, count: Number(r.count), users: Number(r.users) }));
        const totalEvents = byModule.reduce((s, m) => s + m.count, 0);
        return { days, since: since.toISOString(), totalEvents, activeUsers: byUser.length, byModule, byUser };
    }
};
exports.UsageService = UsageService;
exports.UsageService = UsageService = UsageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(usage_event_entity_1.UsageEvent)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        users_service_1.UsersService])
], UsageService);
//# sourceMappingURL=usage.service.js.map