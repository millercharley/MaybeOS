import {
  Controller,
  Get,
  Post,
  Delete,
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
import { CreatePostDto } from './dto/create-post.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { AddCommentDto } from './dto/add-comment.dto';
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

  @Post('channels')
  @Roles('ADMIN')
  createChannel(
    @Param('orgId') orgId: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.commonsService.createChannel(orgId, dto);
  }

  @Get('channels')
  listChannels(@Param('orgId') orgId: string) {
    return this.commonsService.listChannels(orgId);
  }

  @Post('channels/:channelId/pin')
  @Roles('ADMIN')
  pinChannel(@Param('channelId') channelId: string) {
    return this.commonsService.pinChannel(channelId, true);
  }

  @Delete('channels/:channelId/pin')
  @Roles('ADMIN')
  unpinChannel(@Param('channelId') channelId: string) {
    return this.commonsService.pinChannel(channelId, false);
  }

  // ─── Posts ──────────────────────────────────────────────────

  @Post('channels/:channelId/posts')
  createPost(
    @Param('channelId') channelId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePostDto,
  ) {
    return this.commonsService.createPost(channelId, user.userId, dto);
  }

  @Get('channels/:channelId/posts')
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  listPosts(
    @Param('channelId') channelId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(20), ParseIntPipe) perPage: number,
  ) {
    return this.commonsService.listPosts(channelId, page, perPage);
  }

  @Get('posts/:postId')
  getPost(@Param('postId') postId: string) {
    return this.commonsService.getPost(postId);
  }

  // ─── Comments ───────────────────────────────────────────────

  @Post('posts/:postId/comments')
  addComment(
    @Param('postId') postId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: AddCommentDto,
  ) {
    return this.commonsService.addComment(postId, user.userId, dto.body, dto.parentId);
  }

  @Post('comments/:commentId/flag')
  @Roles('ADMIN', 'STAFF')
  flagComment(@Param('commentId') commentId: string) {
    return this.commonsService.flagComment(commentId);
  }

  // ─── Reactions ──────────────────────────────────────────────

  @Post('posts/:postId/reactions')
  addReaction(
    @Param('postId') postId: string,
    @CurrentUser() user: RequestUser,
    @Body('emoji') emoji: string,
  ) {
    return this.commonsService.addReaction(postId, user.userId, emoji);
  }

  @Delete('posts/:postId/reactions/:emoji')
  removeReaction(
    @Param('postId') postId: string,
    @Param('emoji') emoji: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.commonsService.removeReaction(postId, user.userId, emoji);
  }

  // ─── Flagging ───────────────────────────────────────────────

  @Post('posts/:postId/flag')
  flagPost(@Param('postId') postId: string) {
    return this.commonsService.flagPost(postId);
  }

  // ─── Proposals ──────────────────────────────────────────────

  @Post('channels/:channelId/proposals')
  createProposal(
    @Param('channelId') channelId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateProposalDto,
  ) {
    return this.commonsService.createProposal(channelId, user.userId, dto);
  }

  @Post('proposals/:proposalId/open')
  @Roles('ADMIN')
  openProposal(@Param('proposalId') proposalId: string) {
    return this.commonsService.openProposal(proposalId);
  }

  @Post('proposals/:proposalId/close')
  @Roles('ADMIN')
  closeProposal(@Param('proposalId') proposalId: string) {
    return this.commonsService.closeProposal(proposalId);
  }

  @Post('proposals/:proposalId/vote')
  castVote(
    @Param('proposalId') proposalId: string,
    @CurrentUser() user: RequestUser,
    @Body('choice') choice: VoteChoice,
  ) {
    return this.commonsService.castVote(proposalId, user.userId, choice);
  }

  @Get('proposals/:proposalId')
  getProposal(@Param('proposalId') proposalId: string) {
    return this.commonsService.getProposal(proposalId);
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
  listConversations(@CurrentUser() user: RequestUser) {
    return this.commonsService.listConversations(user.userId);
  }

  @Get('dms/:otherUserId')
  getConversation(
    @Param('otherUserId') otherUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.commonsService.getConversation(user.userId, otherUserId);
  }

  @Post('dms/:otherUserId')
  sendMessage(
    @Param('otherUserId') otherUserId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendMessageDto,
  ) {
    return this.commonsService.sendMessage(user.userId, otherUserId, dto.body);
  }

  @Post('dms/:otherUserId/read')
  markConversationRead(
    @Param('otherUserId') otherUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.commonsService.markConversationRead(user.userId, otherUserId);
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
    @Param('collectionId') collectionId: string,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.commonsService.updateCollection(collectionId, dto);
  }

  @Delete('collections/:collectionId')
  @Roles('ADMIN')
  deleteCollection(@Param('collectionId') collectionId: string) {
    return this.commonsService.deleteCollection(collectionId);
  }

  @Post('collections/:collectionId/pages')
  @Roles('ADMIN')
  createPage(
    @Param('collectionId') collectionId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePageDto,
  ) {
    return this.commonsService.createPage(collectionId, user.userId, dto);
  }

  @Get('pages/:pageId')
  getPage(@Param('pageId') pageId: string) {
    return this.commonsService.getPage(pageId);
  }

  @Post('pages/:pageId')
  @Roles('ADMIN')
  updatePage(@Param('pageId') pageId: string, @Body() dto: UpdatePageDto) {
    return this.commonsService.updatePage(pageId, dto);
  }

  @Delete('pages/:pageId')
  @Roles('ADMIN')
  deletePage(@Param('pageId') pageId: string) {
    return this.commonsService.deletePage(pageId);
  }

  // ─── Search (⌘K) ────────────────────────────────────────────

  @Get('search')
  @ApiQuery({ name: 'q', required: true })
  search(@Param('orgId') orgId: string, @Query('q') q: string) {
    return this.commonsService.search(orgId, q);
  }
}
