import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RecordAttachmentDto } from './dto/attachment.dto';

/**
 * Files members attach to a post, a comment or an event.
 *
 * The bytes never pass through this API. Netlify Functions cap a request at
 * about 6 MB and base64 inflates a file by a third, so the browser uploads
 * straight to Supabase with a URL this service signs, and only the metadata
 * comes back. Two consequences shape everything below:
 *
 *   - **The server chooses the path.** A caller never names where its file
 *     lands, so no request can write into another co-op's folder.
 *   - **The upload is a claim until checked.** The browser reports success on
 *     its own, so a row is only written once the object is confirmed present —
 *     otherwise an abandoned upload leaves an attachment that renders as a
 *     broken file forever.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  createUploadUrl(orgId: string, mimeType: string) {
    return this.storage.createAttachmentUploadUrl(orgId, mimeType);
  }

  /**
   * Record an uploaded file against what it belongs to.
   *
   * Every owner is resolved *through its org* rather than by bare id (SEC-04):
   * the route guard proves the caller belongs to the org they named in the
   * URL, which is not the same as the post belonging to it. Without this, an
   * attachment could be hung off another co-op's event.
   */
  async record(orgId: string, uploaderId: string, dto: RecordAttachmentDto) {
    const owners = [dto.postId, dto.commentId, dto.eventId].filter(Boolean);
    if (owners.length !== 1) {
      throw new BadRequestException(
        'An attachment belongs to exactly one post, comment or event.',
      );
    }

    // The path was issued by this service for this org. Re-checking it here
    // closes the gap between issuing one and recording a different one.
    if (!dto.path.startsWith(`${orgId}/`)) {
      throw new ForbiddenException('That upload does not belong to this co-op.');
    }

    await this.assertOwnerInOrg(orgId, dto);

    const stored = await this.storage.attachmentExists(dto.path);
    if (!stored) {
      throw new BadRequestException('That file was not uploaded. Try again.');
    }

    return this.prisma.attachment.create({
      data: {
        orgId,
        uploaderId,
        path: dto.path,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        sizeBytes: stored.sizeBytes,
        ...(dto.postId ? { postId: dto.postId } : {}),
        ...(dto.commentId ? { commentId: dto.commentId } : {}),
        ...(dto.eventId ? { eventId: dto.eventId } : {}),
      },
    });
  }

  /** Attachments for one owner, each with a short-lived URL to read it. */
  async listFor(
    orgId: string,
    owner: { postId?: string; commentId?: string; eventId?: string },
  ) {
    const attachments = await this.prisma.attachment.findMany({
      where: {
        orgId,
        ...(owner.postId ? { postId: owner.postId } : {}),
        ...(owner.commentId ? { commentId: owner.commentId } : {}),
        ...(owner.eventId ? { eventId: owner.eventId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      attachments.map(async (a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt,
        // Five minutes, not the hour a public asset would get. A signed URL
        // is a bearer token by construction — anyone holding it can read the
        // file — so the mitigation for member material is that it dies
        // quickly. Long enough to open a PDF, short enough that a link pasted
        // into a group chat is useless by the time it is read.
        url: await this.storage.signedAttachmentUrl(a.path, 300),
      })),
    );
  }

  /**
   * Remove an attachment.
   *
   * The uploader, or an organiser moderating. The row goes first: a failed
   * object delete leaves a file nobody references, which is recoverable, while
   * the reverse leaves a row rendering as a broken file, which is not.
   */
  async remove(orgId: string, attachmentId: string, actor: { userId: string; isStaff: boolean }) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, orgId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    if (attachment.uploaderId !== actor.userId && !actor.isStaff) {
      throw new ForbiddenException('Only the person who attached this, or an organiser, can remove it.');
    }

    await this.prisma.attachment.delete({ where: { id: attachment.id } });
    await this.storage.deleteAttachment(orgId, attachment.path);

    return { removed: true };
  }

  /** Resolve the owner through the org, never by bare id (SEC-04). */
  private async assertOwnerInOrg(orgId: string, dto: RecordAttachmentDto) {
    if (dto.postId) {
      const post = await this.prisma.post.findFirst({
        where: { id: dto.postId, channel: { orgId } },
        select: { id: true },
      });
      if (!post) throw new NotFoundException('Post not found');
      return;
    }

    if (dto.commentId) {
      const comment = await this.prisma.comment.findFirst({
        where: { id: dto.commentId, post: { channel: { orgId } } },
        select: { id: true },
      });
      if (!comment) throw new NotFoundException('Comment not found');
      return;
    }

    const event = await this.prisma.event.findFirst({
      where: { id: dto.eventId, orgId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Event not found');
  }

  /**
   * The files on a public event, to anybody (EVT-14).
   *
   * Every other route here is membership-guarded, and should be: a co-op's
   * attachments are its own and the bucket behind them is private. But a
   * public event is the one thing a co-op deliberately publishes, and until
   * now its poster was **invisible to the people it was published for** — the
   * page rendered for a stranger arriving from a shared link and the images
   * attached to it did not.
   *
   * So an attachment follows *its owner's* visibility rather than the
   * bucket's. Two consequences, both deliberate:
   *
   * **Only files hung on the event itself.** A comment underneath a public
   * event is still members-only — the event is public, the co-op's
   * conversation about it is not (EVT-11) — so `commentId` and `postId`
   * attachments are unreachable here by construction rather than by filter.
   *
   * **The event must be PUBLIC *and* published**, checked here rather than
   * inherited from whoever called. Not found, not forbidden: an unpublished
   * event should not be confirmable from the outside.
   */
  async listForPublicEvent(orgSlug: string, eventSlug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Event not found');

    const event = await this.prisma.event.findFirst({
      where: {
        orgId: org.id,
        slug: eventSlug,
        visibility: 'PUBLIC',
        isPublished: true,
        canceledAt: null,
      },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    const attachments = await this.prisma.attachment.findMany({
      // `eventId` only. A comment's file is not an event's file, however
      // public the event is.
      where: { orgId: org.id, eventId: event.id },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      attachments.map(async (a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt,
        // Still five minutes, even though this is public. The URL's secrecy
        // was never the protection here — but visibility can change, and a
        // short life means un-publishing an event actually takes effect
        // within minutes rather than an hour.
        url: await this.storage.signedAttachmentUrl(a.path, 300),
      })),
    );
  }
}
