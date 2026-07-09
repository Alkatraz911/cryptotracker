import { User } from '../../users/entities/user.entity';
export declare class Project {
    id: string;
    userId: string;
    user: User;
    name: string;
    graph: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
