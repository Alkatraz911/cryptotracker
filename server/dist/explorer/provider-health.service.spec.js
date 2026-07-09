"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const provider_health_service_1 = require("./provider-health.service");
describe('ProviderHealthService', () => {
    let health;
    beforeEach(() => {
        health = new provider_health_service_1.ProviderHealthService();
        jest.spyOn(health['logger'], 'log').mockImplementation(() => undefined);
        jest.spyOn(health['logger'], 'warn').mockImplementation(() => undefined);
        jest.spyOn(health['logger'], 'error').mockImplementation(() => undefined);
    });
    it('starts empty', () => {
        expect(health.snapshot()).toEqual([]);
    });
    it('records a healthy call', () => {
        health.record('bscscan.com', 'ok', { latencyMs: 120 });
        const [s] = health.snapshot();
        expect(s.status).toBe('ok');
        expect(s.totalOk).toBe(1);
        expect(s.consecutiveFailures).toBe(0);
        expect(s.lastOkAt).toBeGreaterThan(0);
        expect(s.lastLatencyMs).toBe(120);
    });
    it('treats empty (reachable, no data) as healthy', () => {
        health.record('etherscan:ETH', 'empty');
        expect(health.degraded('etherscan:ETH')).toBe(false);
        expect(health.snapshot()[0].totalOk).toBe(1);
    });
    it('counts consecutive failures and flags degraded after the threshold', () => {
        health.record('bscscan.com', 'down');
        expect(health.degraded('bscscan.com')).toBe(false);
        health.record('bscscan.com', 'down');
        health.record('bscscan.com', 'down');
        expect(health.degraded('bscscan.com')).toBe(true);
        const [s] = health.snapshot();
        expect(s.consecutiveFailures).toBe(3);
        expect(s.totalFail).toBe(3);
        expect(s.status).toBe('down');
    });
    it('resets the failure streak on recovery', () => {
        health.record('bscscan.com', 'down');
        health.record('bscscan.com', 'down');
        health.record('bscscan.com', 'ok');
        expect(health.degraded('bscscan.com')).toBe(false);
        const [s] = health.snapshot();
        expect(s.consecutiveFailures).toBe(0);
        expect(s.status).toBe('ok');
    });
    it('tracks drift distinctly and logs it at error level', () => {
        const errSpy = jest.spyOn(health['logger'], 'error');
        health.record('bscscan.com', 'drift', { note: 'markup changed' });
        const [s] = health.snapshot();
        expect(s.status).toBe('drift');
        expect(s.totalDrift).toBe(1);
        expect(s.lastDriftAt).toBeGreaterThan(0);
        expect(errSpy).toHaveBeenCalled();
    });
    it('snapshot is sorted by source name', () => {
        health.record('zzz', 'ok');
        health.record('aaa', 'ok');
        expect(health.snapshot().map((s) => s.source)).toEqual(['aaa', 'zzz']);
    });
});
//# sourceMappingURL=provider-health.service.spec.js.map