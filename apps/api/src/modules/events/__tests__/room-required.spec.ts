import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { RadarService } from '../../radar/radar.service';
import { ConnectService } from '../../stripe/connect.service';

/**
 * "Say which room it is in" (SPC-33).
 *
 * Charley: "make sure that a member can post their event even when there's a
 * missing room reservation."
 *
 * The rule counted reservations, which quietly turned "a published event
 * should say where it is" into "every event must hold a booking in MaybeOS".
 * Those are the same thing right up until MaybeOS is wrong about who holds
 * the booking — which the calendar migration made true for 26 upcoming
 * reservations, by filing them under whoever typed them into Google.
 *
 * The member then had the room, the co-op knew the room was hers, and the
 * product refused to let her tell anybody about it.
 */
describe('publishing an event at a co-op that asks where it is', () => {
  let service: EventsService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  const ORG = 'org-1';
  const EVENT = 'ev-1';

  const build = async (over: { requireEventRoom?: boolean; held?: number; roomId?: string | null }) => {
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ requireEventRoom: over.requireEventRoom ?? true }),
      },
      booking: { count: jest.fn().mockResolvedValue(over.held ?? 0) },
      event: { findFirst: jest.fn().mockResolvedValue({ roomId: over.roomId ?? null }) },
    };

    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: RadarService, useValue: { recordRsvp: jest.fn() } },
        { provide: ConnectService, useValue: {} },
        { provide: EmailService, useValue: { send: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(EventsService);
  };

  /** The private rule, reached the way publishing reaches it. */
  const check = () =>
    (service as unknown as {
      requireRoomIfEnforced: (orgId: string, eventId: string) => Promise<void>;
    }).requireRoomIfEnforced(ORG, EVENT);

  it('accepts an event that holds a reservation', async () => {
    await build({ held: 1 });
    await expect(check()).resolves.toBeUndefined();
  });

  it('accepts an event that names the room without holding one', async () => {
    /*
      The whole point. An event saying "the Attic" with no booking attached
      is honest about both, and an organiser can see the difference and sort
      the reservation out. Refusing it helps nobody: the room is already
      hers, and the co-op's own calendar says so.
    */
    await build({ held: 0, roomId: 'room-attic' });
    await expect(check()).resolves.toBeUndefined();
  });

  it('still refuses an event that says neither', async () => {
    // The setting has not stopped meaning anything.
    await build({ held: 0, roomId: null });
    await expect(check()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('offers both ways out when it refuses', async () => {
    await build({ held: 0, roomId: null });

    // It used to say only "add a room reservation… book the room first",
    // which was a dead end for somebody whose booking already existed.
    await expect(check()).rejects.toThrow(/Pick the room it is in, or attach the reservation/);
  });

  it('asks nothing of a co-op that has not turned the setting on', async () => {
    await build({ requireEventRoom: false, held: 0, roomId: null });

    await expect(check()).resolves.toBeUndefined();
    expect(prisma.booking.count).not.toHaveBeenCalled();
  });

  it('looks the event up inside this co-op', async () => {
    // A room named on somebody else's event must not satisfy this one
    // (SEC-04).
    await build({ held: 0, roomId: 'room-attic' });
    await check();

    expect(prisma.event.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EVENT, orgId: ORG } }),
    );
  });
});
