import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Changing your own password (AUTH-03).
 *
 * MaybeOS had no way to do this at all — no endpoint, no screen, no
 * forgot-password. A password set at registration was permanent. That was an
 * annoyance until SEC-08 exposed every stored hash to anyone holding a public
 * key, at which point the one credential that had been disclosed was also the
 * one that could not be rotated.
 */
describe('AuthService — changePassword', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };

  const CURRENT = 'the-old-one';
  let hash: string;

  beforeAll(async () => {
    hash = await bcrypt.hash(CURRENT, 10);
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', passwordHash: hash }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'x' } },
        { provide: EmailService, useValue: { sendMagicLink: jest.fn() } },
        { provide: StorageService, useValue: { uploadAvatar: jest.fn(), deleteAvatar: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('stores a new hash, not the password', async () => {
    await service.changePassword('user-1', CURRENT, 'a-much-better-one');

    const stored = prisma.user.update.mock.calls[0][0].data.passwordHash;
    expect(stored).not.toBe('a-much-better-one');
    expect(await bcrypt.compare('a-much-better-one', stored)).toBe(true);
  });

  it('refuses without the current password', async () => {
    // A borrowed browser session should not be enough to take an account
    // permanently, which is what silently changing a password does.
    await expect(
      service.changePassword('user-1', 'not-it', 'a-much-better-one'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses to set the same password again', async () => {
    await expect(
      service.changePassword('user-1', CURRENT, CURRENT),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('invalidates any outstanding magic-link token', async () => {
    // If the reason for changing a password is that somebody else may have
    // it, leaving them a second way in defeats the point.
    await service.changePassword('user-1', CURRENT, 'a-much-better-one');

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.magicLinkToken).toBeNull();
    expect(data.magicLinkExpiry).toBeNull();
  });

  it('says so when the account has no password to change', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: null });

    await expect(
      service.changePassword('user-1', 'anything', 'a-much-better-one'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
