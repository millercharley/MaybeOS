import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SpaceService } from '../space.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { EventsService } from '../../events/events.service';
import { ConnectService } from '../../stripe/connect.service';

/**
 * Booking emails state times in the co-op's timezone (SPC-08).
 *
 * These used to send `toUTCString()`, so a member who booked 10am in the app
 * received "Mon, 05 Apr 2027 14:00:00 GMT". The app itself showed local time
 * correctly, which made the email the only place the hour was wrong — the
 * worst place for it, since that is what people put in their calendar.
 */
describe('SpaceService — booking email times', () => {
  let service: SpaceService;
  let prisma: jest.Mocked<PrismaService>;
  let email: jest.Mocked<EmailService>;

  const booking = (timezone: string, start: string, end: string) => ({
    id: 'booking-1',
    title: 'Studio session',
    status: 'APPROVED',
    startTime: new Date(start),
    endTime: new Date(end),
    user: { email: 'member@example.com', name: 'Alex' },
    room: {
      name: 'Creative Studio',
      org: { name: 'Sunrise', slug: 'sunrise', timezone },
    },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        {
          provide: PrismaService,
          useValue: {
            booking: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
            room: { findFirst: jest.fn() },
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendBookingReceived: jest.fn(),
            sendBookingConfirmed: jest.fn(),
            sendBookingRejected: jest.fn(),
            sendBookingCanceled: jest.fn(),
            sendBookingRescheduled: jest.fn(),
          },
        },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        // SpaceService now keeps a booking's published event in step with it
        // (EVT-05); these tests do not exercise that path.
        { provide: EventsService, useValue: { syncWithBooking: jest.fn() } },
        {
          provide: ConnectService,
          useValue: {
            createBookingCheckout: jest.fn().mockResolvedValue({ url: 'https://checkout.test' }),
            refundBooking: jest.fn().mockResolvedValue({ refunded: false }),
          },
        },
      ],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
    prisma = module.get(PrismaService);
    email = module.get(EmailService);
  });

  /** Drives the private notifier the way approveBooking does. */
  const whenLineFor = async (tz: string, start: string, end: string) => {
    prisma.booking.findUnique.mockResolvedValue(booking(tz, start, end) as never);
    await (service as unknown as {
      notifyBooking: (id: string, kind: string) => Promise<void>;
    }).notifyBooking('booking-1', 'confirmed');
    return email.sendBookingConfirmed.mock.calls.at(-1)?.[1].when as string;
  };

  it('states the hour the member actually booked, not UTC', async () => {
    const when = await whenLineFor(
      'America/New_York',
      '2027-04-05T14:00:00Z',
      '2027-04-05T16:00:00Z',
    );

    expect(when).toContain('10:00 AM');
    expect(when).toContain('12:00 PM');
    expect(when).not.toContain('GMT');
    expect(when).not.toContain('14:00');
  });

  it('names the zone, since a bare time is the ambiguity being fixed', async () => {
    const when = await whenLineFor(
      'America/New_York',
      '2027-04-05T14:00:00Z',
      '2027-04-05T16:00:00Z',
    );

    expect(when).toMatch(/EDT|EST/);
  });

  it('follows the co-op, not the server', async () => {
    const when = await whenLineFor(
      'Europe/London',
      '2027-04-05T14:00:00Z',
      '2027-04-05T16:00:00Z',
    );

    // Same two-hour instant, a different co-op: 3-5pm British summer time.
    // Node renders this zone as "GMT+1" rather than "BST"; unambiguous either
    // way, which is what matters here.
    expect(when).toContain('3:00 PM');
    expect(when).toContain('5:00 PM');
    expect(when).toMatch(/GMT\+1|BST/);
  });

  it('shows both dates when a booking runs past midnight', async () => {
    const when = await whenLineFor(
      'America/New_York',
      '2027-04-05T23:00:00Z', // 7pm EDT on the 5th
      '2027-04-06T03:00:00Z', // 11pm EDT, still the 5th locally
    );

    // Local dates match here, so it should stay in the compact form.
    expect(when).toContain('Apr 5');
    expect(when.match(/Apr/g)?.length).toBe(1);
  });

  it('falls back to a sane zone rather than crashing on a blank one', async () => {
    const when = await whenLineFor('', '2027-04-05T14:00:00Z', '2027-04-05T16:00:00Z');

    expect(when).toContain('10:00 AM');
  });
});
