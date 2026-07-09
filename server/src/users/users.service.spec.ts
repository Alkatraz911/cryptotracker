import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

const repo = { findOneBy: jest.fn(), create: jest.fn((x) => x), save: jest.fn(), find: jest.fn(), delete: jest.fn() };

describe('UsersService', () => {
  let svc: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const m: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: getRepositoryToken(User), useValue: repo }],
    }).compile();
    svc = m.get(UsersService);
  });

  it('createUser normalizes email, hashes the password, sets the role', async () => {
    repo.findOneBy.mockResolvedValue(null);
    repo.save.mockImplementation(async (u: User) => ({ ...u, createdAt: new Date() }));
    const u = await svc.createUser('Admin@Example.com', 'secret123', 'admin');
    expect(u.email).toBe('admin@example.com');
    expect(u.role).toBe('admin');
    const saved = repo.save.mock.calls[0][0] as User;
    expect(saved.passwordHash).not.toBe('secret123');
    expect(saved.passwordHash.length).toBeGreaterThan(20);
  });

  it('createUser rejects a duplicate email', async () => {
    repo.findOneBy.mockResolvedValue({ id: 'x', email: 'a@x.com' });
    await expect(svc.createUser('a@x.com', 'secret123')).rejects.toThrow(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('list returns public users without password hashes', async () => {
    repo.find.mockResolvedValue([{ id: '1', email: 'a@x.com', role: 'user', passwordHash: 'h', createdAt: new Date() }]);
    const rows = await svc.list();
    expect(rows[0]).not.toHaveProperty('passwordHash');
    expect(rows[0]).toMatchObject({ email: 'a@x.com', role: 'user' });
  });

  it('update changes role and re-hashes the password', async () => {
    const u = { id: '1', email: 'a@x.com', role: 'user', passwordHash: 'old', createdAt: new Date() };
    repo.findOneBy.mockResolvedValue(u);
    repo.save.mockImplementation(async (x) => x);
    const r = await svc.update('1', { role: 'admin', password: 'newsecret' });
    expect(r.role).toBe('admin');
    expect(u.passwordHash).not.toBe('old');
  });

  it('update rejects an email already taken by another user', async () => {
    repo.findOneBy.mockImplementation(async (q: { id?: string; email?: string }) =>
      q.id === '1' ? { id: '1', email: 'a@x.com', role: 'user' } : { id: '2', email: 'b@x.com' });
    await expect(svc.update('1', { email: 'b@x.com' })).rejects.toThrow(ConflictException);
  });

  it('update throws NotFound for a missing user', async () => {
    repo.findOneBy.mockResolvedValue(null);
    await expect(svc.update('missing', { role: 'admin' })).rejects.toThrow();
  });

  it('remove deletes by id', async () => {
    repo.delete.mockResolvedValue({});
    await svc.remove('1');
    expect(repo.delete).toHaveBeenCalledWith({ id: '1' });
  });
});
