import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

const mockUsers = { findByEmail: jest.fn(), findById: jest.fn(), create: jest.fn() };
const mockJwt = { sign: jest.fn().mockReturnValue('token') };

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsers },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('register', () => {
    it('creates a user and returns token', async () => {
      mockUsers.findByEmail.mockResolvedValue(null);
      mockUsers.create.mockResolvedValue({ id: '1', email: 'test@x.com' });
      const result = await service.register('Test@X.com', 'password123');
      expect(result.token).toBe('token');
      expect(result.user.email).toBe('test@x.com');
      expect(mockUsers.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@x.com' }));
    });

    it('throws ConflictException when email exists', async () => {
      mockUsers.findByEmail.mockResolvedValue({ id: '1', email: 'test@x.com' });
      await expect(service.register('test@x.com', 'password123')).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException for wrong password', async () => {
      mockUsers.findByEmail.mockResolvedValue({ id: '1', email: 'test@x.com', passwordHash: '$2a$10$invalid' });
      await expect(service.login('test@x.com', 'wrongpassword')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for missing user', async () => {
      mockUsers.findByEmail.mockResolvedValue(null);
      await expect(service.login('nobody@x.com', 'pass')).rejects.toThrow(UnauthorizedException);
    });
  });
});
