import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
export interface PublicUser {
    id: string;
    email: string;
    role: string;
    createdAt: Date;
}
export declare class UsersService {
    private readonly repo;
    constructor(repo: Repository<User>);
    findByEmail(email: string): Promise<User | null>;
    findById(id: string): Promise<User | null>;
    create(data: {
        id: string;
        email: string;
        passwordHash: string;
    }): Promise<User>;
    list(): Promise<PublicUser[]>;
    createUser(email: string, password: string, role?: 'user' | 'admin'): Promise<PublicUser>;
    update(id: string, patch: {
        email?: string;
        password?: string;
        role?: 'user' | 'admin';
    }): Promise<PublicUser>;
    remove(id: string): Promise<void>;
}
