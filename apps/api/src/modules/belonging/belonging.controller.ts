import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BypassRequiredReading } from '../../common/decorators/bypass-required-reading.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../config/prisma.service';
import { BelongingSettingsService } from './belonging-settings.service';
import { BuddyService } from './buddy.service';
import { KnowledgeService } from './knowledge.service';
import { BuddyLogService } from './buddy-log.service';
import {
  AVAILABLE_VARIABLES,
  BelongingEmailKindName,
  DEFAULT_TEMPLATES,
  validateTemplate,
} from './belonging-emails';
import {
  ArticleCommentDto,
  ClosePairingDto,
  CreateArticleDto,
  CreateSuggestionDto,
  ReassignPairingDto,
  ReorderArticlesDto,
  SetBuddyOptOutDto,
  UpdateArticleDto,
  UpdateBelongingSettingsDto,
  UpdateSuggestionDto,
  UploadCoverDto,
  UpsertEmailTemplateDto,
} from './dto/belonging.dto';
import { BadRequestException } from '@nestjs/common';

@ApiTags('belonging')
@ApiBearerAuth()
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class BelongingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: BelongingSettingsService,
    private readonly buddies: BuddyService,
    private readonly knowledge: KnowledgeService,
    private readonly log: BuddyLogService,
  ) {}

  /** The caller's membership row, which is what everything here is keyed on. */
  private async membership(orgId: string, userId: string) {
    const found = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { id: true, role: true },
    });
    if (!found) throw new NotFoundException('You are not a member of this community');
    return found;
  }

  // ─── Settings ───────────────────────────────────────────────

  @Get('belonging/settings')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Both tools’ settings' })
  getSettings(@Param('orgId') orgId: string) {
    return this.settings.forOrg(orgId);
  }

  @Patch('belonging/settings')
  @Roles('ADMIN')
  updateSettings(@Param('orgId') orgId: string, @Body() dto: UpdateBelongingSettingsDto) {
    return this.settings.update(orgId, dto as Record<string, unknown>);
  }

  // ─── Email templates ────────────────────────────────────────

  @Get('belonging/emails')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'The co-op’s wording, or the default where it has none' })
  async listTemplates(@Param('orgId') orgId: string) {
    const custom = await this.prisma.belongingEmailTemplate.findMany({ where: { orgId } });
    const byKind = new Map(custom.map((t) => [t.kind, t]));

    return (Object.keys(DEFAULT_TEMPLATES) as BelongingEmailKindName[]).map((kind) => ({
      kind,
      subject: byKind.get(kind)?.subject ?? DEFAULT_TEMPLATES[kind].subject,
      body: byKind.get(kind)?.body ?? DEFAULT_TEMPLATES[kind].body,
      // So the editor can say plainly which of these is the co-op's own.
      isCustom: byKind.has(kind),
      variables: AVAILABLE_VARIABLES[kind],
    }));
  }

  @Patch('belonging/emails/:kind')
  @Roles('ADMIN')
  async saveTemplate(
    @Param('orgId') orgId: string,
    @Param('kind') kind: BelongingEmailKindName,
    @Body() dto: UpsertEmailTemplateDto,
  ) {
    if (!(kind in DEFAULT_TEMPLATES)) throw new NotFoundException('No such email');

    const problems = validateTemplate(kind, dto.subject, dto.body);
    if (problems.length > 0) throw new BadRequestException({ message: problems });

    return this.prisma.belongingEmailTemplate.upsert({
      where: { orgId_kind: { orgId, kind } },
      create: { orgId, kind, subject: dto.subject, body: dto.body },
      update: { subject: dto.subject, body: dto.body },
    });
  }

  @Delete('belonging/emails/:kind')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Go back to MaybeOS’s wording' })
  async resetTemplate(@Param('orgId') orgId: string, @Param('kind') kind: BelongingEmailKindName) {
    await this.prisma.belongingEmailTemplate.deleteMany({ where: { orgId, kind } });
    return { reset: true };
  }

  // ─── Buddy: the admin log (§5.5) ────────────────────────────

  @Get('belonging/buddy/pairings')
  @Roles('ADMIN')
  activePairs(@Param('orgId') orgId: string) {
    return this.log.pairings(orgId);
  }

  @Get('belonging/buddy/invitations')
  @Roles('ADMIN')
  invitations(@Param('orgId') orgId: string) {
    return this.log.invitations(orgId);
  }

  @Get('belonging/buddy/members')
  @Roles('ADMIN')
  memberSummary(@Param('orgId') orgId: string) {
    return this.log.memberSummary(orgId);
  }

  @Get('belonging/buddy/export.csv')
  @Roles('ADMIN')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="buddy-log.csv"')
  exportCsv(@Param('orgId') orgId: string, @Query('view') view?: string) {
    return this.log.csv(orgId, view === 'invitations' || view === 'members' ? view : 'pairings');
  }

  @Post('belonging/buddy/pairings/:pairingId/reassign')
  @Roles('ADMIN')
  reassign(
    @Param('orgId') orgId: string,
    @Param('pairingId', ParseUUIDPipe) pairingId: string,
    @Body() dto: ReassignPairingDto,
  ) {
    return this.log.reassign(orgId, pairingId, dto.buddyMemberId);
  }

  @Post('belonging/buddy/pairings/:pairingId/close')
  @Roles('ADMIN')
  closePairing(
    @Param('orgId') orgId: string,
    @Param('pairingId', ParseUUIDPipe) pairingId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ClosePairingDto,
  ) {
    return this.log.close(orgId, pairingId, user.userId, dto.reason);
  }

  @Post('belonging/buddy/pairings/:pairingId/search')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Look for a buddy again' })
  research(@Param('orgId') orgId: string, @Param('pairingId', ParseUUIDPipe) pairingId: string) {
    return this.log.searchAgain(orgId, pairingId);
  }

  // ─── Buddy: suggestions (§5.4) ──────────────────────────────

  @Get('belonging/buddy/suggestions')
  @Roles('ADMIN')
  listSuggestions(@Param('orgId') orgId: string) {
    return this.prisma.buddySuggestion.findMany({ where: { orgId }, orderBy: { position: 'asc' } });
  }

  @Post('belonging/buddy/suggestions')
  @Roles('ADMIN')
  async createSuggestion(@Param('orgId') orgId: string, @Body() dto: CreateSuggestionDto) {
    const last = await this.prisma.buddySuggestion.findFirst({
      where: { orgId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return this.prisma.buddySuggestion.create({
      data: { orgId, body: dto.body.trim(), position: (last?.position ?? -1) + 1 },
    });
  }

  @Patch('belonging/buddy/suggestions/:id')
  @Roles('ADMIN')
  async updateSuggestion(
    @Param('orgId') orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSuggestionDto,
  ) {
    const owned = await this.prisma.buddySuggestion.findFirst({ where: { id, orgId }, select: { id: true } });
    if (!owned) throw new NotFoundException('Suggestion not found');
    return this.prisma.buddySuggestion.update({ where: { id }, data: dto });
  }

  @Delete('belonging/buddy/suggestions/:id')
  @Roles('ADMIN')
  async deleteSuggestion(@Param('orgId') orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    const owned = await this.prisma.buddySuggestion.findFirst({ where: { id, orgId }, select: { id: true } });
    if (!owned) throw new NotFoundException('Suggestion not found');
    await this.prisma.buddySuggestion.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Buddy: what a member controls ──────────────────────────

  @Get('belonging/buddy/me')
  @ApiOperation({ summary: 'My buddy, my opt-out, and my suggestions if I am one' })
  async myBuddyState(@Param('orgId') orgId: string, @CurrentUser() user: RequestUser) {
    const me = await this.membership(orgId, user.userId);
    return this.log.forMember(orgId, me.id);
  }

  @Patch('belonging/buddy/me/opt-out')
  @BypassRequiredReading(
    'Turning off the emails that brought you here must never require agreeing to ' +
      'something first. The Off the Hook email links straight to this, and it would be ' +
      'a trap if that link led to a gate.',
  )
  async setOptOut(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SetBuddyOptOutDto,
  ) {
    const me = await this.membership(orgId, user.userId);
    return this.prisma.memberBuddyStats.upsert({
      where: { memberId: me.id },
      create: { memberId: me.id, optedOut: dto.optedOut },
      update: { optedOut: dto.optedOut },
    });
  }

  @Get('belonging/buddy/thread/:otherUserId/suggestions')
  @ApiOperation({ summary: 'Prompts for the buddy in this conversation, if I am one' })
  async threadSuggestions(
    @Param('orgId') orgId: string,
    @Param('otherUserId', ParseUUIDPipe) otherUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const me = await this.membership(orgId, user.userId);
    return this.log.suggestionsForThread(orgId, me.id, otherUserId);
  }

  @Post('belonging/buddy/suggestions/:id/dismiss')
  @BypassRequiredReading(
    'Hiding a prompt in your own message composer is a display preference, not a ' +
      'community write action, and blocking it would leave a chip somebody cannot get ' +
      'rid of on the screen they are being asked to use.',
  )
  async dismissSuggestion(
    @Param('orgId') orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const me = await this.membership(orgId, user.userId);
    const owned = await this.prisma.buddySuggestion.findFirst({ where: { id, orgId }, select: { id: true } });
    if (!owned) throw new NotFoundException('Suggestion not found');

    await this.prisma.buddySuggestionDismissal.upsert({
      where: { suggestionId_memberId: { suggestionId: id, memberId: me.id } },
      create: { suggestionId: id, memberId: me.id },
      update: {},
    });
    return { dismissed: true };
  }

  // ─── Knowledge Center (§6) ──────────────────────────────────

  @Get('welcome/articles')
  async listArticles(@Param('orgId') orgId: string, @CurrentUser() user: RequestUser) {
    const me = await this.membership(orgId, user.userId);
    return this.knowledge.list(orgId, me.id, me.role === 'ADMIN');
  }

  @Get('welcome/outstanding')
  @ApiOperation({ summary: 'What I still have to read, and how long I have' })
  async outstanding(@Param('orgId') orgId: string, @CurrentUser() user: RequestUser) {
    const me = await this.membership(orgId, user.userId);
    return this.knowledge.outstandingFor(orgId, me.id);
  }

  @Get('welcome/articles/:idOrSlug')
  async getArticle(
    @Param('orgId') orgId: string,
    @Param('idOrSlug') idOrSlug: string,
    @CurrentUser() user: RequestUser,
  ) {
    const me = await this.membership(orgId, user.userId);
    return this.knowledge.get(orgId, idOrSlug, me.id, me.role === 'ADMIN');
  }

  @Post('welcome/articles')
  @Roles('ADMIN')
  async createArticle(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateArticleDto,
  ) {
    const me = await this.membership(orgId, user.userId);
    return this.knowledge.create(orgId, me.id, dto);
  }

  @Patch('welcome/articles/:articleId')
  @Roles('ADMIN')
  updateArticle(
    @Param('orgId') orgId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.knowledge.update(orgId, articleId, dto);
  }

  @Post('welcome/articles/:articleId/publish')
  @Roles('ADMIN')
  publishArticle(@Param('orgId') orgId: string, @Param('articleId', ParseUUIDPipe) articleId: string) {
    return this.knowledge.publish(orgId, articleId);
  }

  @Post('welcome/articles/:articleId/unpublish')
  @Roles('ADMIN')
  unpublishArticle(@Param('orgId') orgId: string, @Param('articleId', ParseUUIDPipe) articleId: string) {
    return this.knowledge.unpublish(orgId, articleId);
  }

  @Post('welcome/articles/reorder')
  @Roles('ADMIN')
  reorderArticles(@Param('orgId') orgId: string, @Body() dto: ReorderArticlesDto) {
    return this.knowledge.reorder(orgId, dto.orderedIds);
  }

  @Delete('welcome/articles/:articleId')
  @Roles('ADMIN')
  deleteArticle(@Param('orgId') orgId: string, @Param('articleId', ParseUUIDPipe) articleId: string) {
    return this.knowledge.remove(orgId, articleId);
  }

  @Post('welcome/articles/:articleId/cover')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Put a cover image on an article' })
  uploadCover(
    @Param('orgId') orgId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Body() dto: UploadCoverDto,
  ) {
    return this.knowledge.replaceCover(orgId, articleId, dto.data, dto.mimeType);
  }

  @Delete('welcome/articles/:articleId/cover')
  @Roles('ADMIN')
  removeCover(
    @Param('orgId') orgId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
  ) {
    return this.knowledge.removeCover(orgId, articleId);
  }

  @Get('welcome/articles/:articleId/compliance')
  @Roles('ADMIN')
  compliance(@Param('orgId') orgId: string, @Param('articleId', ParseUUIDPipe) articleId: string) {
    return this.knowledge.compliance(orgId, articleId);
  }

  @Post('welcome/articles/:articleId/remind')
  @Roles('ADMIN')
  remind(@Param('orgId') orgId: string, @Param('articleId', ParseUUIDPipe) articleId: string) {
    return this.knowledge.remind(orgId, articleId);
  }

  @Post('welcome/articles/:articleId/acknowledge')
  @BypassRequiredReading(
    'Agreeing is the way out of the gate. Gating it would mean a member could never ' +
      'satisfy the requirement that is blocking them — the one bypass without which ' +
      'the whole feature is a locked door.',
  )
  async acknowledge(
    @Param('orgId') orgId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ) {
    const me = await this.membership(orgId, user.userId);
    // Recorded because an agreement a co-op might one day have to stand
    // behind should say where it came from, not only who and when.
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.socket?.remoteAddress ??
      null;
    return this.knowledge.acknowledge(orgId, articleId, me.id, ip);
  }

  @Post('welcome/articles/:articleId/like')
  async like(
    @Param('orgId') orgId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const me = await this.membership(orgId, user.userId);
    return this.knowledge.toggleLike(orgId, articleId, me.id);
  }

  @Post('welcome/articles/:articleId/comments')
  async addComment(
    @Param('orgId') orgId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ArticleCommentDto,
  ) {
    const me = await this.membership(orgId, user.userId);
    return this.knowledge.comment(orgId, articleId, me.id, dto.body);
  }

  @Delete('welcome/comments/:commentId')
  async deleteComment(
    @Param('orgId') orgId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const me = await this.membership(orgId, user.userId);
    return this.knowledge.removeComment(orgId, commentId, me.id, me.role === 'ADMIN');
  }
}
