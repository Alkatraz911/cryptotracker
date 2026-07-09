import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { User } from './entities/user.entity';

export interface PublicUser { id: string; email: string; role: string; createdAt: Date }

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  async create(data: { id: string; email: string; passwordHash: string }): Promise<User> {
    const user = this.repo.create(data);
    return this.repo.save(user);
  }

  // Admin: list users (no password hashes).
  async list(): Promise<PublicUser[]> {
    const users = await this.repo.find({ order: { createdAt: 'DESC' } });
    return users.map((u) => ({ id: u.id, email: u.email, role: u.role, createdAt: u.createdAt }));
  }

  // Admin: create a user with a chosen role (hashes the password here).
  async createUser(email: string, password: string, role: 'user' | 'admin' = 'user'): Promise<PublicUser> {
    const norm = email.trim().toLowerCase();
    if (await this.findByEmail(norm)) throw new ConflictException('email already registered');
    const user = this.repo.create({ id: uuidv4(), email: norm, passwordHash: bcrypt.hashSync(password, 10), role });
    const saved = await this.repo.save(user);
    return { id: saved.id, email: saved.email, role: saved.role, createdAt: saved.createdAt };
  }

  // Admin: edit a user (role / password reset / email).
  async update(id: string, patch: { email?: string; password?: string; role?: 'user' | 'admin' }): Promise<PublicUser> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('user not found');
    if (patch.email) {
      const norm = patch.email.trim().toLowerCase();
      if (norm !== user.email) {
        const dup = await this.findByEmail(norm);
        if (dup && dup.id !== id) throw new ConflictException('email already registered');
        user.email = norm;
      }
    }
    if (patch.password) user.passwordHash = bcrypt.hashSync(patch.password, 10);
    if (patch.role) user.role = patch.role;
    const saved = await this.repo.save(user);
    return { id: saved.id, email: saved.email, role: saved.role, createdAt: saved.createdAt };
  }

  // Admin: delete a user (their projects cascade via FK).
  async remove(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}
