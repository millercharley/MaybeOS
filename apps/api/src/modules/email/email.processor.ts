import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as postmark from 'postmark';
import { EmailJobData } from './email.service';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private client: postmark.ServerClient | null = null;
  private emailFrom: string;

  constructor(private readonly configService: ConfigService) {
    super();

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

  async process(job: Job<EmailJobData>): Promise<void> {
    const { type, to, data } = job.data;

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
      this.logger.error(
        `Failed to send email to ${to} (type=${type}): ${err.message}`,
        err.stack,
      );
      throw err; // re-throw so BullMQ can retry
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

      default:
        return {
          subject: 'Notification from MaybeOS',
          htmlBody: `<p>You have a new notification.</p>`,
        };
    }
  }
}
