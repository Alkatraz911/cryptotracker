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
exports.AiController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const ai_service_1 = require("./ai.service");
const knowledge_service_1 = require("./knowledge.service");
let AiController = class AiController {
    constructor(ai, knowledge) {
        this.ai = ai;
        this.knowledge = knowledge;
    }
    health() {
        return this.ai.health();
    }
    analyze(body) {
        if (!body?.nodes?.length) {
            return { narrative: '', signals: [], used: null, diag: 'Пустой подграф для анализа.' };
        }
        return this.ai.analyze(body);
    }
    feedback(body) {
        return this.knowledge
            .recordFeedback({
            rating: body?.rating === 'down' ? 'down' : 'up',
            correction: body?.correction,
            focusAddress: body?.focusAddress ?? null,
            focusNetwork: body?.focusNetwork ?? null,
        })
            .then((entry) => ({ ok: true, stored: !!entry }));
    }
    listKnowledge() {
        return { entries: this.knowledge.list() };
    }
    addKnowledge(body) {
        if (!body?.title || !body?.content)
            return { ok: false, error: 'title и content обязательны' };
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
    removeKnowledge(id) {
        return this.knowledge.remove(id).then((ok) => ({ ok }));
    }
};
exports.AiController = AiController;
__decorate([
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AiController.prototype, "health", null);
__decorate([
    (0, common_1.Post)('analyze'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "analyze", null);
__decorate([
    (0, common_1.Post)('feedback'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "feedback", null);
__decorate([
    (0, common_1.Get)('knowledge'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AiController.prototype, "listKnowledge", null);
__decorate([
    (0, common_1.Post)('knowledge'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "addKnowledge", null);
__decorate([
    (0, common_1.Delete)('knowledge/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "removeKnowledge", null);
exports.AiController = AiController = __decorate([
    (0, common_1.Controller)('ai'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [ai_service_1.AiService,
        knowledge_service_1.KnowledgeService])
], AiController);
//# sourceMappingURL=ai.controller.js.map