import { Injectable, Logger } from '@nestjs/common';
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
  manageUrl: string;
}

export interface EmailJobData {
  type:
    | 'welcome'
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
    | 'booking-rescheduled';
  to: string;
  data: Record<string, any>;
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

  async sendWelcome(to: string, orgName: string, memberName: string) {
    await this.send({ type: 'welcome', to, data: { orgName, memberName } });
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
  async sendRaw(to: string, subject: string, htmlBody: string): Promise<void> {
    if (!this.client) {
      this.logger.log(`[DEV] Would send email to=${to} subject="${subject}"\n${htmlBody}`);
      return;
    }

    try {
      await this.client.sendEmail({ From: this.emailFrom, To: to, Subject: subject, HtmlBody: htmlBody });
      this.logger.log(`Email sent successfully to ${to} (raw)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send email to ${to}: ${message}`);
    }
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
      case 'welcome':
        return {
          subject: `Welcome to ${data.orgName}!`,
          htmlBody: `
            <h1>Welcome, ${data.memberName}!</h1>
            <p>You've successfully joined <strong>${data.orgName}</strong>.</p>
            <p>We're excited to have you as a member. Explore your new community dashboard to get started.</p>
          `,
        };

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
            <p><a href="${data.manageUrl}" style="display:inline-block;padding:12px 24px;background:#c81e2c;color:#fffdf8;border:1.5px solid #211c16;border-radius:8px;text-decoration:none;font-weight:600;">View your bookings</a></p>
          `,
        };

      case 'booking-confirmed':
        return {
          subject: `Confirmed: ${data.roomName} — ${data.when}`,
          htmlBody: `
            <h1>Your booking is confirmed</h1>
            <p>Hi ${data.memberName}, <strong>${data.roomName}</strong> at ${data.orgName} is yours.</p>
            <p><strong>${data.title}</strong><br>${data.when}</p>
            <p><a href="${data.manageUrl}" style="display:inline-block;padding:12px 24px;background:#c81e2c;color:#fffdf8;border:1.5px solid #211c16;border-radius:8px;text-decoration:none;font-weight:600;">Reschedule or cancel</a></p>
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
            <p><a href="${data.manageUrl}" style="display:inline-block;padding:12px 24px;background:#c81e2c;color:#fffdf8;border:1.5px solid #211c16;border-radius:8px;text-decoration:none;font-weight:600;">View your bookings</a></p>
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
