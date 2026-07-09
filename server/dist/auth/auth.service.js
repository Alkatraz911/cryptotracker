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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = require("bcryptjs");
const uuid_1 = require("uuid");
const users_service_1 = require("../users/users.service");
let AuthService = class AuthService {
    constructor(users, jwt) {
        this.users = users;
        this.jwt = jwt;
    }
    async register(email, password) {
        const norm = email.trim().toLowerCase();
        const existing = await this.users.findByEmail(norm);
        if (existing)
            throw new common_1.ConflictException('email already registered');
        const passwordHash = bcrypt.hashSync(password, 10);
        const user = await this.users.create({ id: (0, uuid_1.v4)(), email: norm, passwordHash });
        const token = this.sign(user.id, user.email);
        return { token, user: { id: user.id, email: user.email } };
    }
    async login(email, password) {
        const norm = email.trim().toLowerCase();
        const user = await this.users.findByEmail(norm);
        if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
            throw new common_1.UnauthorizedException('invalid credentials');
        }
        const token = this.sign(user.id, user.email);
        return { token, user: { id: user.id, email: user.email } };
    }
    sign(uid, email) {
        const payload = { uid, email };
        return this.jwt.sign(payload);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        jwt_1.JwtService])
], AuthService);
//# sourceMappingURL=auth.service.js.map