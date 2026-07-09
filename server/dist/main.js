"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const express_1 = require("express");
const app_module_1 = require("./app.module");
const all_exceptions_filter_1 = require("./common/filters/all-exceptions.filter");
const logging_interceptor_1 = require("./common/interceptors/logging.interceptor");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { logger: ['error', 'warn', 'log'] });
    app.enableCors({ origin: true, credentials: true });
    app.use((0, express_1.json)({ limit: '25mb' }));
    app.use((0, express_1.urlencoded)({ limit: '25mb', extended: true }));
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new all_exceptions_filter_1.AllExceptionsFilter());
    app.useGlobalInterceptors(new logging_interceptor_1.LoggingInterceptor());
    const config = app.get(config_1.ConfigService);
    const port = config.get('PORT', 8787);
    const secret = config.get('JWT_SECRET', 'dev-secret-change-me');
    if (secret === 'dev-secret-change-me') {
        new common_1.Logger('Bootstrap').warn('JWT_SECRET is the default dev value — set it in .env for real use.');
    }
    await app.listen(port, '0.0.0.0');
    new common_1.Logger('Bootstrap').log(`CryptoTracker server on http://localhost:${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map