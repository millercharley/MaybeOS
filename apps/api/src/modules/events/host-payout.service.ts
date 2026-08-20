import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

/**
 * Paying a member who hosted an event and sold tickets (EVT-15).
 *
 * The money is already in the co-op's Stripe account — D-013 uses direct
 * charges precisely so MaybeOS never holds anybody's takings — so this is
 * arithmetic and a record, not a transfer. MaybeOS says what is owed; the
 * co-op sends it; an organiser marks it sent.
 *
 * The one number that matters is what "the ticket money" means, and it is
 * **face value only**. MaybeOS's fee and the co-op's own fee were added on top
 * of the price the host set, so a $10 ticket that cost the buyer $11.00 owes
 * the host $10. Paying out of the buyer's total would hand the host MaybeOS's
 * cut; paying out of what Stripe deposited would silently make the host bear
 * the co-op's own fee.
 */
@Injectable()
export class HostPayoutService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What this event owes its host right now.
   *
   * Recomputed rather than stored while a payout is pending, because a refund
   * the day after the event changes what is owed and a stale figure is how
   * somebody gets overpaid. Frozen only when it is marked paid — after that it
   * is a record of what actually happened.
   */
  async previewForEvent(orgId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: {
        id: true,
        title: true,
        endTime: true,
        hostId: true,
        hostRevenueShareBps: true,
        host: { select: { id: true, name: true } },
        org: { select: { hostRevenueShareBps: true } },
        payout: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const tickets = await this.prisma.ticket.findMany({
      where: { eventId: event.id },
      select: { amountCents: true, platformFeeCents: true, orgFeeCents: true, refundedAt: true },
    });

    const sold = tickets.filter((t) => !t.refundedAt);
    const grossCents = sold.reduce(
      (n, t) => n + (t.amountCents - t.platformFeeCents - t.orgFeeCents),
      0,
    );

    // The event's own share wins over the co-op's default; null means "use the
    // default" rather than a copy of it.
    const shareBps = event.hostRevenueShareBps ?? event.org.hostRevenueShareBps;

    return {
      eventId: event.id,
      title: event.title,
      endTime: event.endTime,
      host: event.host,
      hasEnded: event.endTime < new Date(),
      grossCents,
      shareBps,
      amountCents: shareOf(grossCents, shareBps),
      ticketCount: sold.length,
      refundedCount: tickets.length - sold.length,
      payout: event.payout,
    };
  }

  /** Every event with money owed or paid, for an organiser working through them. */
  async listForOrg(orgId: string) {
    const events = await this.prisma.event.findMany({
      where: { orgId, hostId: { not: null }, tickets: { some: {} } },
      orderBy: { endTime: 'desc' },
      select: { id: true },
    });

    return Promise.all(events.map((e) => this.previewForEvent(orgId, e.id)));
  }

  /** What this member is owed, across their own events. */
  async listForHost(orgId: string, userId: string) {
    const events = await this.prisma.event.findMany({
      where: { orgId, hostId: userId, tickets: { some: {} } },
      orderBy: { endTime: 'desc' },
      select: { id: true },
    });

    return Promise.all(events.map((e) => this.previewForEvent(orgId, e.id)));
  }

  /**
   * Record that the host has been paid.
   *
   * **After the event, not before.** Tickets can still be sold and refunded
   * right up to the door, so paying out early means paying out a number that
   * is not final yet.
   *
   * The figures are frozen at this moment. A refund next week changes what the
   * co-op holds; it does not change what was handed over on the day, and a
   * payout record that quietly rewrote itself would make the co-op's books
   * disagree with its bank.
   */
  async markPaid(orgId: string, eventId: string, paidById: string, note?: string) {
    const preview = await this.previewForEvent(orgId, eventId);

    if (preview.payout?.status === 'PAID') {
      throw new BadRequestException('This host has already been paid for that event');
    }
    if (!preview.hasEnded) {
      throw new BadRequestException(
        'This event has not finished yet. Tickets can still be sold or refunded, so what is owed is not final.',
      );
    }
    if (!preview.host) {
      throw new BadRequestException('That event has no host to pay');
    }
    if (preview.amountCents <= 0) {
      throw new BadRequestException('There is nothing to pay out for that event');
    }

    return this.prisma.hostPayout.upsert({
      where: { eventId },
      create: {
        orgId,
        eventId,
        hostUserId: preview.host.id,
        grossCents: preview.grossCents,
        shareBps: preview.shareBps,
        amountCents: preview.amountCents,
        ticketCount: preview.ticketCount,
        refundedCount: preview.refundedCount,
        status: 'PAID',
        paidAt: new Date(),
        paidById,
        note: note?.trim() || null,
      },
      update: {
        grossCents: preview.grossCents,
        shareBps: preview.shareBps,
        amountCents: preview.amountCents,
        ticketCount: preview.ticketCount,
        refundedCount: preview.refundedCount,
        status: 'PAID',
        paidAt: new Date(),
        paidById,
        note: note?.trim() || null,
      },
    });
  }

  /**
   * Undo a payout marked in error.
   *
   * Cancelled rather than deleted, and it keeps its figures: "we said we paid
   * this and we had not" is a thing that happened, and the row is the only
   * place it is written down.
   */
  async cancel(orgId: string, eventId: string) {
    const payout = await this.prisma.hostPayout.findFirst({
      where: { eventId, orgId },
      select: { id: true },
    });
    if (!payout) throw new NotFoundException('No payout recorded for that event');

    return this.prisma.hostPayout.update({
      where: { id: payout.id },
      data: { status: 'CANCELLED', paidAt: null },
    });
  }

  /** The co-op's default share, and the events that override it. */
  async setOrgShare(orgId: string, shareBps: number) {
    assertShare(shareBps);
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { hostRevenueShareBps: shareBps },
    });
    return { hostRevenueShareBps: shareBps };
  }

  async setEventShare(orgId: string, eventId: string, shareBps: number | null) {
    if (shareBps !== null) assertShare(shareBps);

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    await this.prisma.event.update({
      where: { id: event.id },
      data: { hostRevenueShareBps: shareBps },
    });
    return { hostRevenueShareBps: shareBps };
  }
}

/**
 * A share of an amount, in integer cents.
 *
 * Rounded down, so the co-op is never short. A cent rounded the other way on
 * every event is a co-op that slowly pays out more than it took.
 */
export function shareOf(grossCents: number, shareBps: number): number {
  return Math.floor((grossCents * shareBps) / 10_000);
}

function assertShare(shareBps: number) {
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > 10_000) {
    throw new BadRequestException('A share is between 0% and 100%');
  }
}
