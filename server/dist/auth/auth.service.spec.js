"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const jwt_1 = require("@nestjs/jwt");
const common_1 = require("@nestjs/common");
const auth_service_1 = require("./auth.service");
const users_service_1 = require("../users/users.service");
const mockUsers = { findByEmail: jest.fn(), findById: jest.fn(), create: jest.fn() };
const mockJwt = { sign: jest.fn().mockReturnValue('token') };
describe('AuthService', () => {
    let service;
    beforeEach(async () => {
        jest.clearAllMocks();
        const module = await testing_1.Test.createTestingModule({
            providers: [
                auth_service_1.AuthService,
                { provide: users_service_1.UsersService, useValue: mockUsers },
                { provide: jwt_1.JwtService, useValue: mockJwt },
            ],
        }).compile();
        service = module.get(auth_service_1.AuthService);
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
            await expect(service.register('test@x.com', 'password123')).rejects.toThrow(common_1.ConflictException);
        });
    });
    describe('login', () => {
        it('throws UnauthorizedException for wrong password', async () => {
            mockUsers.findByEmail.mockResolvedValue({ id: '1', email: 'test@x.com', passwordHash: '$2a$10$invalid' });
            await expect(service.login('test@x.com', 'wrongpassword')).rejects.toThrow(common_1.UnauthorizedException);
        });
        it('throws UnauthorizedException for missing user', async () => {
            mockUsers.findByEmail.mockResolvedValue(null);
            await expect(service.login('nobody@x.com', 'pass')).rejects.toThrow(common_1.UnauthorizedException);
        });
    });
});
//# sourceMappingURL=auth.service.spec.js.map