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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const uuid_1 = require("uuid");
const project_entity_1 = require("./entities/project.entity");
function counts(graph) {
    const c = { Wallet: 0, User: 0, IP: 0, Tx: 0 };
    for (const n of graph?.nodes ?? []) {
        const k = n.kind;
        if (k in c)
            c[k]++;
    }
    return c;
}
let ProjectsService = class ProjectsService {
    constructor(repo) {
        this.repo = repo;
    }
    async list(userId) {
        const projects = await this.repo.findBy({ userId });
        return projects
            .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, counts: counts(p.graph) }))
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }
    async create(userId, dto) {
        const project = this.repo.create({
            id: (0, uuid_1.v4)(),
            userId,
            name: dto.name,
            graph: dto.graph ?? { nodes: [], edges: [] },
        });
        return this.repo.save(project);
    }
    async findOwned(id, userId) {
        const p = await this.repo.findOneBy({ id });
        if (!p || p.userId !== userId)
            throw new common_1.NotFoundException('not found');
        return p;
    }
    async update(id, userId, dto) {
        const p = await this.findOwned(id, userId);
        if (dto.name !== undefined)
            p.name = dto.name;
        if (dto.graph !== undefined)
            p.graph = dto.graph;
        return this.repo.save(p);
    }
    async remove(id, userId) {
        const p = await this.findOwned(id, userId);
        await this.repo.remove(p);
    }
};
exports.ProjectsService = ProjectsService;
exports.ProjectsService = ProjectsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(project_entity_1.Project)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], ProjectsService);
//# sourceMappingURL=projects.service.js.map