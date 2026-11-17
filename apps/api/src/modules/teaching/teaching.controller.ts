import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { CreateEventDto } from '../events/dto/create-event.dto';
import { TeachingService } from './teaching.service';
import {
  CreateOfferingDto,
  OfferingInterestDto,
  UpdateOfferingDto,
} from './dto/offering.dto';

/**
 * Whether somebody runs this co-op.
 *
 * The same helper the events controller carries, for the same reason: almost
 * nothing here is decided by a role. "The teacher, or whoever wrote it up, or
 * an organiser" is not a role, so the routes pass an *actor* and the service
 * decides — see `offering-control.ts`.
 */
function isStaff(user: RequestUser, orgId: string): boolean {
  if (user.globalRole === 'PLATFORM_ADMIN') return true;
  const role = user.orgRoles?.[orgId];
  return role === 'ADMIN' || role === 'STAFF';
}

@ApiTags('teaching')
@Controller()
export class TeachingController {
  constructor(private readonly teaching: TeachingService) {}

  /* ─── Inside a co-op ───────────────────────────────────────── */

  @Get('orgs/:orgId/teaching')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'What this co-op teaches, as this member may see it' })
  async list(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.teaching.listForOrg(orgId, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  /**
   * Any member may offer to teach something (TCH-01).
   *
   * Not `@Roles`: a co-op where only organisers may say what they teach is
   * not the feature Charley asked for. `teachingEnabled` is the switch, and
   * it lives in the service.
   */
  @Post('orgs/:orgId/teaching')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Offer to teach something' })
  async create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateOfferingDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.teaching.create(orgId, dto, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  @Get('orgs/:orgId/teaching/:slug')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'One offering' })
  async getOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('slug') slug: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.teaching.getForOrg(orgId, slug, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  /** Not `@Roles`: the answer is not a role (EVT-50). The service decides. */
  @Patch('orgs/:orgId/teaching/:id')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change an offering' })
  async update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfferingDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.teaching.update(orgId, id, dto, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  @Delete('orgs/:orgId/teaching/:id')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove an offering; its dates survive as events' })
  async remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.teaching.remove(orgId, id, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  @Post('orgs/:orgId/teaching/:id/sessions')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Put a date on a workshop; it becomes an event' })
  async addSession(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEventDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.teaching.addSession(orgId, id, dto, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  @Post('orgs/:orgId/teaching/:id/interest')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tell the teacher you are interested' })
  async registerInterest(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OfferingInterestDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.teaching.registerInterest(orgId, id, dto, user.userId);
  }

  @Get('orgs/:orgId/teaching/:id/interest')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Who has put their hand up' })
  async listInterest(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.teaching.listInterest(orgId, id, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  /**
   * The conversation about this offering, which lives in #Teaching (CMN-22).
   *
   * Two routes, as on the events side and for the same reason: reading must
   * not create. `GET` answers with whatever thread exists, and `POST` makes
   * one — called by the first comment, never by opening the page.
   */
  @Get('orgs/:orgId/teaching/:id/thread')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The post carrying this offering’s discussion' })
  async thread(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.teaching.thread(orgId, id, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  @Post('orgs/:orgId/teaching/:id/thread')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get or create the post carrying the discussion' })
  async startThread(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.teaching.startThread(orgId, id, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  /* ─── The open web ─────────────────────────────────────────── */

  /**
   * Public offerings, for the standalone page and the embed (TCH-01).
   *
   * Unguarded, like every other public and embed route: the whole point is a
   * visitor with no account. What keeps them safe is what they answer —
   * `PUBLIC_OFFERING_SELECT` carries the teacher's name and picture and
   * nothing else about them, no interest notes, and no counts. Pinned by
   * `public-offering-fields.spec.ts`.
   *
   * Both listed in `unauthenticated-routes.spec.ts` with their reasoning.
   */
  @Get('public/teaching/:orgSlug')
  @Header('Cache-Control', 'public, max-age=300, s-maxage=300')
  @ApiOperation({ summary: 'What a co-op teaches, for somebody with no account' })
  async publicList(@Param('orgSlug') orgSlug: string) {
    return this.teaching.listPublic(orgSlug);
  }

  /**
   * The same payload, for `embed.js` on somebody else's website.
   *
   * `Access-Control-Allow-Origin: *` explicitly, because the app-wide CORS is
   * an origin allowlist with credentials — an embed pasted into Webflow is
   * exactly the caller that allowlist is designed to refuse.
   */
  @Get('embed/:orgSlug/teaching')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=300, s-maxage=300')
  @ApiOperation({ summary: 'Public teaching offerings for the website embed' })
  async embed(@Param('orgSlug') orgSlug: string) {
    return this.teaching.listEmbed(orgSlug);
  }
}
