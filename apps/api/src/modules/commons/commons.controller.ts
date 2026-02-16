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
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { CommonsService } from './commons.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { VoteChoice } from '@prisma/client';

@ApiTags('commons')
@ApiBearerAuth()
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, RolesGuard)
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
    @Body('body') body: string,
  ) {
    return this.commonsService.addComment(postId, user.userId, body);
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
}
