import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * The magic link actually gets emailed (AUTH-02).
 *
 * The token was being generated, stored with a 15-minute expiry, and then
 * discarded — nothing was wired to send it. The failure was invisible from
 * every angle that gets checked: the endpoint returned 200, the login screen
 * said "we sent a magic link to you", the row in the database looked correct,
 * and no error was logged anywhere. Only the person waiting for the email
 * could tell, and they had no way to report it, because with no
 * forgot-password flow either, a forgotten password meant a locked account
 * with no way back in.
 *
 * So these tests assert on the message that leaves the building, not on the
 * token that gets stored.
 */
describe('AuthService — magic link delivery', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
  let email: { sendMagicLink: jest.Mock };
  let webUrl: string;

  const user = { id: 'user-1', email: 'alex@example.com' };

  beforeEach(async () => {
    webUrl = 'https://maybeos.org';
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue(user),
      },
    };
    email = { sendMagicLink: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'WEB_URL' ? webUrl : undefined) },
        },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  /** The token as it was actually written to the user row. */
  const storedToken = () => prisma.user.update.mock.calls[0][0].data.magicLinkToken;

  /** The link as it was actually handed to the email service. */
  const sentLink = () => email.sendMagicLink.mock.calls[0][1] as string;

  it('emails the link to the address that asked', async () => {
    await service.sendMagicLink('alex@example.com');

    expect(email.sendMagicLink).toHaveBeenCalledTimes(1);
    expect(email.sendMagicLink.mock.calls[0][0]).toBe('alex@example.com');
  });

  it('sends the same token it stored', async () => {
    // The quiet way for this to break: rotate the token after building the
    // link, and every recipient gets a link that 401s while the logs show a
    // send succeeded.
    await service.sendMagicLink('alex@example.com');

    expect(sentLink()).toContain(`token=${storedToken()}`);
  });

  it('points at the verify page the web app actually serves', async () => {
    await service.sendMagicLink('alex@example.com');

    expect(sentLink().startsWith('https://maybeos.org/magic-link?token=')).toBe(true);
  });

  it('uses the first origin when WEB_URL carries the CORS allowlist', async () => {
    // WEB_URL is also the CORS allowlist and may hold several origins. Pasting
    // the raw value into a URL would produce a link to a comma-separated mess.
    webUrl = 'https://maybeos.org,https://www.maybeos.org';
    await service.sendMagicLink('alex@example.com');

    expect(sentLink()).toBe(`https://maybeos.org/magic-link?token=${storedToken()}`);
  });

  it('does not double the slash when WEB_URL has a trailing one', async () => {
    webUrl = 'https://maybeos.org/';
    await service.sendMagicLink('alex@example.com');

    expect(sentLink()).not.toContain('org//magic-link');
  });

  it('sends nothing for an address with no account', async () => {
    // Mailing a stranger would confirm to whoever typed the address that it
    // is not registered — and would spam the address it does belong to.
    prisma.user.findUnique.mockResolvedValue(null);

    const token = await service.sendMagicLink('ghost@example.com');

    expect(email.sendMagicLink).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(typeof token).toBe('string'); // still token-shaped, so timing matches
  });

  it('survives the mail provider being down', async () => {
    // EmailService swallows its own failures; if that ever changes, the
    // request must not start throwing 500s, because a 500 for a real address
    // and a 200 for an unknown one is an account-enumeration oracle.
    email.sendMagicLink.mockRejectedValue(new Error('postmark unreachable'));

    await expect(service.sendMagicLink('alex@example.com')).resolves.toBeDefined();
  });
});
