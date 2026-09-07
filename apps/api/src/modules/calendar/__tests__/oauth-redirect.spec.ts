import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CalendarController } from '../calendar.controller';
import { CalendarService } from '../calendar.service';
import { PrismaService } from '../../../config/prisma.service';
import { encodeState } from '../../../common/oauth-state';

/**
 * Google sends the admin back to a page that exists.
 *
 * The callback redirected to `${APP_URL}/admin/rooms`. There is no
 * `/admin/rooms` route — `/admin/[orgSlug]` matches it — so a successful
 * connection landed the admin on the dashboard of a co-op named "rooms", and
 * the failure path redirected to `/settings`, which is not a route either.
 * Both read as green in every test that existed, because nothing executed the
 * callback.
 */
describe('CalendarController — where Google sends the admin back to', () => {
  let controller: CalendarController;
  let res: { redirect: jest.Mock };
  let service: { handleCallback: jest.Mock };

  // Signed, because the callback no longer reads an unsigned one (SEC-14) —
  // not even to decide where to send the admin back to.
  const SECRET = 'test-secret';
  const STATE = encodeState(
    { orgId: 'org-1', roomId: 'room-1', userId: 'user-1', issuedAt: Date.now() },
    SECRET,
  );

  beforeEach(async () => {
    res = { redirect: jest.fn() };
    service = {
      handleCallback: jest.fn().mockResolvedValue({ orgId: 'org-1', roomId: 'room-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [
        { provide: CalendarService, useValue: service },
        {
          provide: PrismaService,
          useValue: {
            organization: {
              findUnique: jest.fn().mockResolvedValue({ slug: 'sunrise' }),
            },
            room: {},
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              k === 'WEB_URL' ? 'https://maybeos.org' : k === 'JWT_SECRET' ? SECRET : undefined,
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(CalendarController);
  });

  it('returns to the rooms page of the org the room belongs to', async () => {
    await controller.handleOAuthCallback('code', STATE, undefined, res as any);

    expect(res.redirect).toHaveBeenCalledWith(
      'https://maybeos.org/admin/sunrise/rooms?calendar=connected&room=room-1',
    );
  });

  it('returns to the same page when the exchange fails', async () => {
    service.handleCallback.mockRejectedValue(new Error('invalid_grant'));

    // Not to a generic error page: the admin needs to be back where the
    // button is, so they can try it again.
    await controller.handleOAuthCallback('code', STATE, undefined, res as any);

    expect(res.redirect).toHaveBeenCalledWith(
      'https://maybeos.org/admin/sunrise/rooms?calendar=error',
    );
  });

  it('does not call an admin who pressed Cancel an error', async () => {
    await controller.handleOAuthCallback(undefined, STATE, 'access_denied', res as any);

    expect(res.redirect).toHaveBeenCalledWith(
      'https://maybeos.org/admin/sunrise/rooms?calendar=canceled',
    );
    expect(service.handleCallback).not.toHaveBeenCalled();
  });

  it('falls back to the org switcher when the state is unreadable', async () => {
    // The real service parses the same state and throws on this input.
    service.handleCallback.mockRejectedValue(new SyntaxError('Unexpected token'));

    await controller.handleOAuthCallback('code', 'not-json', undefined, res as any);

    // Anywhere real beats a URL built from an org id we do not have.
    expect(res.redirect).toHaveBeenCalledWith('https://maybeos.org/admin?calendar=error');
  });
});
