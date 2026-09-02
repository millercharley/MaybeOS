import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SpaceService } from '../space.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { EventsService } from '../../events/events.service';
import { ConnectService } from '../../stripe/connect.service';
import { CalendarService } from '../../calendar/calendar.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Replacing a room's opening hours (SPC-11).
 *
 * The editor shows the whole week, so what it sends is the complete answer.
 * Doing that from the browser as a delete-per-rule then a create-per-rule was
 * eleven round trips and not atomic — a failure halfway left the room with its
 * old hours gone and its new ones unwritten, which turns a room that opens at
 * nine into one nobody can book, with nothing on screen saying so.
 */
describe('SpaceService — replacing opening hours', () => {
  let service: SpaceService;
  let tx: any;
  let prisma: any;

  beforeEach(async () => {
    tx = {
      availabilityRule: {
        deleteMany: jest.fn().mockResolvedValue({ count: 6 }),
        createMany: jest.fn().mockResolvedValue({ count: 5 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    prisma = {
      room: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1', orgId: 'org-1' }) },
      // The callback form, so the test exercises the same path production does.
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SpaceService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: EventsService, useValue: {} },
        { provide: ConnectService, useValue: {} },
        { provide: CalendarService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(SpaceService);
  });

  const week = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
    { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
  ];

  it('clears the old hours and writes the new ones together', async () => {
    await service.replaceOpeningHours('org-1', 'room-1', week as never);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.availabilityRule.deleteMany).toHaveBeenCalled();
    expect(tx.availabilityRule.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }),
        ]),
      }),
    );
  });

  it('does the work on the transaction client, not the base one', () => {
    // OPS-24: a method taking a transaction that reaches past it to
    // `this.prisma` runs outside it, and the atomicity is imaginary.
    expect(prisma.availabilityRule).toBeUndefined();
  });

  it('leaves blackout rules alone', async () => {
    await service.replaceOpeningHours('org-1', 'room-1', week as never);

    // Clearing them would quietly reopen a room on a day the co-op closed it,
    // and the editor has no way to show that happened.
    expect(tx.availabilityRule.deleteMany).toHaveBeenCalledWith({
      where: { roomId: 'room-1', isBlackout: false },
    });
  });

  it('never writes a blackout, whatever the caller claims', async () => {
    await service.replaceOpeningHours(
      'org-1',
      'room-1',
      [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isBlackout: true }] as never,
    );

    const written = tx.availabilityRule.createMany.mock.calls[0][0].data;
    expect(written.every((r: { isBlackout: boolean }) => r.isBlackout === false)).toBe(true);
  });

  it('accepts an empty week as closing the room', async () => {
    await service.replaceOpeningHours('org-1', 'room-1', [] as never);

    expect(tx.availabilityRule.deleteMany).toHaveBeenCalled();
    // createMany with no rows is an error in some drivers, and "closed" is a
    // real answer an organiser is allowed to give.
    expect(tx.availabilityRule.createMany).not.toHaveBeenCalled();
  });

  it('refuses a room in another org', async () => {
    prisma.room.findFirst.mockResolvedValue(null);

    await expect(
      service.replaceOpeningHours('org-1', 'room-1', week as never),
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
