import { Test } from '@nestjs/testing';
import { SpaceService } from '../space.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { EventsService } from '../../events/events.service';
import { ConnectService } from '../../stripe/connect.service';
import { CalendarService } from '../../calendar/calendar.service';
import { StorageService } from '../../storage/storage.service';
import { ConfigService } from '@nestjs/config';

/**
 * Connecting a calendar must not publish the organiser's email address.
 *
 * `GET /orgs/:orgId/rooms` is open to every member of the org, and SPC-07
 * added the address of whichever organiser authorised Google to the room
 * record so the admin page could say which account is connected. Returned
 * unfiltered, that turns one organiser's private setup step into a directory
 * entry for the whole co-op.
 */
describe('SpaceService — who sees the connected Google account', () => {
  let service: SpaceService;

  const ROOM = {
    id: 'room-1',
    name: 'Attic',
    googleCalendarId: 'attic@group.calendar.google.com',
    googleCalendarName: 'Attic',
    googleAccountEmail: 'maya@personal.example',
    googleConnectedAt: new Date('2026-09-02T00:00:00Z'),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SpaceService,
        {
          provide: PrismaService,
          useValue: { room: { findMany: jest.fn().mockResolvedValue([{ ...ROOM }]) } },
        },
        { provide: EmailService, useValue: {} },
        { provide: EventsService, useValue: {} },
        { provide: ConnectService, useValue: {} },
        {
          provide: StorageService,
          useValue: { signedAttachmentUrls: jest.fn().mockResolvedValue(new Map()) },
        },
        { provide: CalendarService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    service = moduleRef.get(SpaceService);
  });

  it('does not tell a member which account connected the room', async () => {
    const [room] = await service.listRooms('org-1');

    expect(room).not.toHaveProperty('googleAccountEmail');
    expect(room).not.toHaveProperty('googleConnectedAt');
  });

  it('still tells a member the room has a calendar', async () => {
    // Which calendar a room writes to is not private; who authorised it is.
    const [room] = await service.listRooms('org-1');

    expect(room).toMatchObject({
      googleCalendarId: 'attic@group.calendar.google.com',
      googleCalendarName: 'Attic',
    });
  });

  it('tells staff who connected it', async () => {
    const [room] = await service.listRooms('org-1', true);

    expect(room).toMatchObject({ googleAccountEmail: 'maya@personal.example' });
  });
});
