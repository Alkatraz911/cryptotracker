import { Repository } from 'typeorm';
import { UsageEvent } from './entities/usage-event.entity';
import { UsersService } from '../users/users.service';
export interface ModuleStat {
    module: string;
    count: number;
    users: number;
}
export interface UserStat {
    userId: string;
    email: string;
    role: string;
    events: number;
    lastActive: string | null;
    modules: {
        module: string;
        count: number;
    }[];
}
export interface Analytics {
    days: number;
    since: string;
    totalEvents: number;
    activeUsers: number;
    byModule: ModuleStat[];
    byUser: UserStat[];
}
export declare class UsageService {
    private readonly repo;
    private readonly users;
    private readonly logger;
    constructor(repo: Repository<UsageEvent>, users: UsersService);
    record(userId: string, module: string): void;
    analytics(days?: number): Promise<Analytics>;
}
