import {
  Injectable,
  ConflictException,
  UnauthorizedException,
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
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        orgs: {
          include: { org: true },
        },
      },
    });

    if (!user) {
      return null;
    }

    const { passwordHash, ...result } = user;
    return result;
  }
}
