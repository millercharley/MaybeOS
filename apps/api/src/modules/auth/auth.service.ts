import {
  Injectable,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
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
   * Generate a magic-link token for passwordless authentication.
   * Stores a random UUID token with a 15-minute expiry on the user record.
   * Actual email sending is delegated to the caller / email module.
   */
  async sendMagicLink(email: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Return a token-shaped string to avoid leaking whether the email exists.
      // The caller should still "send" the email so timing is consistent.
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
            org: { select: { id: true, name: true, slug: true, logoUrl: true } },
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
