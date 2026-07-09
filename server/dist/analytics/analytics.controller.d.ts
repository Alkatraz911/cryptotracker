import { UsageService } from './usage.service';
import { LogUsageDto } from './dto/log-usage.dto';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
interface AuthRequest {
    user: JwtPayload;
}
export declare class AnalyticsController {
    private readonly usage;
    constructor(usage: UsageService);
    log(req: AuthRequest, dto: LogUsageDto): {
        ok: boolean;
    };
    analytics(days: string): Promise<import("./usage.service").Analytics>;
}
export {};
