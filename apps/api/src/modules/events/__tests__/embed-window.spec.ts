import { Test } from '@nestjs/testing';
import { EventsService } from '../events.service';
import { RadarService } from '../../radar/radar.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';
import { ConnectService } from '../../stripe/connect.service';
import { CalendarService } from '../../calendar/calendar.service';
import { StorageService } from '../../storage/storage.service';

/**
 * The website embed shows the next 30 days, all of it (EVT-21).
 *
 * Charley: "Make sure the HTML always shows the next 30 days of events without
 * needing pagination." Two ways that goes wrong and both are silent — a window
 * that is not applied, so a co-op's site advertises something from next
 * spring; and a page size that truncates inside the window, so an event the
 * co-op published simply never appears on their own website.
 */
describe('EventsService.listEmbedEvents', () => {
  let service: EventsService;
  let listPublic: jest.Mock;

  beforeEach(async () => {
    const prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ id: 'org-1', name: 'MaybeItsFate', slug: 'maybeitsfate' }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EventsService,
        // Radar counts an RSVP toward the member's interests (RDR-01).
        { provide: RadarService, useValue: { recordRsvp: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: ConnectService, useValue: {} },
        { provide: CalendarService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(EventsService);
    listPublic = jest.fn().mockResolvedValue({ data: [] });
    (service as unknown as { listPublicEvents: unknown }).listPublicEvents = listPublic;
  });

  it('asks for exactly the next 30 days', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T12:00:00.000Z'));

    await service.listEmbedEvents('maybeitsfate');

    const [, filters] = listPublic.mock.calls[0];
    expect(filters.from).toBe('2026-09-03T12:00:00.000Z');
    expect(filters.to).toBe('2026-10-03T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('does not truncate inside the window', async () => {
    // A page size below the number of events in the window would hide events
    // the co-op published, on the co-op's own website, with no way to page.
    await service.listEmbedEvents('maybeitsfate');

    const [, filters] = listPublic.mock.calls[0];
    expect(filters.perPage).toBeGreaterThanOrEqual(200);
    expect(filters.page).toBeUndefined();
  });

  it('tells the caller what window it used', async () => {
    // The script prints "No events in the next 30 days", and that sentence has
    // to stay true if the window ever changes.
    const result = await service.listEmbedEvents('maybeitsfate');
    expect(result.windowDays).toBe(30);
  });

  it('returns every event the window contains', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      title: `Event ${i}`,
      slug: `e${i}`,
      startTime: new Date(),
      endTime: new Date(),
    }));
    listPublic.mockResolvedValue({ data: many });

    const result = await service.listEmbedEvents('maybeitsfate');
    expect(result.events).toHaveLength(40);
  });

  /*
    Past the window (EVT-54).

    Charley asked for a "See More" button revealing the next 15, having read
    the embed's ten events as a cap. It was not one — the feed is the whole
    30-day window and always was, and MaybeItsFate has exactly ten *public*
    events in it. So the button reaches past the window, not further into it,
    and that is the distinction these hold.
  */
  describe('what See More reveals', () => {
    it('asks for the next 15 starting where the window ends', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-03T12:00:00.000Z'));

      await service.listEmbedEvents('maybeitsfate');

      expect(listPublic).toHaveBeenCalledTimes(2);
      const [, filters] = listPublic.mock.calls[1];
      expect(filters.from).toBe('2026-10-03T12:00:00.000Z');
      expect(filters.perPage).toBe(15);

      jest.useRealTimers();
    });

    it('puts no end on that second read', async () => {
      // A co-op whose next event is in March still has something to show,
      // rather than a button that opens onto nothing.
      await service.listEmbedEvents('maybeitsfate');

      expect(listPublic.mock.calls[1][1].to).toBeUndefined();
    });

    it('starts exactly where the window stopped, so nothing falls between', async () => {
      await service.listEmbedEvents('maybeitsfate');

      expect(listPublic.mock.calls[1][1].from).toBe(listPublic.mock.calls[0][1].to);
    });

    it('keeps them in their own key, not appended to the window', async () => {
      // An older cached copy of embed.js ignores a key it does not know.
      // Appending would make every stale embed advertise next March.
      listPublic
        .mockResolvedValueOnce({ data: [{ title: 'In the window', slug: 'a' }] })
        .mockResolvedValueOnce({ data: [{ title: 'Beyond it', slug: 'b' }] });

      const feed = await service.listEmbedEvents('maybeitsfate');

      expect(feed.events.map((e) => e.title)).toEqual(['In the window']);
      expect(feed.more.map((e) => e.title)).toEqual(['Beyond it']);
    });

    it('shapes both lists the same way', async () => {
      // Same keys, because an event does not become a different thing for
      // being three weeks further out.
      listPublic
        .mockResolvedValueOnce({ data: [{ title: 'A', slug: 'a' }] })
        .mockResolvedValueOnce({ data: [{ title: 'B', slug: 'b' }] });

      const feed = await service.listEmbedEvents('maybeitsfate');

      expect(Object.keys(feed.more[0]).sort()).toEqual(Object.keys(feed.events[0]).sort());
    });

    it('still sends the end time each row needs to print a range', async () => {
      listPublic.mockResolvedValue({
        data: [{ title: 'A', slug: 'a', startTime: 'S', endTime: 'E' }],
      });

      const feed = await service.listEmbedEvents('maybeitsfate');

      expect(feed.events[0].endTime).toBe('E');
      expect(feed.more[0].endTime).toBe('E');
    });

    it('is still only the public ones, in both lists', async () => {
      // `listPublicEvents` is called without the member flag, which is the
      // whole reason nine of MaybeItsFate's nineteen events in the window
      // are not on its website.
      await service.listEmbedEvents('maybeitsfate');

      expect(listPublic.mock.calls[0][2]).toBeUndefined();
      expect(listPublic.mock.calls[1][2]).toBeUndefined();
    });
  });
});
