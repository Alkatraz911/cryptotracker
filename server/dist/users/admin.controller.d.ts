import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
interface AuthRequest {
    user: JwtPayload;
}
export declare class AdminController {
    private readonly users;
    constructor(users: UsersService);
    list(): Promise<import("./users.service").PublicUser[]>;
    create(dto: CreateUserDto): Promise<import("./users.service").PublicUser>;
    update(id: string, dto: UpdateUserDto): Promise<import("./users.service").PublicUser>;
    remove(req: AuthRequest, id: string): Promise<{
        ok: boolean;
    }>;
}
export {};
