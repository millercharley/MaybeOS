import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { CommonsService } from './commons.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto, ReorderChannelsDto } from './dto/update-channel.dto';
import { SectionDto, ReorderSectionsDto } from './dto/section.dto';
import { InviteToChannelDto } from './dto/invite-to-channel.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { EditCommentDto } from './dto/edit-comment.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateCollectionDto, UpdateCollectionDto } from './dto/create-collection.dto';
import { CreatePageDto, UpdatePageDto } from './dto/page.dto';
import { VoteChoice } from '@prisma/client';

@ApiTags('commons')
@ApiBearerAuth()
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class CommonsController {
  constructor(private readonly commonsService: CommonsService) {}

  // ─── Channels ───────────────────────────────────────────────

  /**
   * Open a channel (CMN-11).
   *
   * No `@Roles('ADMIN')` any more: whether a member may do this depends on a
   * setting of the co-op's as well as the caller's role, and a decorator
   * cannot read the database. The service refuses members when the co-op has
   * not turned it on — which is the default — so the rule is unchanged for
   * every co-op that has not asked for it.
   */
  @Post('channels')
  createChannel(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateChannelDto,
  ) {
    return this.commonsService.createChannel(orgId, dto, user.userId, user.orgRoles?.[orgId]);
  }

  @Get('channels')
  listChannels(@Param('orgId') orgId: string) {
    return this.commonsService.listChannels(orgId);
  }

  /**
   * Rename a channel, give it an emoji, or file it under a section (CMN-10,
   * CMN-11).
   *
   * Was ADMIN-only, on the reasoning that this is the shape of the co-op's
   * Commons rather than a post in it. Still true of somebody else's channel —
   * but once a member can open one, they have to be able to fix its name, so
   * the service allows an admin or the member who opened it.
   */
  @Patch('channels/:channelId')
  updateChannel(
    @Param('orgId') orgId: string,
    @Param('channelId') channelId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.commonsService.updateChannel(
      orgId,
      channelId,
      dto,
      user.userId,
      user.orgRoles?.[orgId],
    );
  }

  /**
   * The whole order in one write, not one move at a time — see the service.
   * `POST` rather than `PATCH` because it is not a partial update of anything.
   */
  @Post('channels/reorder')
  @Roles('ADMIN')
  reorderChannels(@Param('orgId') orgId: string, @Body() dto: ReorderChannelsDto) {
    return this.commonsService.reorderChannels(orgId, dto.channelIds);
  }

  /** Deletes the posts in it too. The UI says so in numbers first. */
  @Delete('channels/:channelId')
  @Roles('ADMIN')
  deleteChannel(
    @Param('orgId') orgId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.commonsService.deleteChannel(orgId, channelId);
  }

  @Post('channels/:channelId/pin')
  @Roles('ADMIN')
  pinChannel(
    @Param('orgId') orgId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.commonsService.pinChannel(orgId, channelId, true);
  }

  @Delete('channels/:channelId/pin')
  @Roles('ADMIN')
  unpinChannel(
    @Param('orgId') orgId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.commonsService.pinChannel(orgId, channelId, false);
  }

  /**
   * Invite members to a channel (CMN-11).
   *
   * Any member, not just an admin: the person who started a conversation is
   * the one who knows who should be in it. It grants no access — channels are
   * open to the whole co-op — so what this can do at worst is send somebody a
   * message, which is a thing any member can already do.
   */
  @Post('channels/:channelId/invite')
  inviteToChannel(
    @Param('orgId') orgId: string,
    @Param('channelId') channelId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: InviteToChannelDto,
  ) {
    return this.commonsService.inviteToChannel(
      orgId,
      channelId,
      user.userId,
      dto.userIds,
      dto.note,
    );
  }

  /** Whether this member may open a channel here, and manage sections. */
  @Get('commons/permissions')
  commonsPermissions(@Param('orgId') orgId: string, @CurrentUser() user: RequestUser) {
    return this.commonsService.commonsPermissions(orgId, user.orgRoles?.[orgId]);
  }

  // ─── Sections (CMN-11) ──────────────────────────────────────
  //
  // Reading is open to any member — the sidebar needs the headings to draw
  // itself. Making and arranging them is ADMIN: it is the co-op's information
  // architecture, and the channels filed under a heading belong to everybody.
  //
  // `sections/reorder` is declared before `sections/:sectionId` so the literal
  // wins the match, the same way `channels/reorder` is. Nest resolves in
  // declaration order, and a route shadowed by a parameter is a 404 nobody can
  // explain later (MIG-01 lost an afternoon to exactly this).

  @Get('sections')
  listSections(@Param('orgId') orgId: string) {
    return this.commonsService.listSections(orgId);
  }

  @Post('sections/reorder')
  @Roles('ADMIN')
  reorderSections(@Param('orgId') orgId: string, @Body() dto: ReorderSectionsDto) {
    return this.commonsService.reorderSections(orgId, dto.sectionIds);
  }

  @Post('sections')
  @Roles('ADMIN')
  createSection(@Param('orgId') orgId: string, @Body() dto: SectionDto) {
    return this.commonsService.createSection(orgId, dto.name);
  }

  @Patch('sections/:sectionId')
  @Roles('ADMIN')
  updateSection(
    @Param('orgId') orgId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: SectionDto,
  ) {
    return this.commonsService.updateSection(orgId, sectionId, dto.name);
  }

  /** The channels in it survive, unfiled. The response says how many moved. */
  @Delete('sections/:sectionId')
  @Roles('ADMIN')
  deleteSection(
    @Param('orgId') orgId: string,
    @Param('sectionId') sectionId: string,
  ) {
    return this.commonsService.deleteSection(orgId, sectionId);
  }

  // ─── Posts ──────────────────────────────────────────────────

  @Post('channels/:channelId/posts')
  createPost(
    @Param('orgId') orgId: string,
    @Param('channelId') channelId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePostDto,
  ) {
    return this.commonsService.createPost(orgId, channelId, user.userId, dto);
  }

  @Get('channels/:channelId/posts')
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  listPosts(
    @Param('orgId') orgId: string,
    @Param('channelId') channelId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(20), ParseIntPipe) perPage: number,
  ) {
    return this.commonsService.listPosts(orgId, channelId, page, perPage);
  }

  @Get('posts/:postId')
  getPost(
    @Param('orgId') orgId: string,
    @Param('postId') postId: string,
  ) {
    return this.commonsService.getPost(orgId, postId);
  }

  // ─── Comments ───────────────────────────────────────────────

  @Post('posts/:postId/comments')
  addComment(
    @Param('orgId') orgId: string,
    @Param('postId') postId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: AddCommentDto,
  ) {
    return this.commonsService.addComment(orgId, postId, user.userId, dto.body, dto.parentId);
  }

  /**
   * Rewrite your own comment (CMN-09).
   *
   * No `@Roles`: this is not a rank, it is authorship, and the service is what
   * checks it. An organiser editing somebody else's words in a members'
   * discussion would be a different feature with a different name.
   */
  @Patch('comments/:commentId')
  editComment(
    @Param('orgId') orgId: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: EditCommentDto,
  ) {
    return this.commonsService.editComment(orgId, commentId, user.userId, dto.body);
  }

  @Post('comments/:commentId/flag')
  @Roles('ADMIN', 'STAFF')
  flagComment(
    @Param('orgId') orgId: string,
    @Param('commentId') commentId: string,
  ) {
    return this.commonsService.flagComment(orgId, commentId);
  }

  // ─── Reactions ──────────────────────────────────────────────

  @Post('posts/:postId/reactions')
  addReaction(
    @Param('orgId') orgId: string,
    @Param('postId') postId: string,
    @CurrentUser() user: RequestUser,
    @Body('emoji') emoji: string,
  ) {
    return this.commonsService.addReaction(orgId, postId, user.userId, emoji);
  }

  @Delete('posts/:postId/reactions/:emoji')
  removeReaction(
    @Param('orgId') orgId: string,
    @Param('postId') postId: string,
    @Param('emoji') emoji: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.commonsService.removeReaction(orgId, postId, user.userId, emoji);
  }

  // ─── Flagging ───────────────────────────────────────────────

  @Post('posts/:postId/flag')
  flagPost(
    @Param('orgId') orgId: string,
    @Param('postId') postId: string,
  ) {
    return this.commonsService.flagPost(orgId, postId);
  }

  // ─── Proposals ──────────────────────────────────────────────

  @Post('channels/:channelId/proposals')
  createProposal(
    @Param('orgId') orgId: string,
    @Param('channelId') channelId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateProposalDto,
  ) {
    return this.commonsService.createProposal(orgId, channelId, user.userId, dto);
  }

  @Post('proposals/:proposalId/open')
  @Roles('ADMIN')
  openProposal(
    @Param('orgId') orgId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.commonsService.openProposal(orgId, proposalId);
  }

  @Post('proposals/:proposalId/close')
  @Roles('ADMIN')
  closeProposal(
    @Param('orgId') orgId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.commonsService.closeProposal(orgId, proposalId);
  }

  @Post('proposals/:proposalId/vote')
  castVote(
    @Param('orgId') orgId: string,
    @Param('proposalId') proposalId: string,
    @CurrentUser() user: RequestUser,
    @Body('choice') choice: VoteChoice,
  ) {
    return this.commonsService.castVote(orgId, proposalId, user.userId, choice);
  }

  @Get('proposals/:proposalId')
  getProposal(
    @Param('orgId') orgId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.commonsService.getProposal(orgId, proposalId);
  }

  @Get('proposals')
  @ApiQuery({ name: 'status', required: false })
  listProposals(
    @Param('orgId') orgId: string,
    @Query('status') status?: string,
  ) {
    return this.commonsService.listProposals(orgId, status);
  }

  // ─── Direct Messages ────────────────────────────────────────

  @Get('dms')
  listConversations(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.commonsService.listConversations(orgId, user.userId);
  }

  @Get('dms/:otherUserId')
  getConversation(
    @Param('orgId') orgId: string,
    @Param('otherUserId') otherUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.commonsService.getConversation(orgId, user.userId, otherUserId);
  }

  @Post('dms/:otherUserId')
  sendMessage(
    @Param('orgId') orgId: string,
    @Param('otherUserId') otherUserId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendMessageDto,
  ) {
    return this.commonsService.sendMessage(orgId, user.userId, otherUserId, dto.body);
  }

  @Post('dms/:otherUserId/read')
  markConversationRead(
    @Param('orgId') orgId: string,
    @Param('otherUserId') otherUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.commonsService.markConversationRead(orgId, user.userId, otherUserId);
  }

  // ─── Collections (wiki) ─────────────────────────────────────

  @Post('collections')
  @Roles('ADMIN')
  createCollection(@Param('orgId') orgId: string, @Body() dto: CreateCollectionDto) {
    return this.commonsService.createCollection(orgId, dto);
  }

  @Get('collections')
  listCollections(@Param('orgId') orgId: string) {
    return this.commonsService.listCollections(orgId);
  }

  @Post('collections/:collectionId')
  @Roles('ADMIN')
  updateCollection(
    @Param('orgId') orgId: string,
    @Param('collectionId') collectionId: string,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.commonsService.updateCollection(orgId, collectionId, dto);
  }

  @Delete('collections/:collectionId')
  @Roles('ADMIN')
  deleteCollection(
    @Param('orgId') orgId: string,
    @Param('collectionId') collectionId: string,
  ) {
    return this.commonsService.deleteCollection(orgId, collectionId);
  }

  @Post('collections/:collectionId/pages')
  @Roles('ADMIN')
  createPage(
    @Param('orgId') orgId: string,
    @Param('collectionId') collectionId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePageDto,
  ) {
    return this.commonsService.createPage(orgId, collectionId, user.userId, dto);
  }

  @Get('pages/:pageId')
  getPage(
    @Param('orgId') orgId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.commonsService.getPage(orgId, pageId);
  }

  @Post('pages/:pageId')
  @Roles('ADMIN')
  updatePage(
    @Param('orgId') orgId: string,
    @Param('pageId') pageId: string,
    @Body() dto: UpdatePageDto,
  ) {
    return this.commonsService.updatePage(orgId, pageId, dto);
  }

  @Delete('pages/:pageId')
  @Roles('ADMIN')
  deletePage(
    @Param('orgId') orgId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.commonsService.deletePage(orgId, pageId);
  }

  // ─── Search (⌘K) ────────────────────────────────────────────

  @Get('search')
  @ApiQuery({ name: 'q', required: true })
  search(@Param('orgId') orgId: string, @Query('q') q: string) {
    return this.commonsService.search(orgId, q);
  }
}
