import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { MemberService } from './member.service';
import { CreateTierDto } from './dto/create-tier.dto';
import { InviteMemberDto } from './dto/invite-member.dto';

@ApiTags('members')
@Controller('orgs/:orgId')
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  // ─── Members ────────────────────────────────────────────────

  @Get('members')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List members of an organization' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  listMembers(
    @Param('orgId') orgId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(20), ParseIntPipe) perPage: number,
    @Query('search') search?: string,
  ) {
    return this.memberService.listMembers(orgId, page, perPage, search);
  }

  @Get('members/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single member detail' })
  getMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
  ) {
    return this.memberService.getMember(orgId, userId);
  }

  @Patch('members/:userId/role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a member role' })
  updateMemberRole(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body('role') role: string,
  ) {
    return this.memberService.updateMemberRole(orgId, userId, role);
  }

  @Delete('members/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a member from the organization' })
  removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
  ) {
    return this.memberService.removeMember(orgId, userId);
  }

  @Post('members/invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invite a member by email' })
  inviteMember(
    @Param('orgId') orgId: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.memberService.inviteMember(orgId, dto.email, dto.role || 'MEMBER', user.userId);
  }

  @Get('invitations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List invitations for an organization' })
  listInvitations(@Param('orgId') orgId: string) {
    return this.memberService.listInvitations(orgId);
  }

  @Post('members/import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk import members from CSV data' })
  importMembers(
    @Param('orgId') orgId: string,
    @Body() csvData: Array<{ email: string; name?: string; tier?: string }>,
  ) {
    return this.memberService.importMembers(orgId, csvData);
  }

  // ─── Tiers ─────────────────────────────────────────────────

  @Post('tiers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a membership tier' })
  createTier(
    @Param('orgId') orgId: string,
    @Body() dto: CreateTierDto,
  ) {
    return this.memberService.createTier(orgId, dto);
  }

  @Get('tiers')
  @ApiOperation({ summary: 'List active membership tiers (public, for join page)' })
  listTiers(@Param('orgId') orgId: string) {
    return this.memberService.listTiers(orgId);
  }

  @Patch('tiers/:tierId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a membership tier' })
  updateTier(
    @Param('orgId') orgId: string,
    @Param('tierId') tierId: string,
    @Body() dto: Partial<CreateTierDto>,
  ) {
    return this.memberService.updateTier(orgId, tierId, dto);
  }
}
