export type SourceStatus = 'ok' | 'empty' | 'down' | 'drift';
export interface SourceHealth {
    source: string;
    status: SourceStatus | 'unknown';
    lastOkAt: number | null;
    lastFailAt: number | null;
    lastDriftAt: number | null;
    consecutiveFailures: number;
    totalOk: number;
    totalFail: number;
    totalDrift: number;
    lastNote: string | null;
    lastLatencyMs: number | null;
}
export declare class ProviderHealthService {
    private readonly logger;
    private readonly sources;
    private ensure;
    record(source: string, status: SourceStatus, opts?: {
        latencyMs?: number;
        note?: string;
    }): void;
    degraded(source: string): boolean;
    snapshot(): SourceHealth[];
}
