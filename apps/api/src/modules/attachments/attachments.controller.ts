import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { AttachmentsService } from './attachments.service';
import { CreateUploadUrlDto, RecordAttachmentDto } from './dto/attachment.dto';

/** Organisers may moderate anything in their co-op; a member their own uploads. */
function isStaff(user: RequestUser, orgId: string): boolean {
  if (user.globalRole === 'PLATFORM_ADMIN') return true;
  const role = user.orgRoles?.[orgId];
  return role === 'ADMIN' || role === 'STAFF';
}

/**
 * Files on posts, comments and events.
 *
 * Every route is membership-guarded: a co-op's attachments are its own, and
 * the bucket behind them is private for the same reason.
 */
@ApiTags('attachments')
@Controller('orgs/:orgId')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /**
   * Ask for somewhere to upload to.
   *
   * The server picks the path; the browser then uploads straight to storage.
   * Files do not travel through this API at all — a Netlify Function caps a
   * request at about 6 MB, which a phone photo clears on its own.
   */
  @Post('attachments/upload-url')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a one-time URL to upload a file to' })
  createUploadUrl(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateUploadUrlDto,
  ) {
    return this.attachments.createUploadUrl(orgId, dto.mimeType);
  }

  /** Record a finished upload against the post, comment or event it belongs to. */
  @Post('attachments')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Attach an uploaded file to a post, comment or event' })
  record(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RecordAttachmentDto,
  ) {
    return this.attachments.record(orgId, user.userId, dto);
  }

  @Get('attachments')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Attachments for one post, comment or event' })
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('postId') postId?: string,
    @Query('commentId') commentId?: string,
    @Query('eventId') eventId?: string,
  ) {
    return this.attachments.listFor(orgId, { postId, commentId, eventId });
  }

  @Delete('attachments/:attachmentId')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove an attachment' })
  remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attachments.remove(orgId, attachmentId, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }
}
