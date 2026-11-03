import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SpaceService } from '../space.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * Adding somebody to a room reservation (SPC-37).
 *
 * Charley: "As a member, I want to add a co-host to a room reservation."
 */
describe('sharing a reservation', () => {
  let service: SpaceService;
  let prisma: any;

  const ORG = 'org-1';
  const OWNER = 'u-owner';
  const CO_HOST = 'u-cohost';
  const STRANGER = 'u-stranger';

  const booking = (over: Record<string, unknown> = {}) => ({
    id: 'booking-1',
    userId: OWNER,
    isCoopHold: false,
    coHosts: [],
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      booking: { findFirst: jest.fn().mockResolvedValue(booking()) },
      bookingCoHost: { create: jest.fn(), deleteMany: jest.fn() },
      userOrg: { findUnique: jest.fn().mockResolvedValue({ userId: CO_HOST }) },
    };

    const module = await Test.createTestingModule({
      providers: [SpaceService, { provide: PrismaService, useValue: prisma }],
    })
      .overrideProvider(SpaceService)
      .useFactory({
        factory: (p: PrismaService) => new (SpaceService as any)(p),
        inject: [PrismaService],
      })
      .compile();

    service = module.get(SpaceService);
  });

  const add = (actor = { userId: OWNER, isStaff: false }) =>
    service.addBookingCoHost(ORG, 'booking-1', CO_HOST, actor);

  describe('who may say', () => {
    it('lets whoever booked the room', async () => {
      await add();

      expect(prisma.bookingCoHost.create).toHaveBeenCalledWith({
        data: { bookingId: 'booking-1', userId: CO_HOST, addedById: OWNER },
      });
    });

    it('lets an organiser', async () => {
      await add({ userId: STRANGER, isStaff: true });

      expect(prisma.bookingCoHost.create).toHaveBeenCalled();
    });

    it('refuses a stranger', async () => {
      await expect(add({ userId: STRANGER, isStaff: false })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.bookingCoHost.create).not.toHaveBeenCalled();
    });

    it('refuses a co-host, who may change it but not decide who else is on it', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        booking({ coHosts: [{ userId: CO_HOST }] }),
      );

      await expect(
        service.addBookingCoHost(ORG, 'booking-1', STRANGER, {
          userId: CO_HOST,
          isStaff: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('what it refuses', () => {
    it('looks the reservation up through its room’s org', async () => {
      // The org in the URL has to be checked against the booking's own, which
      // is the hole `loadBookingForActor` was written to close (D-009).
      await add();

      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'booking-1', room: { orgId: ORG } } }),
      );
    });

    it('404s on a reservation that is not in this co-op', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      await expect(add()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a hold the co-op made, which is nobody’s reservation', async () => {
      // 3,017 of them (SPC-23). There is no "us" to add anybody to.
      prisma.booking.findFirst.mockResolvedValue(booking({ isCoopHold: true }));

      await expect(add()).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.bookingCoHost.create).not.toHaveBeenCalled();
    });

    it('refuses somebody outside the co-op', async () => {
      prisma.userOrg.findUnique.mockResolvedValue(null);

      await expect(add()).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.bookingCoHost.create).not.toHaveBeenCalled();
    });

    it('scopes the roster lookup to this co-op', async () => {
      await add();

      expect(prisma.userOrg.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId_orgId: { userId: CO_HOST, orgId: ORG } } }),
      );
    });

    it('refuses the person whose reservation it is', async () => {
      await expect(
        service.addBookingCoHost(ORG, 'booking-1', OWNER, { userId: OWNER, isStaff: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses somebody already on it', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        booking({ coHosts: [{ userId: CO_HOST }] }),
      );

      await expect(add()).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('taking somebody off', () => {
    it('is the owner’s call', async () => {
      await service.removeBookingCoHost(ORG, 'booking-1', CO_HOST, {
        userId: OWNER,
        isStaff: false,
      });

      expect(prisma.bookingCoHost.deleteMany).toHaveBeenCalledWith({
        where: { bookingId: 'booking-1', userId: CO_HOST },
      });
    });

    it('is silent when they were not on it', async () => {
      // `deleteMany`, not `delete`: removing somebody twice is not an error
      // worth showing anybody.
      await expect(
        service.removeBookingCoHost(ORG, 'booking-1', STRANGER, {
          userId: OWNER,
          isStaff: false,
        }),
      ).resolves.toEqual({ removed: true });
    });

    it('is not a co-host’s call', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        booking({ coHosts: [{ userId: CO_HOST }] }),
      );

      // Otherwise a co-host could remove the person who added them.
      await expect(
        service.removeBookingCoHost(ORG, 'booking-1', CO_HOST, {
          userId: CO_HOST,
          isStaff: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.bookingCoHost.deleteMany).not.toHaveBeenCalled();
    });
  });
});
