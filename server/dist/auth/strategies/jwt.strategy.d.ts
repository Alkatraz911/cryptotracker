import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
export type Role = 'user' | 'admin';
export interface JwtPayload {
    uid: string;
    email: string;
    role?: Role;
}
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    private readonly users;
    private readonly adminEmails;
    constructor(cfg: ConfigService, users: UsersService);
    validate(payload: JwtPayload): Promise<JwtPayload>;
}
export {};
