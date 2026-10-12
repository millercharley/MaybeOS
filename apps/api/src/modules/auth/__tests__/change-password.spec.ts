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
  let email: { sendMagicLink: jest.Mock; sendPasswordSet: jest.Mock };

  const CURRENT = 'the-old-one';
  let hash: string;

  beforeAll(async () => {
    hash = await bcrypt.hash(CURRENT, 10);
  });

  beforeEach(async () => {
    email = { sendMagicLink: jest.fn(), sendPasswordSet: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', email: 'ada@example.com', name: 'Ada', passwordHash: hash }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'x' } },
        { provide: EmailService, useValue: email },
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

  /**
   * Creating a first one (AUTH-04).
   *
   * Charley: "make sure that for users who entered their organization via the
   * Magic Link, that they have the option to create a password on their
   * account once they are inside their organization."
   *
   * This used to refuse them: "this account has no password set, so there is
   * nothing to change". At MaybeItsFate that is 433 of 439 members — everyone
   * who came in through a sign-in link — so the one screen for setting a
   * password worked for almost nobody.
   */
  describe('an account that has never had one', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'ada@example.com',
        name: 'Ada',
        passwordHash: null,
      });
    });

    it('sets one without asking for a password that does not exist', async () => {
      const out = await service.changePassword('user-1', undefined, 'a-much-better-one');

      expect(out).toMatchObject({ changed: true, created: true });
      const { data } = prisma.user.update.mock.calls[0][0];
      await expect(bcrypt.compare('a-much-better-one', data.passwordHash)).resolves.toBe(true);
    });

    it('ignores a current password offered anyway', async () => {
      // The browser hides the field, but nothing stops an old tab sending one.
      await expect(
        service.changePassword('user-1', 'made-up', 'a-much-better-one'),
      ).resolves.toMatchObject({ created: true });
    });

    it('invalidates the sign-in link that got them here', async () => {
      // Same reasoning as changing one: another way in defeats the point.
      await service.changePassword('user-1', undefined, 'a-much-better-one');

      const { data } = prisma.user.update.mock.calls[0][0];
      expect(data.magicLinkToken).toBeNull();
      expect(data.magicLinkExpiry).toBeNull();
    });

    it('tells the address that owns the account', async () => {
      /*
        The compensating control. Requiring the current password exists to
        stop a borrowed browser taking an account permanently — and setting a
        *first* password on a borrowed session does exactly that, with no
        password to ask for. So the owner is told while they can still act.
      */
      await service.changePassword('user-1', undefined, 'a-much-better-one');

      expect(email.sendPasswordSet).toHaveBeenCalledWith('ada@example.com', {
        name: 'Ada',
        created: true,
      });
    });

    it('does not fail the change because the notice would not send', async () => {
      // The password is already set. Failing now would tell the member it is
      // not, which is the one answer that is wrong.
      email.sendPasswordSet.mockRejectedValue(new Error('postmark is down'));

      await expect(
        service.changePassword('user-1', undefined, 'a-much-better-one'),
      ).resolves.toMatchObject({ changed: true });
    });
  });

  describe('an account that already has one', () => {
    it('still refuses without the current password', async () => {
      // The rule that protects a borrowed browser has not moved.
      await expect(
        service.changePassword('user-1', undefined, 'a-much-better-one'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('still refuses a wrong one', async () => {
      await expect(
        service.changePassword('user-1', 'not-it', 'a-much-better-one'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('says it was a change rather than a creation', async () => {
      const out = await service.changePassword('user-1', CURRENT, 'a-much-better-one');

      expect(out).toMatchObject({ created: false });
      expect(email.sendPasswordSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ created: false }),
      );
    });
  });
});
