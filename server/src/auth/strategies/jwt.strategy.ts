import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

export type Role = 'user' | 'admin';

export interface JwtPayload {
  uid: string;
  email: string;
  role?: Role; // filled by validate() (effective role), not by the signed token
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly adminEmails: string[];

  constructor(cfg: ConfigService, private readonly users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.get<string>('JWT_SECRET', 'dev-secret-change-me'),
    });
    this.adminEmails = (cfg.get<string>('ADMIN_EMAILS', '') || '')
      .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  }

  // Recompute the effective role on every request: DB role OR an email listed in
  // ADMIN_EMAILS (bootstrap admin without a DB edit). Always fresh, so promotions
  // take effect without re-login.
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.users.findById(payload.uid);
    if (!user) throw new UnauthorizedException('account not found — please register/log in again');
    const role: Role = user.role === 'admin' || this.adminEmails.includes(user.email.toLowerCase()) ? 'admin' : 'user';
    return { uid: user.id, email: user.email, role };
  }
}
