import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../config/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<PrismaService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: '$2b$10$hashedpassword',
    name: 'Test User',
    globalRole: 'USER',
    emailVerified: false,
    avatarUrl: null,
    magicLinkToken: null,
    magicLinkExpiry: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            userOrg: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-value'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);
  });

  describe('validateUser', () => {
    it('should return user without passwordHash on valid credentials', async () => {
      const hashed = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, passwordHash: hashed });

      const result = await service.validateUser('test@example.com', 'password123');

      expect(result).toBeDefined();
      expect(result.email).toBe('test@example.com');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should return null if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUser('notfound@example.com', 'password');

      expect(result).toBeNull();
    });

    it('should return null if password is incorrect', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.validateUser('test@example.com', 'wrong-password');

      expect(result).toBeNull();
    });

    it('should return null if user has no password (magic-link only)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, passwordHash: null });

      const result = await service.validateUser('test@example.com', 'anything');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return an access token with org roles in payload', async () => {
      prisma.userOrg.findMany.mockResolvedValue([
        { orgId: 'org-1', role: 'ADMIN' } as any,
        { orgId: 'org-2', role: 'MEMBER' } as any,
      ]);

      const result = await service.login({
        id: 'user-1',
        email: 'test@example.com',
        globalRole: 'USER',
      });

      expect(result).toEqual({ accessToken: 'mock-jwt-token' });
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'test@example.com',
        globalRole: 'USER',
        orgRoles: { 'org-1': 'ADMIN', 'org-2': 'MEMBER' },
      });
    });
  });

  describe('register', () => {
    it('should create a user with hashed password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await service.register('new@example.com', 'password123', 'New User');

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'new@example.com',
          name: 'New User',
        }),
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should throw ConflictException if email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.register('test@example.com', 'password123'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('sendMagicLink', () => {
    it('should generate token and set 15-min expiry for existing user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      const token = await service.sendMagicLink('test@example.com');

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          magicLinkToken: expect.any(String),
          magicLinkExpiry: expect.any(Date),
        }),
      });
    });

    it('should return a fake token for non-existent email (no leak)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const token = await service.sendMagicLink('ghost@example.com');

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('validateMagicLink', () => {
    it('should return user and clear token on valid magic link', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.validateMagicLink('valid-token');

      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('passwordHash');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          magicLinkToken: null,
          magicLinkExpiry: null,
          emailVerified: true,
        },
      });
    });

    it('should throw UnauthorizedException for invalid/expired token', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.validateMagicLink('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getProfile', () => {
    it('should return user profile with orgs', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        orgs: [{ orgId: 'org-1', role: 'ADMIN', org: { name: 'Test Org' } }],
      } as any);

      const result = await service.getProfile('user-1');

      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should return null if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getProfile('nonexistent');

      expect(result).toBeNull();
    });
  });
});
