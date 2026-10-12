import {
  Injectable,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private email: EmailService,
    private storage: StorageService,
  ) {}

  /**
   * Validate a user's email and password.
   * Returns the user (without passwordHash) or null if invalid.
   */
  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    const { passwordHash, ...result } = user;
    return result;
  }

  /**
   * Generate a JWT for an authenticated user.
   * The payload includes org role mappings so guards can check permissions
   * without additional database queries.
   */
  async login(user: { id: string; email: string; globalRole: string }) {
    const orgMemberships = await this.prisma.userOrg.findMany({
      where: { userId: user.id },
      select: { orgId: true, role: true },
    });

    const orgRoles: Record<string, string> = {};
    for (const membership of orgMemberships) {
      orgRoles[membership.orgId] = membership.role;
    }

    const payload = {
      sub: user.id,
      email: user.email,
      globalRole: user.globalRole,
      orgRoles,
    };

    /*
      When they last got in (MEM-24).

      `lastLoginAt` has been on the user since the beginning and was never
      written once — `member-profile.service.ts` even says so in a comment,
      and worked around it. An organiser looking at a roster of 437 after a
      migration wants exactly this: who has actually arrived.

      Every way in ends here: the password form, the magic link and
      registering. Refreshing a token does not — it has its own method — so
      this counts arrivals rather than inflating them each time a tab
      renews its session, which is what makes the number worth reading.

      Not awaited, and failures are swallowed. Somebody signing in must not
      be turned away because a bookkeeping write was slow — the login has
      already succeeded by the time this runs.
    */
    try {
      void Promise.resolve(
        this.prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        }),
      ).catch(() => undefined);
    } catch {
      // Belt and braces, and not theoretical: a synchronous throw here —
      // a closed client, a mocked method returning nothing — would come
      // out of `login` itself and refuse a sign-in that had already
      // succeeded. Caught by the API's own test suite doing exactly that.
    }

    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  /**
   * Register a new user with a bcrypt-hashed password.
   */
  async register(email: string, password: string, name?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
      },
    });

    const { passwordHash: _, ...result } = user;
    return result;
  }

  /**
   * Where the web app verifies a magic-link token.
   *
   * WEB_URL doubles as the CORS allowlist and may therefore hold several
   * comma-separated origins; the first one is the canonical site. A trailing
   * slash would produce `https://maybeos.org//magic-link`, which routes but
   * looks broken in an email client's link preview.
   */
  private magicLinkUrl(token: string): string {
    const configured =
      this.configService.get<string>('WEB_URL') || 'http://localhost:3000';
    const base = configured.split(',')[0].trim().replace(/\/+$/, '');
    return `${base}/magic-link?token=${encodeURIComponent(token)}`;
  }

  /**
   * Issue a magic-link token and email it to the address that asked.
   *
   * The token used to be generated, stored, and then dropped on the floor:
   * nothing was wired to send it, so the login screen said "we sent a magic
   * link" and nobody ever received one (AUTH-02). With no password reset
   * either, that made a forgotten password unrecoverable.
   *
   * An unknown address still gets a token-shaped return value and no email,
   * so the endpoint cannot be used to enumerate who has an account.
   */
  async sendMagicLink(email: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return uuidv4();
    }

    const token = uuidv4();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        magicLinkToken: token,
        magicLinkExpiry: expiry,
      },
    });

    // Caught here rather than trusting EmailService to swallow everything:
    // it builds the template outside its own try block, so a bad template
    // would throw. That would make this endpoint answer 500 for a real
    // address and 200 for an unknown one — an account-enumeration oracle
    // built out of an error path.
    try {
      await this.email.sendMagicLink(user.email, this.magicLinkUrl(token));
    } catch (err) {
      this.logger.error(
        `Magic link stored but not sent for ${user.email}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return token;
  }

  /**
   * Validate a magic-link token. The token must exist and not be expired.
   * On success the token is cleared and the user is returned.
   */
  async validateMagicLink(token: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        magicLinkToken: token,
        magicLinkExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        magicLinkToken: null,
        magicLinkExpiry: null,
        emailVerified: true,
      },
    });

    const { passwordHash, ...result } = user;
    return result;
  }

  /**
   * Issue a fresh JWT with current org roles.
   */
  async refreshToken(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const { passwordHash, ...safe } = user;
    return this.login(safe as any);
  }

  /**
   * Return the full user profile including organisation memberships.
   */
  /**
   * The signed-in user's own profile.
   *
   * Fields are selected rather than spread-and-delete (OPS-08). The previous
   * version stripped `passwordHash` and returned everything else, which
   * included `magicLinkToken` and `magicLinkExpiry` — a live bearer
   * credential echoed into a response that the browser keeps in memory and
   * Sentry records a breadcrumb for. Selecting means a column added to `User`
   * later is not published here by default.
   */
  async getProfile(userId: string) {
    /*
      Whether there is a password, asked as a count (AUTH-04).

      The browser needs to know which question to put — "create a password"
      or "change the one you have" — and had no way to tell, so it always
      asked for a current password and 433 of MaybeItsFate's 439 members
      could not answer.

      A count rather than selecting the column and reducing it to a boolean,
      because the rule above is that a credential is never *fetched*: a hash
      held in memory is one careless spread away from a response, and the
      test that pins this reads the `select`, not the output. One indexed
      count against a primary key, alongside a query that already joins
      memberships and co-ops.
    */
    const [user, withPassword] = await Promise.all([
      this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        avatarPath: true,
        globalRole: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        // Selected, not included: the raw UserOrg row also carries
        // stripeCustomerId and stripeSubscriptionId, which the browser has no
        // use for. Same reasoning as excluding the magic-link token above.
        orgs: {
          select: {
            orgId: true,
            role: true,
            tierId: true,
            subscriptionStatus: true,
            // Whether this membership is ending, and when (PLT-06). A
            // cancellation through Stripe's portal leaves the status ACTIVE
            // until the paid period runs out, so the status alone cannot tell
            // a member who is leaving from one who is staying.
            cancelAtPeriodEnd: true,
            currentPeriodEnd: true,
            // Whether Stripe is actually behind this membership (MEM-23).
            //
            // `subscriptionStatus` stopped being proof of that the moment an
            // organiser could set it by hand: a $0 member is ACTIVE and has
            // no Stripe customer at all, and offering them "Manage billing"
            // opens a portal session that cannot be created. The id itself
            // stays server-side; only whether there is one travels.
            stripeSubscriptionId: true,
            memberSince: true,
            // `brandColor` and `logoUrl` so a member's own pages can carry
            // their co-op's colours without a second request on every
            // navigation (BRD-01); `bannerUrl` and `memberGoal` for the same
            // reason on the member dashboard (DSH-01). All four are the co-op's
            // public identity — none of it is anybody's private data.
            org: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                brandColor: true,
                bannerUrl: true,
                memberGoal: true,
                // Where members the co-op imported still pay, for the one
                // card on their billing page that is about the money already
                // leaving their account (MIG-03). The co-op's own address,
                // not anybody's private data.
                legacyBillingUrl: true,
                // What "today" means at this co-op. The member dashboard heads
                // its list with today's events, and a member reading it from
                // another timezone is asking what is on at the *space*.
                timezone: true,
              },
            },
          },
        },
      },
      }),
      this.prisma.user.count({ where: { id: userId, NOT: { passwordHash: null } } }),
    ]);

    if (!user) return user;

    // The id itself does not travel; only the fact that there is one. It is
    // selected above so this can be answered, and dropped here because the
    // browser has no use for a Stripe id and every reason not to hold one.
    return {
      ...user,
      hasPassword: withPassword > 0,
      orgs: user.orgs.map(({ stripeSubscriptionId, ...membership }) => ({
        ...membership,
        stripeBilled: stripeSubscriptionId !== null,
      })),
    };
  }

  /** Update the fields a member owns about themselves. */
  /**
   * Change your own password.
   *
   * MaybeOS had no way to do this — no endpoint, no screen, and no
   * forgot-password either. A password, once set at registration, was
   * permanent. That is ordinarily an annoyance; it became urgent when
   * SEC-08 exposed every stored hash to anyone holding a public key, and
   * there was no way to rotate the one credential that had been disclosed.
   *
   * **Changing one requires the current one.** A stolen or borrowed browser
   * session should not be enough to take an account permanently, which is
   * exactly what silently changing the password does.
   *
   * **Creating a first one cannot**, and that is the whole of AUTH-04.
   * Everybody who arrived through a sign-in link has no password, which at
   * MaybeItsFate is 433 of 439 members — and this refused every one of them
   * with "this account has no password set, so there is nothing to change".
   * There is no current password to ask for, so the session is the
   * authorisation: it was itself established by a link sent to that address.
   *
   * The threat the current-password rule guards against does not disappear,
   * though — a borrowed session setting a *first* password takes the account
   * just as permanently. So the compensating control is that we say so, by
   * email, to the address that owns the account. Somebody who did not do it
   * finds out while they can still act.
   *
   * Deliberately still not a password *reset*: that is for somebody who
   * cannot get in at all, and the answer for them today is the sign-in link.
   */
  async changePassword(userId: string, currentPassword: string | undefined, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const creating = !user.passwordHash;

    if (!creating) {
      if (!currentPassword) {
        throw new BadRequestException('Enter your current password to change it');
      }
      const matches = await bcrypt.compare(currentPassword, user.passwordHash!);
      if (!matches) {
        throw new UnauthorizedException('Your current password is not correct');
      }
      if (currentPassword === newPassword) {
        throw new BadRequestException('That is the password you already have');
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        // Any outstanding magic-link token is invalidated too: if the reason
        // for changing a password is that somebody else may have it, leaving
        // them another way in defeats the point.
        magicLinkToken: null,
        magicLinkExpiry: null,
      },
    });

    /*
      Told, not asked. Best-effort on purpose: the password is already set,
      and failing the request now would leave the member believing it was
      not. A bounced notice is worth less than a wrong answer.
    */
    if (user.email) {
      await this.email
        .sendPasswordSet(user.email, { name: user.name ?? null, created: creating })
        .catch((error) =>
          this.logger.warn(`Could not send the password notice: ${(error as Error).message}`),
        );
    }

    return { changed: true, created: creating };
  }

  /**
   * A member's own photo of themselves (MEM-11).
   *
   * Charley: let somebody replace the letter in the circle. Until now the only
   * way a face got into MaybeOS was a member *import*, which copies one from
   * whatever platform a co-op is leaving — so anybody who joined directly had
   * an initial and no way to change it.
   *
   * Order matters, as with the org logo: upload to a fresh key, point the row
   * at it, delete the previous object last. A failure anywhere leaves the
   * member with the photo they had rather than a broken image on every post
   * they have ever written.
   *
   * `avatarUrl` is cleared deliberately. It holds the *external* link an
   * import copied from, and it is the fallback the interceptor leaves in place
   * when signing fails — so leaving it set would mean a member who uploads a
   * new photo still shows their old one from the platform they left, on any
   * request where signing hiccups.
   */
  async setAvatar(userId: string, data: string, mimeType: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, avatarPath: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Accepts either a bare base64 string or the data: URL a browser's
    // FileReader hands back.
    const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
    const bytes = Buffer.from(base64.replace(/\s/g, ''), 'base64');

    const avatarPath = await this.storage.uploadAvatar(userId, bytes, mimeType);

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarPath, avatarUrl: null },
    });

    await this.storage.deleteAvatar(userId, user.avatarPath);

    return this.getProfile(userId);
  }

  /** Go back to the letter in the circle. */
  async removeAvatar(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, avatarPath: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarPath: null, avatarUrl: null },
    });

    await this.storage.deleteAvatar(userId, user.avatarPath);

    return this.getProfile(userId);
  }

  async updateProfile(userId: string, dto: { name?: string; avatarUrl?: string | null }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
      },
    });

    return this.getProfile(userId);
  }
}
