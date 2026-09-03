import { Test } from '@nestjs/testing';
import { HostBriefingService } from '../host-briefing.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * Sending hosts their briefing (SRV-03).
 *
 * Two failure modes matter more than the feature: **everyone gets it four
 * times**, and **everyone in the co-op's history gets it at once the moment
 * an admin switches it on**. Most of what follows is about those.
 */
describe('HostBriefingService.sendDue', () => {
  let service: HostBriefingService;
  let prisma: any;
  let email: any;

  const ORG = { id: 'org-1', name: 'Sunrise', timezone: 'America/New_York' };

  // 2 Sep 2026, 18:00–21:00 New York.
  const BOOKING = {
    id: 'booking-1',
    startTime: new Date('2026-09-02T22:00:00.000Z'),
    endTime: new Date('2026-09-03T01:00:00.000Z'),
    createdAt: new Date('2026-08-20T12:00:00.000Z'),
    user: { email: 'host@example.com', name: 'Sam Ito' },
    room: { id: 'room-1', name: 'The Attic', orgId: 'org-1' },
    briefings: [],
  };

  const briefing = (over: Record<string, unknown> = {}) => ({
    id: 'b1',
    orgId: 'org-1',
    phase: 'BEFORE',
    subject: 'You have the Attic today',
    body: 'A few things before you open up.',
    anchor: 'CLOCK_ON_DAY',
    clockTime: '07:00',
    offsetMinutes: 60,
    isActive: true,
    ...over,
  });

  const build = async (opts: {
    briefings?: unknown[];
    bookings?: unknown[];
    duties?: unknown[];
  } = {}) => {
    prisma = {
      hostBriefing: { findMany: jest.fn().mockResolvedValue(opts.briefings ?? [briefing()]) },
      booking: { findMany: jest.fn().mockResolvedValue(opts.bookings ?? [BOOKING]) },
      organization: { findMany: jest.fn().mockResolvedValue([ORG]) },
      hostDuty: { findMany: jest.fn().mockResolvedValue(opts.duties ?? []) },
      hostBriefingNotice: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    email = { sendRaw: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        HostBriefingService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = moduleRef.get(HostBriefingService);
    return service;
  };

  /** 07:00 New York on the booking's day. */
  const AT_SEVEN = new Date('2026-09-02T11:00:00.000Z');

  it('sends the briefing when it comes due', async () => {
    await (await build()).sendDue(AT_SEVEN);

    expect(email.sendRaw).toHaveBeenCalledTimes(1);
    const [to, subject, html] = email.sendRaw.mock.calls[0];
    expect(to).toBe('host@example.com');
    expect(subject).toBe('You have the Attic today');
    expect(html).toContain('The Attic');
    expect(html).toContain('Hi Sam,');
  });

  it('does nothing at all until a co-op has written a message', async () => {
    // The feature is off by absence, not by a flag. A co-op that has not set
    // this up must not have its members emailed because we shipped it.
    const s = await build({ briefings: [] });
    const result = await s.sendDue(AT_SEVEN);

    expect(result.sent).toBe(0);
    expect(email.sendRaw).not.toHaveBeenCalled();
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it('records what it sent before sending it', async () => {
    // A send that succeeds and then fails to record itself is an email the
    // member receives again on the next run — every fifteen minutes.
    await (await build()).sendDue(AT_SEVEN);

    const noticeOrder = prisma.hostBriefingNotice.createMany.mock.invocationCallOrder[0];
    const sendOrder = email.sendRaw.mock.invocationCallOrder[0];
    expect(noticeOrder).toBeLessThan(sendOrder);
  });

  it('never sends a phase twice', async () => {
    const s = await build({
      bookings: [{ ...BOOKING, briefings: [{ phase: 'BEFORE' }] }],
    });
    await s.sendDue(AT_SEVEN);

    expect(email.sendRaw).not.toHaveBeenCalled();
  });

  it('does not sweep the co-op’s history when the feature is switched on', async () => {
    // Every past booking is "due and never sent". Without the grace window,
    // turning this on emails everybody who has ever booked a room.
    const s = await build();
    await s.sendDue(new Date('2026-12-25T11:00:00.000Z'));

    expect(email.sendRaw).not.toHaveBeenCalled();
  });

  it('skips a briefing the booking was made too late to receive', async () => {
    // Booked at 09:00 for that afternoon: the 7am message describes a moment
    // that had already passed.
    const s = await build({
      bookings: [{ ...BOOKING, createdAt: new Date('2026-09-02T13:00:00.000Z') }],
    });
    await s.sendDue(AT_SEVEN);

    expect(email.sendRaw).not.toHaveBeenCalled();
  });

  it('sends phases due at the same moment as one email', async () => {
    // Charley's defaults put Before and During at 7am. Two emails a minute
    // apart is what a member would call spam.
    const s = await build({
      briefings: [
        briefing(),
        briefing({ id: 'b2', phase: 'DURING', subject: 'While you are in', body: 'Keep it down after 9.' }),
      ],
    });
    await s.sendDue(AT_SEVEN);

    expect(email.sendRaw).toHaveBeenCalledTimes(1);
    const [, subject, html] = email.sendRaw.mock.calls[0];
    // The earliest phase names the email.
    expect(subject).toBe('You have the Attic today');
    expect(html).toContain('Before you open up');
    expect(html).toContain('While you are in there');
  });

  it('sends the after-briefing separately, an hour before the end', async () => {
    const s = await build({
      briefings: [
        briefing({ phase: 'AFTER', anchor: 'BEFORE_END', offsetMinutes: 60, subject: 'Before you lock up' }),
      ],
    });
    // 20:00 New York — an hour before the 21:00 end.
    await s.sendDue(new Date('2026-09-03T00:00:00.000Z'));

    expect(email.sendRaw).toHaveBeenCalledTimes(1);
    expect(email.sendRaw.mock.calls[0][1]).toBe('Before you lock up');
  });

  it('includes the duties for the phase, org-wide before room-specific', async () => {
    const s = await build({
      duties: [
        { phase: 'BEFORE', roomId: 'room-1', sortOrder: 0, text: 'The Attic key is behind the desk.' },
        { phase: 'BEFORE', roomId: null, sortOrder: 0, text: 'Sign in at the front.' },
        { phase: 'AFTER', roomId: null, sortOrder: 0, text: 'Take the bins out.' },
      ],
    });
    await s.sendDue(AT_SEVEN);

    const html = email.sendRaw.mock.calls[0][2];
    // The general rule before its exception, which is how somebody reads it.
    expect(html.indexOf('Sign in at the front')).toBeLessThan(
      html.indexOf('The Attic key is behind the desk'),
    );
    // A different phase's duties must not leak into this email.
    expect(html).not.toContain('Take the bins out');
  });

  it('leaves out another room’s duties', async () => {
    const s = await build({
      duties: [{ phase: 'BEFORE', roomId: 'room-9', sortOrder: 0, text: 'Studio amp lives in the cupboard.' }],
    });
    await s.sendDue(AT_SEVEN);

    expect(email.sendRaw.mock.calls[0][2]).not.toContain('Studio amp');
  });

  it('escapes what an admin typed', async () => {
    const s = await build({
      briefings: [briefing({ body: 'Mind the <script>alert(1)</script> door' })],
    });
    await s.sendDue(AT_SEVEN);

    const html = email.sendRaw.mock.calls[0][2];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('takes the notice back when the provider rejects the email', async () => {
    // The notice is written first so a crash cannot re-send. That means a
    // rejected send has to be un-recorded, or it is a briefing nobody
    // receives and nothing retries.
    const s = await build();
    email.sendRaw.mockResolvedValueOnce(false);

    const result = await s.sendDue(AT_SEVEN);

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(prisma.hostBriefingNotice.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ bookingId: 'booking-1' }),
      }),
    );
  });

  it('stops retrying a rejected email once it is no longer due', async () => {
    // The retry is bounded by the grace window rather than a counter, so an
    // address that can never be delivered to is not tried forever.
    const s = await build();
    email.sendRaw.mockResolvedValue(false);

    await s.sendDue(AT_SEVEN);
    const later = new Date(AT_SEVEN.getTime() + 3 * 3_600_000);
    email.sendRaw.mockClear();
    await s.sendDue(later);

    expect(email.sendRaw).not.toHaveBeenCalled();
  });

  it('carries on after one booking fails', async () => {
    const s = await build({
      bookings: [BOOKING, { ...BOOKING, id: 'booking-2', user: { email: 'two@example.com', name: 'Ana' } }],
    });
    email.sendRaw.mockRejectedValueOnce(new Error('Postmark down'));

    const result = await s.sendDue(AT_SEVEN);
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.errors[0]).toContain('booking-1');
  });
});

describe('HostBriefingService.describeSchedule', () => {
  let service: HostBriefingService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HostBriefingService,
        { provide: PrismaService, useValue: {} },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(HostBriefingService);
  });

  it('says a clock-time schedule in words', () => {
    expect(
      service.describeSchedule(
        { anchor: 'CLOCK_ON_DAY', clockTime: '07:00', offsetMinutes: 60 },
        'America/New_York',
      ),
    ).toBe('At 07:00 on the day of the booking (New York time).');
  });

  it('says an offset schedule in words', () => {
    expect(
      service.describeSchedule(
        { anchor: 'BEFORE_END', clockTime: '07:00', offsetMinutes: 60 },
        'America/New_York',
      ),
    ).toBe('1 hour before the booking ends.');

    expect(
      service.describeSchedule(
        { anchor: 'BEFORE_START', clockTime: '07:00', offsetMinutes: 30 },
        'America/New_York',
      ),
    ).toBe('30 minutes before the booking starts.');
  });
});
