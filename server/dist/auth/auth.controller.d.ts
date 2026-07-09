import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import type { JwtPayload } from './strategies/jwt.strategy';
interface AuthRequest {
    user: JwtPayload;
}
export declare class AuthController {
    private readonly auth;
    constructor(auth: AuthService);
    register(dto: RegisterDto): Promise<{
        token: string;
        user: {
            id: string;
            email: string;
        };
    }>;
    login(dto: LoginDto): Promise<{
        token: string;
        user: {
            id: string;
            email: string;
        };
    }>;
    me(req: AuthRequest): {
        user: {
            id: string;
            email: string;
            role: import("./strategies/jwt.strategy").Role;
        };
    };
}
export {};
