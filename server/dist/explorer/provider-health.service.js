"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ProviderHealthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderHealthService = void 0;
const common_1 = require("@nestjs/common");
const DEGRADED_AFTER = 3;
let ProviderHealthService = ProviderHealthService_1 = class ProviderHealthService {
    constructor() {
        this.logger = new common_1.Logger(ProviderHealthService_1.name);
        this.sources = new Map();
    }
    ensure(source) {
        let h = this.sources.get(source);
        if (!h) {
            h = {
                source, status: 'unknown',
                lastOkAt: null, lastFailAt: null, lastDriftAt: null,
                consecutiveFailures: 0, totalOk: 0, totalFail: 0, totalDrift: 0,
                lastNote: null, lastLatencyMs: null,
            };
            this.sources.set(source, h);
        }
        return h;
    }
    record(source, status, opts = {}) {
        const h = this.ensure(source);
        const prev = h.status;
        h.status = status;
        h.lastNote = opts.note ?? null;
        if (opts.latencyMs != null)
            h.lastLatencyMs = opts.latencyMs;
        const now = Date.now();
        if (status === 'ok' || status === 'empty') {
            h.lastOkAt = now;
            h.totalOk++;
            h.consecutiveFailures = 0;
            if (prev === 'down' || prev === 'drift')
                this.logger.log(`[health] ${source} recovered (${prev} → ${status})`);
            return;
        }
        h.lastFailAt = now;
        h.totalFail++;
        h.consecutiveFailures++;
        const msg = `[health] ${source} ${status}${opts.note ? `: ${opts.note}` : ''} (x${h.consecutiveFailures})`;
        if (status === 'drift') {
            h.lastDriftAt = now;
            h.totalDrift++;
            this.logger.error(msg);
        }
        else if (h.consecutiveFailures === 1 || h.consecutiveFailures === DEGRADED_AFTER) {
            this.logger.warn(msg);
        }
    }
    degraded(source) {
        return (this.sources.get(source)?.consecutiveFailures ?? 0) >= DEGRADED_AFTER;
    }
    snapshot() {
        return [...this.sources.values()].sort((a, b) => a.source.localeCompare(b.source));
    }
};
exports.ProviderHealthService = ProviderHealthService;
exports.ProviderHealthService = ProviderHealthService = ProviderHealthService_1 = __decorate([
    (0, common_1.Injectable)()
], ProviderHealthService);
//# sourceMappingURL=provider-health.service.js.map