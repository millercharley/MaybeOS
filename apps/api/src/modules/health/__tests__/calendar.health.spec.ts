import { CalendarHealthIndicator } from '../calendar.health';
import { ConfigService } from '@nestjs/config';

/**
 * Whether Google Calendar is set up, answerable without an admin token.
 *
 * Established the hard way: the only route to this fact was an authenticated
 * admin pressing Connect on a specific room and reading the error, which meant
 * a person, a session, and a deploy per attempt.
 */
describe('CalendarHealthIndicator', () => {
  const build = (env: Record<string, string | undefined>) =>
    new CalendarHealthIndicator({ get: (k: string) => env[k] } as ConfigService);

  const FULL = {
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REDIRECT_URI: 'https://maybeos.org/api/calendar/oauth/callback',
  };

  it('reports configured when all three are present', () => {
    expect(build(FULL).isHealthy('calendar')).toEqual({
      calendar: {
        status: 'up',
        configured: true,
        missing: [],
        redirectUri: 'https://maybeos.org/api/calendar/oauth/callback',
      },
    });
  });

  it('names exactly what is missing', () => {
    const result = build({ ...FULL, GOOGLE_CLIENT_SECRET: undefined }).isHealthy('calendar');

    expect(result.calendar).toMatchObject({
      configured: false,
      missing: ['GOOGLE_CLIENT_SECRET'],
    });
  });

  it('treats whitespace as unset', () => {
    expect(build({ ...FULL, GOOGLE_CLIENT_ID: '  ' }).isHealthy('calendar').calendar).toMatchObject({
      missing: ['GOOGLE_CLIENT_ID'],
    });
  });

  it('stays up when nothing is configured', () => {
    // A co-op that has never connected a calendar is the normal case. Failing
    // readiness over it would pull a working deployment out of rotation.
    expect(build({}).isHealthy('calendar').calendar).toMatchObject({
      status: 'up',
      configured: false,
      missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
      redirectUri: null,
    });
  });

  it('exposes no secret', () => {
    const reported = JSON.stringify(build(FULL).isHealthy('calendar'));

    expect(reported).not.toContain('secret');
    // The client id is not secret, but there is no reason to publish it.
    expect(reported).not.toContain('id.apps.googleusercontent.com');
  });
});
