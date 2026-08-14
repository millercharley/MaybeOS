import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ConnectService } from './connect.service';

/**
 * Where Stripe sends an admin back after they authorise MaybeOS (PAY-05).
 *
 * Deliberately outside `orgs/:orgId` and deliberately **unauthenticated**,
 * because neither is available here: Stripe redirects the browser, so there is
 * no Authorization header, and an org id in the URL would be caller-supplied —
 * which is exactly the thing that must not decide whose account gets
 * connected.
 *
 * The signed `state` carries the org instead. It is HMAC-signed with the
 * server's secret, expires in ten minutes, and is verified before anything is
 * written. See `connect-oauth.ts`, where that is the whole subject.
 *
 * Redirects rather than returning JSON: a person is looking at this, not a
 * program, and they should land back in Settings either way.
 */
@ApiTags('connect')
@Controller('connect/oauth')
export class ConnectOAuthController {
  private readonly logger = new Logger(ConnectOAuthController.name);

  constructor(
    private readonly connectService: ConnectService,
    private readonly configService: ConfigService,
  ) {}

  @Get('callback')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Stripe OAuth return URL' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const settings = `${this.webUrl()}/admin/settings`;

    // The admin pressed "cancel" on Stripe's page, or Stripe refused. Not an
    // error worth a stack trace — they simply changed their mind.
    if (error) {
      this.logger.log(`Stripe OAuth declined: ${error} ${errorDescription ?? ''}`);
      return res.redirect(`${settings}?stripe=declined`);
    }

    if (!code) {
      return res.redirect(`${settings}?stripe=error`);
    }

    try {
      await this.connectService.completeOAuth(code, state);
      return res.redirect(`${settings}?stripe=connected`);
    } catch (err) {
      // The reason is already logged where it happened. What matters here is
      // that the admin lands somewhere that explains itself rather than on a
      // raw JSON error from a redirect they did not know they were making.
      this.logger.error(
        `Stripe OAuth callback failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return res.redirect(`${settings}?stripe=error`);
    }
  }

  private webUrl(): string {
    const configured =
      this.configService.get<string>('WEB_URL') || 'http://localhost:3000';
    return configured.split(',')[0].trim().replace(/\/+$/, '');
  }
}
