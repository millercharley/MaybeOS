import { Test } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SpaceService } from '../space.service';
import { CreateRoomDto } from '../dto/create-room.dto';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';
import { EventsService } from '../../events/events.service';
import { ConnectService } from '../../stripe/connect.service';
import { CalendarService } from '../../calendar/calendar.service';

/**
 * A room's charging switch has to survive the trip from the form.
 *
 * SPC-06 made charging two deliberate steps — a switch and a rate — so that
 * typing what a room is worth cannot start billing members. The rate was
 * accepted by `CreateRoomDto` and **the switch was not**, and the API
 * validates against a whitelist.
 *
 * The form always sends both, so this did not degrade the feature: it refused
 * every room create and update outright with `property chargeForBooking should
 * not exist`. A co-op that had shipped room charging therefore had no rooms at
 * all — which is exactly what MaybeItsFate saw on 2026-08-19, its Rooms page
 * reading "No rooms yet" under a form that could not succeed.
 *
 * Even had the request been accepted, neither `createRoom` nor `updateRoom`
 * copied the field, so charging could never have been switched on.
 */
describe('a room’s charging fields', () => {
  describe('the DTO', () => {
    it('accepts the switch the form sends', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        name: '2nd Floor Salon',
        chargeForBooking: true,
        hourlyRate: 4500,
      });

      expect(await validate(dto)).toHaveLength(0);
    });

    it('still rejects a switch that is not a boolean', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        name: '2nd Floor Salon',
        chargeForBooking: 'yes',
      });

      expect(await validate(dto)).not.toHaveLength(0);
    });
  });

  describe('persisting it', () => {
    let service: SpaceService;
    let prisma: { room: Record<string, jest.Mock> };

    beforeEach(async () => {
      prisma = {
        room: {
          create: jest.fn().mockResolvedValue({ id: 'room-1' }),
          update: jest.fn().mockResolvedValue({ id: 'room-1' }),
          findFirst: jest.fn().mockResolvedValue({ id: 'room-1', orgId: 'org-1' }),
        },
      };

      const module = await Test.createTestingModule({
        providers: [
          SpaceService,
          { provide: PrismaService, useValue: prisma },
          // None of these are reached: creating a room touches no email, no
          // calendar and no Stripe.
          { provide: EmailService, useValue: { send: jest.fn(), sendBookingEmail: jest.fn() } },
          { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
          { provide: EventsService, useValue: { syncWithBooking: jest.fn() } },
          { provide: ConnectService, useValue: { refundBooking: jest.fn() } },
          {
            provide: CalendarService,
            useValue: {
              syncBooking: jest.fn(),
              busyConflictForRoom: jest.fn().mockResolvedValue({ busy: false }),
            },
          },
        ],
      }).compile();

      service = module.get<SpaceService>(SpaceService);
    });

    it('writes the switch when a room is created', async () => {
      await service.createRoom('org-1', {
        name: '2nd Floor Salon',
        chargeForBooking: true,
        hourlyRate: 4500,
      } as CreateRoomDto);

      expect(prisma.room.create.mock.calls[0][0].data).toMatchObject({
        chargeForBooking: true,
        hourlyRate: 4500,
      });
    });

    it('defaults to free when nobody asked to charge', async () => {
      // Every room that existed before charging was built expects to stay free.
      await service.createRoom('org-1', { name: 'Back Room' } as CreateRoomDto);

      expect(prisma.room.create.mock.calls[0][0].data.chargeForBooking).toBe(false);
    });

    it('can switch charging off again', async () => {
      // `false` must reach the update, not be skipped as falsy — otherwise a
      // co-op can start charging and never stop.
      await service.updateRoom('org-1', 'room-1', { chargeForBooking: false });

      expect(prisma.room.update.mock.calls[0][0].data).toMatchObject({
        chargeForBooking: false,
      });
    });

    it('leaves charging alone when an update does not mention it', async () => {
      await service.updateRoom('org-1', 'room-1', { name: 'Renamed' });

      expect(prisma.room.update.mock.calls[0][0].data).not.toHaveProperty('chargeForBooking');
    });
  });
});
