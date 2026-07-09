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
exports.UsageInterceptor = void 0;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
const usage_service_1 = require("./usage.service");
function moduleFor(method, rawPath) {
    const path = rawPath.replace(/^\/api/, '');
    if (/^\/chaindata\/wallet/.test(path))
        return 'Транзакции';
    if (/^\/explorer\/trace/.test(path))
        return 'Авто-трейс';
    if (/^\/explorer\/(orbiter|debridge)\/resolve/.test(path))
        return 'Мосты';
    if (/^\/explorer\/(orbiter|debridge)\/feed/.test(path))
        return 'Кроссчейн-фид';
    if (/^\/explorer\/tx/.test(path))
        return 'Tx по ссылке';
    if (/^\/explorer\/label/.test(path))
        return 'Метки адресов';
    if (/^\/explorer\/balance/.test(path))
        return 'Баланс';
    if (/^\/ai\//.test(path))
        return 'ИИ-анализ';
    if (method === 'POST' && /^\/projects\/?$/.test(path))
        return 'Проекты';
    return undefined;
}
let UsageInterceptor = class UsageInterceptor {
    constructor(usage) {
        this.usage = usage;
    }
    intercept(ctx, next) {
        const req = ctx.switchToHttp().getRequest();
        const module = moduleFor(req.method, req.path || '');
        return next.handle().pipe((0, operators_1.tap)(() => {
            const uid = req.user?.uid;
            if (uid && module)
                this.usage.record(uid, module);
        }));
    }
};
exports.UsageInterceptor = UsageInterceptor;
exports.UsageInterceptor = UsageInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [usage_service_1.UsageService])
], UsageInterceptor);
//# sourceMappingURL=usage.interceptor.js.map