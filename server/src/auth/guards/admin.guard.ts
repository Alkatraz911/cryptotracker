import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '../strategies/jwt.strategy';

// Allows the request only for admins. Use AFTER JwtAuthGuard, which populates
// req.user (with the effective role computed by JwtStrategy).
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    if (req.user?.role !== 'admin') throw new ForbiddenException('admin only');
    return true;
  }
}
