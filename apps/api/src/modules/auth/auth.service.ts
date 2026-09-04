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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private email: EmailService,
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
    return this.prisma.user.findUnique({
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
                // What "today" means at this co-op. The member dashboard heads
                // its list with today's events, and a member reading it from
                // another timezone is asking what is on at the *space*.
                timezone: true,
              },
            },
          },
        },
      },
    });
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
   * Requires the current password rather than just a session. A stolen or
   * borrowed browser session should not be enough to take an account
   * permanently, which is exactly what silently changing the password does.
   *
   * Deliberately not a password *reset*: that needs a verified delivery
   * channel, and magic-link email is not wired up (AuthModule does not import
   * EmailModule), so a reset link would be generated and never sent. See
   * AUTH-02.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account has no password set, so there is nothing to change',
      );
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Your current password is not correct');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('That is the password you already have');
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

    return { changed: true };
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
