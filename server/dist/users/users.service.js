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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const bcrypt = require("bcryptjs");
const uuid_1 = require("uuid");
const user_entity_1 = require("./entities/user.entity");
let UsersService = class UsersService {
    constructor(repo) {
        this.repo = repo;
    }
    findByEmail(email) {
        return this.repo.findOneBy({ email });
    }
    findById(id) {
        return this.repo.findOneBy({ id });
    }
    async create(data) {
        const user = this.repo.create(data);
        return this.repo.save(user);
    }
    async list() {
        const users = await this.repo.find({ order: { createdAt: 'DESC' } });
        return users.map((u) => ({ id: u.id, email: u.email, role: u.role, createdAt: u.createdAt }));
    }
    async createUser(email, password, role = 'user') {
        const norm = email.trim().toLowerCase();
        if (await this.findByEmail(norm))
            throw new common_1.ConflictException('email already registered');
        const user = this.repo.create({ id: (0, uuid_1.v4)(), email: norm, passwordHash: bcrypt.hashSync(password, 10), role });
        const saved = await this.repo.save(user);
        return { id: saved.id, email: saved.email, role: saved.role, createdAt: saved.createdAt };
    }
    async update(id, patch) {
        const user = await this.findById(id);
        if (!user)
            throw new common_1.NotFoundException('user not found');
        if (patch.email) {
            const norm = patch.email.trim().toLowerCase();
            if (norm !== user.email) {
                const dup = await this.findByEmail(norm);
                if (dup && dup.id !== id)
                    throw new common_1.ConflictException('email already registered');
                user.email = norm;
            }
        }
        if (patch.password)
            user.passwordHash = bcrypt.hashSync(patch.password, 10);
        if (patch.role)
            user.role = patch.role;
        const saved = await this.repo.save(user);
        return { id: saved.id, email: saved.email, role: saved.role, createdAt: saved.createdAt };
    }
    async remove(id) {
        await this.repo.delete({ id });
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], UsersService);
//# sourceMappingURL=users.service.js.map