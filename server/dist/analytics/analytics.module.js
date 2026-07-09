"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const core_1 = require("@nestjs/core");
const usage_event_entity_1 = require("./entities/usage-event.entity");
const usage_service_1 = require("./usage.service");
const usage_interceptor_1 = require("./usage.interceptor");
const analytics_controller_1 = require("./analytics.controller");
const users_module_1 = require("../users/users.module");
let AnalyticsModule = class AnalyticsModule {
};
exports.AnalyticsModule = AnalyticsModule;
exports.AnalyticsModule = AnalyticsModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([usage_event_entity_1.UsageEvent]), users_module_1.UsersModule],
        providers: [usage_service_1.UsageService, { provide: core_1.APP_INTERCEPTOR, useClass: usage_interceptor_1.UsageInterceptor }],
        controllers: [analytics_controller_1.AnalyticsController],
    })
], AnalyticsModule);
//# sourceMappingURL=analytics.module.js.map