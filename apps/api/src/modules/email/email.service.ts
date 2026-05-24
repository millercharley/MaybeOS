import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface EmailJobData {
  type: 'welcome' | 'magic-link' | 'event-reminder' | 'renewal-reminder' | 'dunning' | 'invite';
  to: string;
  data: Record<string, any>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(@InjectQueue('email') private readonly emailQueue: Queue) {}

  /**
   * Queue a welcome email for a new organization member.
   */
  async sendWelcome(to: string, orgName: string, memberName: string) {
    await this.emailQueue.add('send', {
      type: 'welcome',
      to,
      data: { orgName, memberName },
    } as EmailJobData);

    this.logger.log(`Queued welcome email to ${to}`);
  }

  /**
   * Queue a magic link / passwordless login email.
   */
  async sendMagicLink(to: string, link: string) {
    await this.emailQueue.add('send', {
      type: 'magic-link',
      to,
      data: { link },
    } as EmailJobData);

    this.logger.log(`Queued magic-link email to ${to}`);
  }

  /**
   * Queue an event reminder email.
   */
  async sendEventReminder(
    to: string,
    eventTitle: string,
    eventDate: string,
    eventUrl: string,
  ) {
    await this.emailQueue.add('send', {
      type: 'event-reminder',
      to,
      data: { eventTitle, eventDate, eventUrl },
    } as EmailJobData);

    this.logger.log(`Queued event reminder email to ${to} for "${eventTitle}"`);
  }

  /**
   * Queue a membership renewal reminder email.
   */
  async sendRenewalReminder(to: string, memberName: string, dueDate: string) {
    await this.emailQueue.add('send', {
      type: 'renewal-reminder',
      to,
      data: { memberName, dueDate },
    } as EmailJobData);

    this.logger.log(`Queued renewal reminder email to ${to}`);
  }

  /**
   * Queue a dunning / payment failure notice email.
   */
  async sendDunning(to: string, memberName: string, orgName: string) {
    await this.emailQueue.add('send', {
      type: 'dunning',
      to,
      data: { memberName, orgName },
    } as EmailJobData);

    this.logger.log(`Queued dunning email to ${to}`);
  }

  async sendInvite(to: string, orgName: string, inviteUrl: string, inviterName?: string) {
    await this.emailQueue.add('send', {
      type: 'invite',
      to,
      data: { orgName, inviteUrl, inviterName },
    } as EmailJobData);

    this.logger.log(`Queued invite email to ${to} for org "${orgName}"`);
  }
}
