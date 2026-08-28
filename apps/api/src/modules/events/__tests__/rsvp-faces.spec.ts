import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../config/prisma.service';
import { EventsService } from '../events.service';
import { EmailService } from '../../email/email.service';
import { CalendarService } from '../../calendar/calendar.service';
import { ConnectService } from '../../stripe/connect.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Who else is going (delight #3), and who is allowed to know.
 *
 * The feature is a row of faces on an event card. The thing worth testing is
 * the boundary around it: an event link may be public so strangers can RSVP,
 * but the guest list is not — a public page showing faces would tell anyone
 * with the URL who belongs to this co-op.
 */
describe('RSVP faces', () => {
  let prisma: any;
  let service: EventsService;

  beforeEach(async () => {
    prisma = {
      event: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => '' } },
        { provide: CalendarService, useValue: {} },
        { provide: ConnectService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(EventsService);
  });

  const includeOf = () => prisma.event.findMany.mock.calls[0][0].include;

  it('sends faces to a member', async () => {
    await service.listPublicEvents('org1', {}, true);
    expect(includeOf().rsvps).toBeDefined();
  });

  it('sends none to the public list', async () => {
    // The boundary. A stranger with the link can RSVP; they cannot learn who
    // else belongs here.
    await service.listPublicEvents('org1', {}, false);
    expect(includeOf().rsvps).toBeUndefined();
  });

  it('only shows people who are actually coming', async () => {
    await service.listPublicEvents('org1', {}, true);
    expect(includeOf().rsvps.where.status).toBe('CONFIRMED');
  });

  it('skips guest RSVPs, which have no account and no face', async () => {
    await service.listPublicEvents('org1', {}, true);
    expect(includeOf().rsvps.where.userId).toEqual({ not: null });
  });

  it('takes only a handful, because a card is not a guest list', async () => {
    await service.listPublicEvents('org1', {}, true);
    expect(includeOf().rsvps.take).toBeLessThanOrEqual(5);
  });

  it('flattens to faces the client can render', async () => {
    prisma.event.findMany.mockResolvedValue([
      {
        id: 'e1',
        _count: { rsvps: 9 },
        rsvps: [
          { user: { id: 'u1', name: 'Ada', avatarPath: null } },
          { user: { id: 'u2', name: 'Grace', avatarPath: null } },
        ],
      },
    ]);

    const result = await service.listPublicEvents('org1', {}, true);
    const [event] = result.data as any[];
    expect(event.rsvpFaces).toHaveLength(2);
    // The count is the truth about attendance; the faces are a sample of it.
    expect(event.rsvpCount).toBe(9);
    expect(event).not.toHaveProperty('rsvps');
  });

  it('leaves an empty list rather than throwing when none were selected', async () => {
    prisma.event.findMany.mockResolvedValue([{ id: 'e1', _count: { rsvps: 0 } }]);
    const result = await service.listPublicEvents('org1', {}, false);
    expect((result.data as any[])[0].rsvpFaces).toEqual([]);
  });
});
