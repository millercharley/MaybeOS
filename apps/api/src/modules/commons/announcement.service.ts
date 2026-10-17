import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../platform/audit.service';
import { sanitizeEmailHtml } from '../email/email-html';
import { encodeUnsubscribe } from '../../common/unsubscribe-token';
import { announcementSubject, stillOwed, type Recipient, type SendProgress } from './announcement';

/**
 * Emailing a Commons post to the whole roster (CMN-21).
 *
 * The post is written and read in the Commons like any other; this is the
 * copy that goes to everybody's inbox. Unlike the weekly digest it does not
 * care whether a member has been in — a potluck tomorrow is not news that
 * can wait for somebody to drift back.
 *
 * Sent in passes. Four hundred members will not fit inside one function
 * invocation, so each call does what it can inside a deadline and reports
 * what is left; the caller asks again until nothing is. `post_email_sends`
 * is the cursor and the receipt at once — a member with a row has their
 * copy, whatever happened to the process that sent it.
 */
@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  /** Inside Postmark's ten concurrent connections. */
  private static readonly CONCURRENCY = 8;

  /** Checked between groups, never inside one (RDR-04). */
  private static readonly DEADLINE_MS = 7_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * How many members an announcement would reach, before one is sent.
   *
   * Asked by the confirmation dialog. An organiser about to write to four
   * hundred people should see the number first — it is the only moment at
   * which the decision is still reversible.
   */
  async preview(orgId: string, postId: string): Promise<SendProgress & { subject: string }> {
    const { post, recipients, sent } = await this.load(orgId, postId);
    const owed = stillOwed(recipients, sent);

    return {
      sent: 0,
      total: sent.size,
      remaining: owed.length,
      subject: announcementSubject(post.orgName, post.title),
    };
  }

  /**
   * Send one pass, and say what is left.
   *
   * Never throws for a provider failure: a member who did not get their copy
   * keeps no row, so the next pass picks them up. The caller keeps asking
   * until `remaining` is zero.
   */
  async sendPass(orgId: string, postId: string, actorId: string): Promise<SendProgress> {
    const { post, recipients, sent } = await this.load(orgId, postId);
    const owed = stillOwed(recipients, sent);

    /*
      Recorded once, on the first pass, and before anything is sent.

      It marks the post as an announcement in the Commons — "also sent by
      email" under it — and it is what an organiser sees if they wonder
      whether they already pressed the button. Written first because the
      question it answers is "did this start", not "did this finish".
    */
    if (!post.emailRequestedAt) {
      await this.prisma.post.update({
        where: { id: postId },
        data: { emailRequestedAt: new Date() },
      });
      await this.audit.record({
        orgId,
        actorId,
        action: 'commons.post.emailed',
        entityType: 'post',
        entityId: postId,
        // The count, not the addresses: a co-op's audit log is read by its
        // organisers and is not a place to copy four hundred emails into.
        metadata: { recipients: owed.length, subject: announcementSubject(post.orgName, post.title) },
      });
    }

    if (owed.length === 0) return { sent: 0, total: sent.size, remaining: 0 };

    const body = sanitizeEmailHtml(post.body);
    const subject = announcementSubject(post.orgName, post.title);
    const web = this.config.get<string>('APP_URL') ?? 'https://maybeos.org';
    const postUrl = `${web}/portal/${post.orgSlug}/commons?channel=${post.channelId}#post-${postId}`;

    const stopBy = Date.now() + AnnouncementService.DEADLINE_MS;
    let justSent = 0;

    const sendTo = async (member: Recipient): Promise<boolean> => {
      try {
        await this.email.sendAnnouncement(
          // Both addresses a member reads (MEM-19).
          { primary: member.email as string, also: member.altEmail },
          {
            subject,
            orgName: post.orgName,
            authorName: post.authorName,
            bodyHtml: body,
            postUrl,
            unsubscribeUrl: this.unsubscribeUrl(member.id),
            replyTo: post.replyToEmail,
          },
        );

        /*
          The receipt is written after the send, deliberately.

          A row here means "this member has their copy". Writing it first
          would mean a provider failure quietly costs somebody the
          announcement, with nothing left to say they were missed — and
          this is the message an organiser most wants to be sure landed.
          The cost of the other order is a possible duplicate after a crash
          between the two, which is the better of the two mistakes.
        */
        await this.prisma.postEmailSend.create({
          data: { postId, userOrgId: member.id },
        });
        return true;
      } catch (err) {
        this.logger.warn(
          `Announcement ${postId} to ${member.id} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return false;
      }
    };

    for (let i = 0; i < owed.length; i += AnnouncementService.CONCURRENCY) {
      if (Date.now() > stopBy) break;

      const group = owed.slice(i, i + AnnouncementService.CONCURRENCY);
      const results = await Promise.all(group.map(sendTo));
      justSent += results.filter(Boolean).length;
    }

    return {
      sent: justSent,
      total: sent.size + justSent,
      remaining: Math.max(0, owed.length - justSent),
    };
  }

  /**
   * Whether this member gets announcements, read rather than assumed.
   *
   * The way back in, as much as the way out: the unsubscribe link in an
   * announcement switches this off, and without somewhere to switch it on
   * again that choice would be permanent.
   */
  async myEmails(orgId: string, userId: string) {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { announcementEmails: true },
    });
    if (!membership) throw new NotFoundException('You are not a member of this community');

    return { announcementEmails: membership.announcementEmails };
  }

  async setEmails(orgId: string, userId: string, on: boolean) {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('You are not a member of this community');

    await this.prisma.userOrg.update({
      where: { id: membership.id },
      data: { announcementEmails: on },
    });
    return { announcementEmails: on };
  }

  /** Stop announcements for one membership, from the link in one. */
  async unsubscribeByToken(userOrgId: string): Promise<{ orgName: string } | null> {
    const membership = await this.prisma.userOrg.findUnique({
      where: { id: userOrgId },
      select: { id: true, org: { select: { name: true } } },
    });
    if (!membership) return null;

    await this.prisma.userOrg.update({
      where: { id: membership.id },
      data: { announcementEmails: false },
    });
    return { orgName: membership.org.name };
  }

  // ─── Shared ───────────────────────────────────────────────────

  private async load(orgId: string, postId: string) {
    // Scoped by orgId, never by bare id (SEC-04): a post id in a URL is a
    // guess until it is checked against the co-op asking about it.
    const post = await this.prisma.post.findFirst({
      where: { id: postId, channel: { orgId } },
      select: {
        id: true,
        title: true,
        body: true,
        channelId: true,
        emailRequestedAt: true,
        isFlagged: true,
        author: { select: { name: true } },
        channel: {
          select: { org: { select: { name: true, slug: true, replyToEmail: true } } },
        },
      },
    });
    if (!post) throw new NotFoundException('No such post');
    if (post.isFlagged) {
      throw new BadRequestException('That post is hidden, so it cannot be emailed.');
    }

    const [members, sends] = await Promise.all([
      this.prisma.userOrg.findMany({
        where: { orgId, role: { in: ['ADMIN', 'STAFF', 'MEMBER'] } },
        select: {
          id: true,
          userId: true,
          altEmail: true,
          emailOptIn: true,
          announcementEmails: true,
          user: { select: { email: true } },
        },
      }),
      this.prisma.postEmailSend.findMany({ where: { postId }, select: { userOrgId: true } }),
    ]);

    const recipients: Recipient[] = members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user?.email ?? null,
      altEmail: m.altEmail,
      emailOptIn: m.emailOptIn,
      announcementEmails: m.announcementEmails,
    }));

    return {
      post: {
        ...post,
        orgName: post.channel.org.name,
        orgSlug: post.channel.org.slug,
        replyToEmail: post.channel.org.replyToEmail,
        authorName: post.author?.name ?? null,
      },
      recipients,
      sent: new Set(sends.map((s) => s.userOrgId)),
    };
  }

  private unsubscribeUrl(userOrgId: string): string {
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    const token = encodeUnsubscribe({ userOrgId, purpose: 'announcement' }, secret);
    const web = this.config.get<string>('APP_URL') ?? 'https://maybeos.org';
    // The shared page, which lives under /radar and words itself from the
    // purpose inside the token.
    return `${web}/radar/unsubscribe?token=${encodeURIComponent(token)}`;
  }
}
