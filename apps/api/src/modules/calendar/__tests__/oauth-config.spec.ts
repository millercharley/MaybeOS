import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { CalendarService } from '../calendar.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * "Connect calendar" refuses honestly when Google is not set up.
 *
 * Before SPC-04 an unconfigured server answered 200 with a perfectly shaped
 * Google URL carrying `client_id=""`, so the button succeeded and dropped the
 * admin on Google's `invalid_client` page with nothing tying it back to
 * MaybeOS. The check that replaced it read the client id and secret and *not*
 * the redirect URI — which reproduces the same failure one step later, because
 * Google rejects an empty or unregistered `redirect_uri` on its own page too.
 */
describe('CalendarService — OAuth configuration gate', () => {
  const build = async (env: Record<string, string>) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: {} },
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
      ],
    }).compile();
    return moduleRef.get(CalendarService);
  };

  const FULL = {
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REDIRECT_URI: 'https://maybeos.org/api/calendar/oauth/callback',
  };

  it('builds a consent URL when all three settings are present', async () => {
    const service = await build(FULL);

    expect(service.isConfigured).toBe(true);
    expect(service.getAuthUrl('org-1', 'room-1')).toContain(
      'client_id=id.apps.googleusercontent.com',
    );
  });

  it.each([
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
  ])('refuses, naming %s, when it is missing', async (key) => {
    const service = await build({ ...FULL, [key]: '' });

    expect(service.isConfigured).toBe(false);
    expect(() => service.getAuthUrl('org-1', 'room-1')).toThrow(
      ServiceUnavailableException,
    );
    expect(() => service.getAuthUrl('org-1', 'room-1')).toThrow(key);
  });

  it('names only what is actually missing', async () => {
    const service = await build({ ...FULL, GOOGLE_REDIRECT_URI: '   ' });

    // An admin who has set the id and secret should not be sent back to
    // re-check the two settings that are already right.
    expect(() => service.getAuthUrl('org-1', 'room-1')).toThrow(
      'Google Calendar is not configured on this server (GOOGLE_REDIRECT_URI).',
    );
  });

  it('treats whitespace as unset', async () => {
    const service = await build({ ...FULL, GOOGLE_CLIENT_SECRET: '\t' });

    expect(service.isConfigured).toBe(false);
  });
});
