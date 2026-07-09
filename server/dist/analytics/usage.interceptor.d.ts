import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { UsageService } from './usage.service';
export declare class UsageInterceptor implements NestInterceptor {
    private readonly usage;
    constructor(usage: UsageService);
    intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown>;
}
