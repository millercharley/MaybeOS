import { Injectable, Logger } from '@nestjs/common';
import { escapeHtml } from '../../common/escape-html';
import { ConfigService } from '@nestjs/config';
import * as postmark from 'postmark';

export interface BookingEmailData {
  memberName: string;
  roomName: string;
  orgName: string;
  /** Already formatted for display — the service does no timezone work. */
  when: string;
  title: string;
  /** Where the member manages this booking. Must be a page that exists. */
  /**
   * Where to go and book something. The room list.
   *
   * Distinct from `bookingsUrl` because these emails ask for two different
   * things: "find another time" wants the rooms, "reschedule or cancel" wants
   * the booking. One URL served both and pointed at the rooms, so the button
   * offering to cancel a booking opened a page with no cancel on it.
   */
  manageUrl: string;
  /** The member's own bookings, where reschedule and cancel live. */
  bookingsUrl: string;
}

/**
 * Where one person's mail goes (MEM-19).
 *
 * A co-op moving in has people billed at one address and signed up to its
 * forum at another, and the two have been the same person all along. Both
 * travel together so that nothing has to choose — getting it wrong is
 * invisible until somebody says they never received a sign-in link.
 */
export interface Addresses {
  primary: string;
  also?: string | null;
}

export function addresses(to: string | Addresses): { primary: string; also?: string } {
  if (typeof to === 'string') return { primary: to };

  const primary = to.primary.trim();
  const also = to.also?.trim();

  // Never copy somebody on their own mail.
  return also && also.toLowerCase() !== primary.toLowerCase() ? { primary, also } : { primary };
}

/**
 * A date window, spelled once (MEM-25).
 *
 * The SDK types these as `fromDate` and puts them on the query string exactly
 * as given, while Postmark's documentation calls them `fromdate`. Sending both
 * spellings to cover either reading was not the free insurance it looked like:
 * Postmark lowercases parameter names, so the two collapsed into one parameter
 * carrying two values, and a doubled value is not a parseable date —
 * "Parameter 'fromdate' should be date/time value", on every audit.
 *
 * That error is also the answer. Postmark reported the name it had normalised
 * ours to, which is only possible if it reads the camelCase spelling, so one
 * is all it ever needed.
 */
function dateWindow(fromDate: string, toDate: string): Record<string, string> {
  return { fromDate, toDate };
}

/**
 * A room request waiting on an organiser (SPC-32).
 *
 * The one email in this file addressed to the people who run the co-op rather
 * than to the member. A request that needs approving told the member it had
 * been received and told nobody who could approve it.
 */
export interface BookingApprovalData {
  organiserName: string;
  orgName: string;
  memberName: string;
  roomName: string;
  title: string;
  /** Already formatted in the co-op's own timezone by the caller. */
  when: string;
  /** The queue, not the booking: an organiser usually has more than one. */
  reviewUrl: string;
  /** How many are waiting in total, so the email says whether this is a pile. */
  waiting: number;
}

/** One outbound message as Postmark reports it, reduced to what MaybeOS reads. */
export interface ProviderMessage {
  recipients: string[];
  subject: string;
  tag: string | null;
  receivedAt: string;
  status: string | null;
}

/** One bounce as Postmark reports it. */
export interface ProviderBounce {
  email: string;
  type: string;
  bouncedAt: string;
}

export interface EmailJobData {
  type:
    | 'magic-link'
    | 'event-reminder'
    | 'renewal-reminder'
    | 'dunning'
    | 'invite'
    | 'waitlist-promoted'
    | 'booking-received'
    | 'booking-confirmed'
    | 'booking-rejected'
    | 'booking-canceled'
    | 'booking-rescheduled'
    | 'door-code'
    | 'radar-digest'
    | 'recap'
    | 'recap-ready'
    | 'booking-awaiting-approval';
  to: string;
  data: Record<string, any>;
}

/** One gathering as the Radar digest prints it (RDR-01). */
export interface RadarDigestEvent {
  title: string;
  /** Already formatted in the event's own timezone by the caller. */
  when: string;
  where: string | null;
  description: string | null;
  /** The member's interests that earned it a place — printed as the reason. */
  matched: string[];
  /** Of those, the ones the member said out loud rather than MaybeOS inferring. */
  declaredMatches: string[];
  /**
   * Whether a seat costs money.
   *
   * A ticketed event has no RSVP button on its page — it has Buy — so a
   * button promising "RSVP" would land the member somewhere that does not
   * offer it. The word has to match what they will find.
   */
  ticketed: boolean;
  rsvpUrl: string;
}

/** What the monthly recap prints (RCP-01). Mirrors `RecapFigures`. */
export interface RecapEmailData {
  memberName: string;
  orgName: string;
  monthLabel: string;
  /** The organiser's own words, at the top. Usually the part people read. */
  note: string | null;
  /** A paragraph composed from the frozen figures, where the co-op has it. */
  composed: string | null;
  /** Whether this co-op shows its members money at all. */
  showMoney: boolean;
  figures: {
    members: { total: number; joined: number; imported: number };
    events: { hosted: number; checkedIn: number; eventsWithDoor: number; expected: number };
    money: { month: { totalCents: number }; year: { totalCents: number } };
    service: { hours: number; members: number; valueCents: number | null } | null;
    impact: { category: string; average: number; respondents: number }[];
  };
  unsubscribeUrl: string;
}

export interface RecapReadyData {
  organiserName: string;
  orgName: string;
  monthLabel: string;
  reviewUrl: string;
}

export interface RadarDigestData {
  memberName: string;
  orgName: string;
  /** Strongest match first; the subject line names it. Never empty. */
  events: RadarDigestEvent[];
  unsubscribeUrl: string;
  interestsUrl: string;
}

/**
 * Sends transactional email directly via Postmark.
 *
 * This used to enqueue jobs onto a BullMQ/Redis queue consumed by a
 * separate worker process. That model doesn't fit the serverless
 * deployment (D-007): Netlify Functions can't host a persistent worker,
 * so the queue would have had nothing draining it — and every cold start
 * still paid for an ioredis client retrying against a Redis that isn't
 * there.
 *
 * Sends are deliberately fire-and-forget from the caller's perspective:
 * a failure is logged, never thrown. Email is a side effect of flows like
 * registration and invitation, and a Postmark outage should not fail the
 * user's actual request. The tradeoff is losing the queue's automatic
 * retries — worth revisiting if a durable queue is reintroduced later.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private client: postmark.ServerClient | null = null;
  private readonly emailFrom: string;

  constructor(private readonly configService: ConfigService) {
    const token = this.configService.get<string>('POSTMARK_API_TOKEN');
    // No fallback: EMAIL_FROM has a validated default in app.module, and a
    // second one here meant two different addresses could be authoritative
    // depending on which file you read.
    this.emailFrom = this.configService.get<string>('EMAIL_FROM') as string;

    if (token) {
      this.client = new postmark.ServerClient(token);
      this.logger.log('Postmark client initialized');
    } else {
      this.logger.warn(
        'POSTMARK_API_TOKEN not configured – emails will be logged only (dev mode)',
      );
    }
  }

  // ─── Public API (signatures unchanged from the queued version) ───

  async sendDoorCode(
    to: string,
    data: { memberName: string; orgName: string; pin: string; profileUrl: string },
  ) {
    await this.send({ type: 'door-code', to, data });
  }

  async sendMagicLink(to: string, link: string) {
    await this.send({ type: 'magic-link', to, data: { link } });
  }

  async sendEventReminder(
    to: string,
    eventTitle: string,
    eventDate: string,
    eventUrl: string,
  ) {
    await this.send({
      type: 'event-reminder',
      to,
      data: { eventTitle, eventDate, eventUrl },
    });
  }

  async sendRenewalReminder(to: string, memberName: string, dueDate: string) {
    await this.send({ type: 'renewal-reminder', to, data: { memberName, dueDate } });
  }

  async sendDunning(to: string, memberName: string, orgName: string) {
    await this.send({ type: 'dunning', to, data: { memberName, orgName } });
  }

  // ─── Room bookings ───────────────────────────────────────────
  //
  // Members previously got no notification of anything: not that a booking was
  // received, approved, rejected or cancelled. SpaceOS never called this
  // service at all.

  async sendBookingReceived(to: string, d: BookingEmailData) {
    await this.send({ type: 'booking-received', to, data: d });
  }

  async sendBookingConfirmed(to: string, d: BookingEmailData) {
    await this.send({ type: 'booking-confirmed', to, data: d });
  }

  async sendBookingRejected(to: string, d: BookingEmailData) {
    await this.send({ type: 'booking-rejected', to, data: d });
  }

  async sendBookingCanceled(to: string, d: BookingEmailData) {
    await this.send({ type: 'booking-canceled', to, data: d });
  }

  async sendBookingRescheduled(to: string, d: BookingEmailData & { needsApproval: boolean }) {
    await this.send({ type: 'booking-rescheduled', to, data: d });
  }

  /**
   * A place opened up and this member has it (EVT-16).
   *
   * The promotion itself has worked since EVT-02 — cancel a confirmed RSVP and
   * the first waitlisted member is moved up, in order — and **nothing told
   * them**. A waitlist nobody is told about is a waitlist that does not work,
   * and it fails as an empty seat rather than as an error: a no-show to the
   * organiser, a waitlist that never moved to the member.
   */
  async sendWaitlistPromoted(
    to: string,
    d: { memberName: string; orgName: string; eventTitle: string; when: string; eventUrl: string },
  ) {
    await this.send({ type: 'waitlist-promoted', to, data: d });
  }

  /**
   * The weekly Radar digest (RDR-01): the gatherings a member would want to
   * know about, in the co-op's name.
   *
   * The subject is the format Charley specified — `[org] radar: [event]` —
   * carrying the strongest match, with the rest counted after it. An email
   * naming a real thing gets opened; "your weekly roundup" does not.
   */
  async sendRadarDigest(to: string, d: RadarDigestData) {
    if (d.events.length === 0) return;
    await this.send({ type: 'radar-digest', to, data: d });
  }

  /** The monthly recap, to a member (RCP-01). */
  async sendRecap(to: string, d: RecapEmailData) {
    await this.send({ type: 'recap', to, data: d });
  }

  /** The nudge to an organiser that a draft is waiting (RCP-01). */
  async sendRecapReady(to: string, d: RecapReadyData) {
    await this.send({ type: 'recap-ready', to, data: d });
  }

  async sendInvite(to: string, orgName: string, inviteUrl: string, inviterName?: string) {
    await this.send({
      type: 'invite',
      to,
      data: { orgName, inviteUrl, inviterName },
    });
  }

  // ─── Delivery ────────────────────────────────────────────────

  /**
   * Send an email whose subject and body have already been composed.
   *
   * Every other method here builds its content from a hardcoded template,
   * which is right for mail MaybeOS writes. Belonging Support's mail is
   * written by the co-op (PRD §5.3), so it arrives rendered and validated
   * from `belonging-emails.ts` — this exists so that admin-authored content
   * does not need a case added to a switch statement it can never be part of.
   *
   * Same fire-and-forget posture as everything else: a failure is logged,
   * never thrown. A Postmark outage must not roll back the buddy invitation
   * the email was announcing.
   */
  /**
   * Returns whether it actually went.
   *
   * Still never throws — every caller here sends email as a side effect of
   * something more important, and a failed notification must not roll back
   * the thing it was notifying about. But swallowing the failure *and*
   * reporting nothing meant a caller that needs to know could not find out:
   * the host briefings (SRV-03) mark themselves as sent before sending, so a
   * silent Postmark failure was a message nobody received and nothing
   * retried. Existing callers ignore the return and are unaffected.
   */
  async sendRaw(
    to: string | Addresses,
    subject: string,
    htmlBody: string,
    /**
     * Postmark's tag, for mail that will later be audited (MEM-25).
     *
     * Without one, asking the provider "which of these four hundred people did
     * you actually accept a sign-in link for" is a question about subject
     * lines. With one it is a lookup.
     */
    tag?: string,
  ): Promise<boolean> {
    const { primary, also } = addresses(to);
    if (!this.client) {
      this.logger.log(`[DEV] Would send email to=${primary} subject="${subject}"\n${htmlBody}`);
      // True in development: nothing failed, there is simply no provider.
      return true;
    }

    try {
      await this.client.sendEmail({
        From: this.emailFrom,
        To: primary,
        // Copied rather than sent twice: one message, arriving at both
        // addresses the same person reads, so a reply is one conversation
        // and a sign-in link is one link (MEM-19).
        ...(also && { Cc: also }),
        Subject: subject,
        HtmlBody: htmlBody,
        ...(tag && { Tag: tag }),
      });
      this.logger.log(`Email sent successfully to ${primary} (raw)`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send email to ${primary}: ${message}`);
      return false;
    }
  }

  /**
   * Is there a provider at all?
   *
   * The audit has to be able to say "I cannot check" out loud. In development
   * there is no Postmark, and an audit that silently reported every member as
   * never-reached would be worse than one that declines.
   */
  get hasProvider(): boolean {
    return this.client !== null;
  }

  /**
   * What Postmark has a record of accepting, for the audit (MEM-25).
   *
   * Paged rather than fetched whole: a page is five hundred messages, which is
   * Postmark's own ceiling, and an org's send window can hold more than that
   * once the rest of its mail is in there too. The caller decides when to stop
   * — it is the one holding the request deadline.
   *
   * `Recipients` rather than `To` deliberately: it includes the Cc, which is
   * where a member's alternate address ends up (MEM-19).
   */
  async outboundMessages(opts: {
    fromDate: string;
    toDate: string;
    count: number;
    offset: number;
    tag?: string;
  }): Promise<{ total: number; messages: ProviderMessage[] } | null> {
    if (!this.client) return null;

    const page = await this.client.getOutboundMessages({
      count: opts.count,
      offset: opts.offset,
      ...dateWindow(opts.fromDate, opts.toDate),
      ...(opts.tag && { tag: opts.tag }),
    });

    return {
      // Postmark types TotalCount as a string here and returns a number.
      total: Number(page.TotalCount ?? 0),
      messages: (page.Messages ?? []).map((m) => ({
        recipients: m.Recipients ?? [],
        subject: m.Subject ?? '',
        tag: m.Tag ?? null,
        receivedAt: m.ReceivedAt,
        // Sent, Queued or Processed. A queued message is in this list and has
        // not gone anywhere, which is the same trap as trusting our own mark.
        status: m.Status ?? null,
      })),
    };
  }

  /**
   * Bounces in a window, for the audit (MEM-25).
   *
   * Separate from the message list because Postmark keeps them separately, and
   * for a reason that matters here: a bounced message still counts as accepted
   * and still appears in the outbound list. Delivery and arrival are different
   * questions, and only the bounce answers the second one.
   */
  async bounces(opts: {
    fromDate: string;
    toDate: string;
    count: number;
    offset: number;
  }): Promise<{ total: number; bounces: ProviderBounce[] } | null> {
    if (!this.client) return null;

    const page = await this.client.getBounces({
      count: opts.count,
      offset: opts.offset,
      ...dateWindow(opts.fromDate, opts.toDate),
    });

    return {
      total: Number(page.TotalCount ?? 0),
      bounces: (page.Bounces ?? []).map((b) => ({
        email: b.Email,
        type: b.Type,
        bouncedAt: b.BouncedAt,
      })),
    };
  }

  /** Tell an organiser a room request is waiting on them (SPC-32). */
  async sendBookingAwaitingApproval(to: string, d: BookingApprovalData) {
    await this.send({ type: 'booking-awaiting-approval', to, data: d });
  }

  private async send({ type, to, data }: EmailJobData): Promise<void> {
    const { subject, htmlBody } = this.buildEmail(type, data);

    if (!this.client) {
      this.logger.log(
        `[DEV] Would send email to=${to} subject="${subject}"\n${htmlBody}`,
      );
      return;
    }

    try {
      await this.client.sendEmail({
        From: this.emailFrom,
        To: to,
        Subject: subject,
        HtmlBody: htmlBody,
      });

      this.logger.log(`Email sent successfully to ${to} (type=${type})`);
    } catch (err) {
      // Swallowed deliberately — see the class doc comment. The caller's
      // operation (registration, invite, etc.) must still succeed.
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `Failed to send email to ${to} (type=${type}): ${message}`,
        stack,
      );
    }
  }

  /**
   * Build the subject and HTML body for each email type.
   */
  private buildEmail(
    type: EmailJobData['type'],
    data: Record<string, any>,
  ): { subject: string; htmlBody: string } {
    switch (type) {
      case 'door-code':
        return {
          subject: `Your door code for ${escapeHtml(data.orgName)}`,
          // Escaped, unlike its neighbours: a member's own name goes into this
          // one, and a name is not markup. The others interpolate raw and
          // should be looked at, which is not this change.
          htmlBody: `
            <h1>Your door code</h1>
            <p>Hello ${escapeHtml(data.memberName)},</p>
            <p>This is the code to open the door at ${escapeHtml(data.orgName)}:</p>
            <p style="font-family:Georgia,'Times New Roman',serif;font-size:32px;letter-spacing:6px;font-weight:700;margin:24px 0;">${escapeHtml(data.pin)}</p>
            <p>Five letters, typed on the keypad. It is yours alone — please do not pass it on.</p>
            <p>If you forget it, it is always on your profile:
              <a href="${escapeHtml(data.profileUrl)}">${escapeHtml(data.profileUrl)}</a>
            </p>
          `,
        };

      case 'radar-digest': {
        const d = data as RadarDigestData;
        const [first, ...rest] = d.events;
        const subject =
          rest.length > 0
            ? `${d.orgName} radar: ${first.title} (and ${rest.length} more)`
            : `${d.orgName} radar: ${first.title}`;

        // Escaped throughout: every value here was typed by a host or a
        // member — an event title, a description, somebody's name — and none
        // of it is markup.
        const cards = d.events
          .map(
            (event) => `
            <div style="border:1px solid #ddd7cc;border-radius:12px;padding:16px;margin:0 0 16px;">
              <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(event.title)}</h2>
              <p style="margin:0 0 2px;color:#6b665e;">${escapeHtml(event.when)}</p>
              ${event.where ? `<p style="margin:0 0 8px;color:#6b665e;">${escapeHtml(event.where)}</p>` : ''}
              ${event.description ? `<p style="margin:8px 0 12px;">${escapeHtml(clamp(event.description, 400))}</p>` : ''}
              <p style="margin:0 0 12px;color:#6b665e;font-size:13px;">${
                event.declaredMatches.length > 0
                  ? `Because you said you're interested in ${escapeHtml(event.declaredMatches.join(', '))}`
                  : `Because you've been to ${escapeHtml(event.matched.join(', '))} gatherings before`
              }</p>
              <p style="margin:0;"><a href="${escapeHtml(event.rsvpUrl)}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;">${
                event.ticketed ? 'Get a ticket' : 'RSVP'
              }</a></p>
            </div>`,
          )
          .join('');

        return {
          subject,
          htmlBody: `
            <h1>On your radar at ${escapeHtml(d.orgName)}</h1>
            <p>Hello ${escapeHtml(d.memberName)}, ${
              d.events.length === 1
                ? 'here is something coming up that looks like your sort of thing.'
                : 'here are a few things coming up that look like your sort of thing.'
            }</p>
            ${cards}
            <p style="color:#6b665e;font-size:13px;margin-top:24px;">
              ${escapeHtml(d.orgName)} sends this because of the interests on your profile.
              <a href="${escapeHtml(d.interestsUrl)}">Change your interests</a>
              &middot;
              <a href="${escapeHtml(d.unsubscribeUrl)}">Unsubscribe from radar emails</a>
            </p>
          `,
        };
      }

      case 'booking-awaiting-approval': {
        const d = data as BookingApprovalData;
        const others = d.waiting - 1;
        return {
          subject: `${d.orgName}: ${d.memberName} is asking for the ${d.roomName}`,
          htmlBody: `
            <h1>A room request is waiting</h1>
            <p>Hello ${escapeHtml(d.organiserName)}, ${escapeHtml(d.memberName)} has asked to use the ${escapeHtml(d.roomName)}.</p>
            <p><strong>${escapeHtml(d.title)}</strong><br />${escapeHtml(d.when)}</p>
            <p>The room is held for them until you decide, and they have been told it is waiting on you.</p>
            ${
              others > 0
                ? `<p>${others === 1 ? 'One other request is' : `${others} other requests are`} waiting too.</p>`
                : ''
            }
            <p><a href="${escapeHtml(d.reviewUrl)}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;">Review the request</a></p>
          `,
        };
      }

      case 'recap-ready': {
        const d = data as RecapReadyData;
        return {
          subject: `${d.orgName}: ${d.monthLabel} is ready to send`,
          htmlBody: `
            <h1>${escapeHtml(d.monthLabel)} is ready</h1>
            <p>Hello ${escapeHtml(d.organiserName)}, MaybeOS has added up what ${escapeHtml(d.orgName)} did last month.</p>
            <p>Nothing has gone out yet. Read it, add a note from the community if you want one, and send it when you are happy.</p>
            <p><a href="${escapeHtml(d.reviewUrl)}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;">Read the draft</a></p>
          `,
        };
      }

      case 'recap': {
        const d = data as RecapEmailData;
        const f = d.figures;

        const row = (label: string, value: string) => `
          <tr>
            <td style="padding:8px 0;color:#6b665e;">${escapeHtml(label)}</td>
            <td style="padding:8px 0;text-align:right;font-weight:600;">${escapeHtml(value)}</td>
          </tr>`;

        const rows = [
          row('Members', String(f.members.total)),
          f.members.joined > 0 ? row('Joined last month', String(f.members.joined)) : '',
          f.events.hosted > 0 ? row('Events held', String(f.events.hosted)) : '',
          // Which number this is, said plainly. A check-in is somebody who was
          // there; an RSVP is somebody who meant to be, and a month that mixes
          // the two silently is a month nobody can check.
          f.events.checkedIn > 0
            ? row(
                `People at the door${
                  f.events.eventsWithDoor < f.events.hosted
                    ? ` (across ${f.events.eventsWithDoor} of them)`
                    : ''
                }`,
                String(f.events.checkedIn),
              )
            : f.events.expected > 0
              ? row('People who said they were coming', String(f.events.expected))
              : '',
          f.service ? row('Hours members served', `${f.service.hours} by ${f.service.members} people`) : '',
          f.service?.valueCents
            ? row('What those hours were worth', dollars(f.service.valueCents))
            : '',
          d.showMoney && f.money.month.totalCents > 0
            ? row('Taken through MaybeOS', dollars(f.money.month.totalCents))
            : '',
          d.showMoney && f.money.year.totalCents > 0
            ? row('So far this year', dollars(f.money.year.totalCents))
            : '',
        ]
          .filter(Boolean)
          .join('');

        const impact = f.impact.length
          ? `<h2 style="font-size:16px;margin:24px 0 8px;">What members are telling us</h2>
             <table style="width:100%;border-collapse:collapse;">${f.impact
               .map((m) =>
                 row(
                   `${m.category.replace(/_/g, ' ')} (${m.respondents} members)`,
                   `${m.average} out of 5`,
                 ),
               )
               .join('')}</table>`
          : '';

        return {
          subject: `${d.orgName}: ${d.monthLabel}`,
          htmlBody: `
            <h1>${escapeHtml(d.orgName)} in ${escapeHtml(d.monthLabel)}</h1>
            <p>Hello ${escapeHtml(d.memberName)},</p>
            ${d.note ? `<p style="white-space:pre-wrap;">${escapeHtml(d.note)}</p>` : ''}
            ${d.composed ? `<p>${escapeHtml(d.composed)}</p>` : ''}
            <table style="width:100%;border-collapse:collapse;margin-top:16px;">${rows}</table>
            ${impact}
            ${
              d.showMoney && f.money.month.totalCents > 0
                ? `<p style="color:#6b665e;font-size:13px;margin-top:16px;">Money figures cover dues, tickets and room hire taken through MaybeOS. Anything handled outside it — cash, grants, donations — is not counted here.</p>`
                : ''
            }
            ${
              // D-032: wherever MaybeOS prints a dollar value for volunteer
              // hours, it says whose rate that is. The co-op is making a claim
              // to its own members here, and the product must not look like
              // the source of a number it did not choose.
              f.service?.valueCents
                ? `<p style="color:#6b665e;font-size:13px;">Hours are valued at the rate ${escapeHtml(d.orgName)} set for itself. MaybeOS does not supply one.</p>`
                : ''
            }
            <p style="color:#6b665e;font-size:13px;margin-top:24px;">
              You get this because you are a member of ${escapeHtml(d.orgName)}.
              <a href="${escapeHtml(d.unsubscribeUrl)}">Stop these monthly emails</a>
            </p>
          `,
        };
      }

      case 'magic-link':
        return {
          subject: 'Your sign-in link',
          htmlBody: `
            <h1>Sign in to MaybeOS</h1>
            <p>Click the link below to sign in. This link expires in 15 minutes.</p>
            <p><a href="${data.link}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;">Sign In</a></p>
            <p>If you didn't request this, you can safely ignore this email.</p>
          `,
        };

      case 'event-reminder':
        return {
          subject: `Reminder: ${data.eventTitle}`,
          htmlBody: `
            <h1>Event Reminder</h1>
            <p>You have an upcoming event: <strong>${data.eventTitle}</strong></p>
            <p><strong>When:</strong> ${data.eventDate}</p>
            <p><a href="${data.eventUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;">View Event</a></p>
          `,
        };

      case 'renewal-reminder':
        return {
          subject: 'Your membership renewal is coming up',
          htmlBody: `
            <h1>Membership Renewal Reminder</h1>
            <p>Hi ${data.memberName},</p>
            <p>Your membership is due for renewal on <strong>${data.dueDate}</strong>.</p>
            <p>Please make sure your payment method is up to date to avoid any interruption.</p>
          `,
        };

      case 'dunning':
        return {
          subject: 'Action required: Payment failed',
          htmlBody: `
            <h1>Payment Failed</h1>
            <p>Hi ${data.memberName},</p>
            <p>We were unable to process your payment for your <strong>${data.orgName}</strong> membership.</p>
            <p>Please update your payment method to keep your membership active.</p>
            <p>If you believe this is an error, please contact the organization administrator.</p>
          `,
        };

      case 'invite':
        return {
          subject: `You're invited to join ${data.orgName}`,
          htmlBody: `
            <h1>You've been invited!</h1>
            <p>${data.inviterName ? `<strong>${data.inviterName}</strong> has invited you` : 'You have been invited'} to join <strong>${data.orgName}</strong> on MaybeOS.</p>
            <p>Click the button below to accept the invitation and join the community.</p>
            <p><a href="${data.inviteUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Accept Invitation</a></p>
            <p style="color:#666;font-size:14px;">This invitation expires in 7 days. If you didn't expect this invitation, you can safely ignore this email.</p>
          `,
        };

      case 'waitlist-promoted':
        return {
          subject: `You're in — ${data.eventTitle}`,
          htmlBody: `
            <h1>A place opened up</h1>
            <p>Hi ${data.memberName}, somebody cancelled and <strong>you're off the waitlist</strong> for ${data.orgName}'s event.</p>
            <p><strong>${data.eventTitle}</strong><br>${data.when}</p>
            <p>Your place is confirmed — nothing else to do.</p>
            <p><a href="${data.eventUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">See the event</a></p>
            <p style="color:#666;font-size:14px;">Can't make it after all? Cancel from the event page so the next person on the list gets it.</p>
          `,
        };

      // ─── Room bookings ──────────────────────────────────────────
      // Brand colours are inlined: email clients strip <style> blocks and have
      // no access to the app's CSS variables.
      case 'booking-received':
        return {
          subject: `Booking request received — ${data.roomName}`,
          htmlBody: `
            <h1>We've got your request</h1>
            <p>Hi ${data.memberName}, your request for <strong>${data.roomName}</strong> at ${data.orgName} is with an organiser.</p>
            <p><strong>${data.title}</strong><br>${data.when}</p>
            <p>You'll get another email once it's confirmed. Nothing is held until then.</p>
            <p><a href="${data.bookingsUrl}" style="display:inline-block;padding:12px 24px;background:#c81e2c;color:#fffdf8;border:1.5px solid #211c16;border-radius:8px;text-decoration:none;font-weight:600;">View your bookings</a></p>
          `,
        };

      case 'booking-confirmed':
        return {
          subject: `Confirmed: ${data.roomName} — ${data.when}`,
          htmlBody: `
            <h1>Your booking is confirmed</h1>
            <p>Hi ${data.memberName}, <strong>${data.roomName}</strong> at ${data.orgName} is yours.</p>
            <p><strong>${data.title}</strong><br>${data.when}</p>
            <p><a href="${data.bookingsUrl}" style="display:inline-block;padding:12px 24px;background:#c81e2c;color:#fffdf8;border:1.5px solid #211c16;border-radius:8px;text-decoration:none;font-weight:600;">Reschedule or cancel</a></p>
            <p style="color:#8b8072;font-size:14px;">If your plans change, cancelling frees the room for someone else.</p>
          `,
        };

      case 'booking-rejected':
        return {
          subject: `Booking not confirmed — ${data.roomName}`,
          htmlBody: `
            <h1>That slot didn't work out</h1>
            <p>Hi ${data.memberName}, your request for <strong>${data.roomName}</strong> at ${data.orgName} wasn't confirmed.</p>
            <p><strong>${data.title}</strong><br>${data.when}</p>
            <p>You're welcome to try another time — an organiser can tell you what's usually free.</p>
            <p><a href="${data.manageUrl}" style="display:inline-block;padding:12px 24px;background:#c81e2c;color:#fffdf8;border:1.5px solid #211c16;border-radius:8px;text-decoration:none;font-weight:600;">Find another time</a></p>
          `,
        };

      case 'booking-canceled':
        return {
          subject: `Cancelled: ${data.roomName} — ${data.when}`,
          htmlBody: `
            <h1>Booking cancelled</h1>
            <p>Hi ${data.memberName}, this booking at ${data.orgName} has been cancelled and the room is free again.</p>
            <p><strong>${data.title}</strong><br>${data.roomName}, ${data.when}</p>
            <p><a href="${data.manageUrl}" style="display:inline-block;padding:12px 24px;background:#c81e2c;color:#fffdf8;border:1.5px solid #211c16;border-radius:8px;text-decoration:none;font-weight:600;">Book another time</a></p>
            <p style="color:#8b8072;font-size:14px;">If you didn't cancel this yourself, speak to an organiser.</p>
          `,
        };

      case 'booking-rescheduled':
        return {
          subject: `Moved: ${data.roomName} — ${data.when}`,
          htmlBody: `
            <h1>Your booking moved</h1>
            <p>Hi ${data.memberName}, <strong>${data.roomName}</strong> at ${data.orgName} is now booked for:</p>
            <p><strong>${data.title}</strong><br>${data.when}</p>
            ${data.needsApproval ? `<p>Because the time changed, it needs confirming again. We'll email you when it is.</p>` : ''}
            <p><a href="${data.bookingsUrl}" style="display:inline-block;padding:12px 24px;background:#c81e2c;color:#fffdf8;border:1.5px solid #211c16;border-radius:8px;text-decoration:none;font-weight:600;">View your bookings</a></p>
          `,
        };

      default:
        return {
          subject: 'Notification from MaybeOS',
          htmlBody: `<p>You have a new notification.</p>`,
        };
    }
  }
}

/** Keep a host's description to a readable paragraph in the digest. */
function clamp(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Cents as a member would read them. */
function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
