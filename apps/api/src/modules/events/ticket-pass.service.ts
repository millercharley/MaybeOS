import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { normalizeEmail } from '../../common/email-address';
import { decodeTicketPass, encodeTicketPass } from './ticket-pass';

/**
 * Telling a ticket buyer they bought a ticket (EVT-46).
 *
 * There was no code path that did. Eight tickets had been sold on the live
 * account — two shows of *Dog Sees God*, $11.75 each, all eight recorded
 * correctly with the money in MaybeItsFate's Stripe account — and every one of
 * those buyers was sent nothing whatsoever. The first anybody heard of it was
 * Annette Neblett writing in: "I have purchased 2 tickets and have not
 * received them yet. Please let me know what to do."
 *
 * Nothing was broken. The webhook recorded her sale, confirmed her RSVP and
 * returned 200, twice. The gap was that *being told* was never built, which is
 * the kind of hole no error rate shows: every dashboard said the feature
 * worked, because every part of it that had been written did.
 *
 * Two senders, one column:
 *
 * - the webhook sends on the way past, after its transaction commits, so a
 *   buyer has the mail before they have closed the tab;
 * - the scheduler sweeps whatever that missed, so a Postmark outage, a Lambda
 *   killed between commit and send, or a sale recorded before this existed is
 *   a delay rather than a silence.
 *
 * Both set `confirmationSentAt` and both skip anything that has it, so running
 * them over the same row twice is a no-op. That is the house pattern — the
 * door codes and the dues fees are reconciled the same way, and for the same
 * reason: a rule hung off one write is a rule every other write breaks.
 */
@Injectable()
export class TicketPassService {
  private readonly logger = new Logger(TicketPassService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    return this.config.get<string>('JWT_SECRET') ?? '';
  }

  private get webUrl(): string {
    return this.config.get<string>('WEB_URL') ?? 'https://maybeos.org';
  }

  /**
   * Where a buyer opens their pass.
   *
   * The token goes in the query string, not the path. `lib/api.ts` states the
   * rule and `safePath` enforces it on the client side: a credential in a
   * path segment ends up in Sentry transaction names and route labels, and a
   * pass token is a credential — the only one a ticket buyer will ever hold.
   */
  passUrl(eventId: string, email: string): string {
    const token = encodeTicketPass({ eventId, email }, this.secret);
    return `${this.webUrl}/pass?token=${encodeURIComponent(token)}`;
  }

  /**
   * How many seats this address holds for this event.
   *
   * Counted rather than read off a column, because there is no quantity to
   * read: Checkout is created with `quantity: 1`, so two seats are two rows.
   * Refunded tickets are excluded — a refund is the co-op taking the seat
   * back, and a pass that still shows it is a pass that gets somebody turned
   * away in front of a queue.
   *
   * Case-insensitive on the address because Stripe returns what the buyer
   * typed. Annette's two checkouts were twenty-four seconds apart and either
   * one could have carried a capital.
   */
  private async seatsFor(eventId: string, email: string): Promise<number> {
    /*
      Summed, never counted (EVT-47). One row is no longer one seat — it is
      `quantity` of them — and a `count()` here would show somebody who bought
      three in one go a pass reading "1 seat".

      The trap is that the two agree on every ticket sold before the selector
      existed, so a counter looks right against all the data there is.
    */
    const sum = await this.prisma.ticket.aggregate({
      where: {
        eventId,
        buyerEmail: { equals: email, mode: 'insensitive' },
        refundedAt: null,
      },
      _sum: { quantity: true },
    });

    return sum._sum.quantity ?? 0;
  }

  /**
   * What the pass page shows.
   *
   * One answer for every kind of failure — a forged token, a deleted event, a
   * fully refunded buyer — so the page cannot be used to ask whether a guessed
   * token named a real sale.
   */
  async viewPass(rawToken: string | undefined) {
    const decoded = decodeTicketPass(rawToken, this.secret);
    if (!decoded) return null;

    // There is no tenant in scope to scope to. This route carries no orgId and
    // no session — the people it serves bought a ticket to a public show and
    // have no account. The signed token *is* the scope: it names one event and
    // one address, and the caller cannot choose either without forging an HMAC.
    // tenant-scoping-exempt: the token names the event; no org is in scope.
    const event = await this.prisma.event.findUnique({
      where: { id: decoded.eventId },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        timezone: true,
        canceledAt: true,
        org: { select: { name: true } },
        location: { select: { name: true, address: true, city: true, state: true } },
      },
    });
    if (!event) return null;

    const seats = await this.seatsFor(decoded.eventId, decoded.email);
    if (seats === 0) return null;

    // The name on the most recent ticket. A door reads a name, and the buyer
    // is the only person who can tell it one — Stripe's `customer_details`
    // is where it came from and there is nowhere else to get it.
    const latest = await this.prisma.ticket.findFirst({
      where: {
        eventId: decoded.eventId,
        buyerEmail: { equals: decoded.email, mode: 'insensitive' },
        refundedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { buyerName: true, createdAt: true },
    });

    return {
      event: {
        title: event.title,
        /*
          Formatted here, in the event's own timezone, rather than sent as an
          instant for the browser to render. The pass is opened at a door, on
          a phone that may be on any timezone the buyer last travelled to, and
          a 7pm show that reads 4pm is worse than no time at all. SPC-08 was
          this same bug in booking email.
        */
        when: event.startTime.toLocaleString('en-US', {
          timeZone: event.timezone,
          dateStyle: 'full',
          timeStyle: 'short',
        }),
        where: placeOf(event.location),
        orgName: event.org.name,
        canceled: event.canceledAt !== null,
        /*
          Said rather than hidden. A pass for last night's show is still proof
          that somebody paid, and a buyer checking afterwards — or a host
          settling up — should see it, marked for what it is.
        */
        past: event.endTime < new Date(),
      },
      holder: {
        name: latest?.buyerName ?? null,
        // Shown back so the buyer can see which of their addresses this is,
        // and so a doorman can match it to the name they were given. It is the
        // address the token already names; the page tells them nothing they
        // did not open the page holding.
        email: decoded.email,
      },
      seats,
      boughtAt: latest?.createdAt ?? null,
    };
  }

  /**
   * Send one ticket its confirmation, and record that it went.
   *
   * Marked only on success. The host briefings (SRV-03) marked themselves sent
   * before sending and a silent Postmark failure became a message nobody got
   * and nothing retried; `sendRaw` was given a return value precisely so this
   * kind of caller could stop making that mistake.
   *
   * Returns false both for "could not send" and for "nothing to send" — the
   * caller counts sends, and a ticket already confirmed is not one.
   */
  async confirm(ticketId: string): Promise<boolean> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        eventId: true,
        buyerEmail: true,
        buyerName: true,
        amountCents: true,
        refundedAt: true,
        confirmationSentAt: true,
        event: {
          select: {
            title: true,
            slug: true,
            startTime: true,
            timezone: true,
            canceledAt: true,
            org: { select: { name: true, slug: true, replyToEmail: true } },
            location: { select: { name: true, address: true, city: true, state: true } },
          },
        },
      },
    });

    if (!ticket) return false;
    if (ticket.confirmationSentAt) return false;
    // A refund that beat the confirmation out the door. Telling somebody their
    // seat is confirmed minutes after taking their money back is worse than
    // telling them nothing, so this is marked rather than sent — it is handled,
    // and the sweep should stop looking at it.
    if (ticket.refundedAt || ticket.event.canceledAt) {
      await this.markSent(ticket.id);
      return false;
    }

    const email = normalizeEmail(ticket.buyerEmail);
    // `'unknown'` is what `recordTicketFromSession` writes when Stripe gave us
    // no address at all. It is not one, and mailing it would bounce.
    if (!email || !email.includes('@')) return false;

    const seats = await this.seatsFor(ticket.eventId, email);

    const sent = await this.email.sendTicketConfirmation(ticket.buyerEmail, {
      buyerName: ticket.buyerName,
      orgName: ticket.event.org.name,
      replyTo: ticket.event.org.replyToEmail,
      eventTitle: ticket.event.title,
      when: ticket.event.startTime.toLocaleString('en-US', {
        timeZone: ticket.event.timezone,
        dateStyle: 'full',
        timeStyle: 'short',
      }),
      where: placeOf(ticket.event.location),
      email,
      seats,
      amountCents: ticket.amountCents,
      passUrl: this.passUrl(ticket.eventId, email),
      eventUrl: `${this.webUrl}/portal/${ticket.event.org.slug}/events/${ticket.event.slug}`,
    });

    if (!sent) {
      this.logger.warn(`Ticket ${ticket.id}: confirmation not accepted by the provider`);
      return false;
    }

    await this.markSent(ticket.id);
    return true;
  }

  private async markSent(ticketId: string) {
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { confirmationSentAt: new Date() },
    });
  }

  /**
   * Everything still owed a confirmation.
   *
   * Bounded, like every other scheduled task here: this runs inside a Netlify
   * function with roughly ten seconds, and `confirmationSentAt` is the cursor
   * — each success takes a row out of the query, so the next run starts where
   * this one stopped without anything having to remember.
   *
   * Oldest first, so the backfill goes out in the order people bought.
   */
  async sweep(limit = 25): Promise<{ sent: number; failed: number }> {
    const owed = await this.prisma.ticket.findMany({
      where: { confirmationSentAt: null, refundedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    let sent = 0;
    let failed = 0;
    for (const { id } of owed) {
      try {
        if (await this.confirm(id)) sent += 1;
      } catch (err) {
        // One ticket's failure must not strand the rest — a buyer whose row
        // is somehow unmailable should not hold up everybody behind them.
        failed += 1;
        this.logger.error(`Ticket ${id}: confirmation failed — ${String(err)}`);
      }
    }

    return { sent, failed };
  }
}

/**
 * Where the event is, in one line, or null when the co-op never said.
 *
 * Null rather than a placeholder: a pass that reads "Location: TBA" at a door
 * is less use than one that does not raise the question, and the event page
 * the email links to is where the full address lives.
 */
export function placeOf(
  location: { name: string; address: string | null; city: string | null; state: string | null } | null,
): string | null {
  if (!location) return null;

  const tail = [location.address, [location.city, location.state].filter(Boolean).join(', ')]
    .filter((part) => part && part.trim())
    .join(' · ');

  return tail ? `${location.name} · ${tail}` : location.name;
}
