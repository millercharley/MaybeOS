import { Test } from '@nestjs/testing';
import { EventsService } from '../events.service';
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
});
