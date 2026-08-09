import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as postmark from 'postmark';

export interface EmailJobData {
  type: 'welcome' | 'magic-link' | 'event-reminder' | 'renewal-reminder' | 'dunning' | 'invite';
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
    this.emailFrom =
      this.configService.get<string>('EMAIL_FROM') || 'noreply@maybeos.com';

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

  async sendInvite(to: string, orgName: string, inviteUrl: string, inviterName?: string) {
    await this.send({
      type: 'invite',
      to,
      data: { orgName, inviteUrl, inviterName },
    });
  }

  // ─── Delivery ────────────────────────────────────────────────

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

      default:
        return {
          subject: 'Notification from MaybeOS',
          htmlBody: `<p>You have a new notification.</p>`,
        };
    }
  }
}
