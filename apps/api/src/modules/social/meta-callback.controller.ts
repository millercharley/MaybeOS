import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { decodeState } from '../../common/oauth-state';
import { PrismaService } from '../../config/prisma.service';
import { SocialService } from './social.service';

/**
 * Where Facebook sends the admin back after they grant access. Public by
 * necessity; the signed state carries who started it and for which co-op.
 */
@ApiTags('social')
@Controller('social/meta')
export class MetaCallbackController {
  constructor(
    private readonly social: SocialService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const back = async (outcome: string, slug?: string) => {
      const target = slug ?? (await this.slugFromState(state));
      const base = target ? `${this.webUrl()}/admin/${target}/settings` : `${this.webUrl()}/admin`;
      res.redirect(`${base}?tab=integrations&social=${outcome}`);
    };

    if (error || !code || !state) return back('canceled');

    try {
      const { orgSlug, outcome } = await this.social.handleCallback(code, state);
      return back(outcome, orgSlug);
    } catch {
      return back('error');
    }
  }

  private webUrl(): string {
    return (this.config.get<string>('WEB_URL') || this.config.get<string>('APP_URL') || 'http://localhost:3000')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');
  }

  /** Only to decide where to send the admin back to. Nothing is written from it here. */
  private async slugFromState(state: string | undefined): Promise<string | null> {
    const decoded = decodeState(state, this.config.get<string>('JWT_SECRET') ?? '');
    if (!decoded) return null;
    const org = await this.prisma.organization.findUnique({ where: { id: decoded.orgId }, select: { slug: true } });
    return org?.slug ?? null;
  }
}
