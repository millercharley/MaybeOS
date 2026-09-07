import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CalendarService } from '../calendar.service';
import { PrismaService } from '../../../config/prisma.service';
import { encodeState } from '../../../common/oauth-state';

/**
 * Who may connect a Google account to a room (SEC-14).
 *
 * The callback is unauthenticated by necessity — Google redirects a browser,
 * so there is no Authorization header — and `state` was
 * `JSON.stringify({ orgId, roomId })`, unsigned. The client id is public, so
 * anybody could build the consent URL themselves, authorise with **their own**
 * Google account, and name **another co-op's room** in the state. The callback
 * wrote the tokens straight onto that room by bare id, checking neither the
 * signature nor that the room belonged to the org beside it.
 *
 * The result would have been a co-op's room bookings — who booked, what for,
 * when — syncing into a calendar somebody else controls.
 *
 * The Stripe Connect flow next door had signed its state since PAY-05. This is
 * the same signer, now shared.
 */
describe('CalendarService — connecting a room to a Google account', () => {
  const SECRET = 'test-secret';
  const ENV: Record<string, string> = {
    JWT_SECRET: SECRET,
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REDIRECT_URI: 'https://maybeos.org/api/calendar/oauth/callback',
  };

  const build = async (room: { id: string } | null) => {
    const prisma = {
      room: { findFirst: jest.fn().mockResolvedValue(room), update: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (k: string) => ENV[k] } },
      ],
    }).compile();
    return { service: moduleRef.get(CalendarService), prisma };
  };

  describe('issuing the consent URL', () => {
    it('refuses a room that is not this co-op’s', async () => {
      // SEC-04, at the point where the state is minted rather than after the
      // browser has already left for Google.
      const { service, prisma } = await build(null);

      await expect(service.getAuthUrl('org-1', 'room-elsewhere', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.room.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'room-elsewhere', orgId: 'org-1' } }),
      );
    });

    it('signs the state rather than sending it in the clear', async () => {
      const { service } = await build({ id: 'room-1' });

      const url = await service.getAuthUrl('org-1', 'room-1', 'user-1');
      const state = decodeURIComponent(new URL(url).searchParams.get('state') ?? '');

      // Two parts: payload and signature. The old shape was readable JSON.
      expect(state).toMatch(/^[\w-]+\.[\w-]+$/);
      expect(state).not.toContain('room-1');
      expect(() => JSON.parse(state)).toThrow();
    });
  });

  describe('the callback', () => {
    it('refuses a state nobody signed', async () => {
      // The attack in one line: the old code would have parsed this happily.
      const { service, prisma } = await build({ id: 'room-1' });

      await expect(
        service.handleCallback('code', JSON.stringify({ orgId: 'org-1', roomId: 'victim-room' })),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.room.update).not.toHaveBeenCalled();
    });

    it('refuses a state signed with the wrong secret', async () => {
      const { service, prisma } = await build({ id: 'room-1' });
      const forged = encodeState(
        { orgId: 'org-1', roomId: 'victim-room', userId: 'attacker', issuedAt: Date.now() },
        'not-the-secret',
      );

      await expect(service.handleCallback('code', forged)).rejects.toThrow(BadRequestException);
      expect(prisma.room.update).not.toHaveBeenCalled();
    });

    it('refuses an expired one', async () => {
      const { service } = await build({ id: 'room-1' });
      const stale = encodeState(
        {
          orgId: 'org-1',
          roomId: 'room-1',
          userId: 'user-1',
          issuedAt: Date.now() - 60 * 60 * 1000,
        },
        SECRET,
      );

      await expect(service.handleCallback('code', stale)).rejects.toThrow(BadRequestException);
    });

    it('refuses a signed state whose room is not in its org', async () => {
      // A signature proves the state came from us, not that the pair inside it
      // still belongs together — a room can move or be deleted mid-flow.
      const { service, prisma } = await build(null);
      const valid = encodeState(
        { orgId: 'org-1', roomId: 'room-1', userId: 'user-1', issuedAt: Date.now() },
        SECRET,
      );

      await expect(service.handleCallback('code', valid)).rejects.toThrow(NotFoundException);
      expect(prisma.room.update).not.toHaveBeenCalled();
    });
  });
});
