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
        // Signed per read, and short-lived. The bucket is private because
        // these hang off members-only posts and private events.
        url: await this.storage.signedAttachmentUrl(a.path),
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
}
