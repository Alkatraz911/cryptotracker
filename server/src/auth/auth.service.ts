import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import type { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string) {
    const norm = email.trim().toLowerCase();
    const existing = await this.users.findByEmail(norm);
    if (existing) throw new ConflictException('email already registered');
    const passwordHash = bcrypt.hashSync(password, 10);
    const user = await this.users.create({ id: uuidv4(), email: norm, passwordHash });
    const token = this.sign(user.id, user.email);
    return { token, user: { id: user.id, email: user.email } };
  }

  async login(email: string, password: string) {
    const norm = email.trim().toLowerCase();
    const user = await this.users.findByEmail(norm);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      throw new UnauthorizedException('invalid credentials');
    }
    const token = this.sign(user.id, user.email);
    return { token, user: { id: user.id, email: user.email } };
  }

  private sign(uid: string, email: string): string {
    const payload: JwtPayload = { uid, email };
    return this.jwt.sign(payload);
  }
}
