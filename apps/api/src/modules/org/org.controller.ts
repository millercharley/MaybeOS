import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  ParseUUIDPipe,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { OrgService } from './org.service';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';
import { UploadLogoDto } from './dto/upload-logo.dto';

@ApiTags('orgs')
@Controller('orgs')
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new organization' })
  create(@Body() dto: CreateOrgDto, @CurrentUser() user: RequestUser) {
    return this.orgService.create(dto, user.userId);
  }

  @Get('by-slug/:slug')
  @ApiOperation({ summary: 'Get organization by slug (public)' })
  findBySlug(@Param('slug') slug: string) {
    return this.orgService.findBySlug(slug);
  }

  @Get(':orgId')
  @ApiOperation({ summary: 'Get organization details' })
  findById(@Param('orgId') orgId: string) {
    return this.orgService.findById(orgId);
  }

  @Patch(':orgId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update organization' })
  update(@Param('orgId') orgId: string, @Body() dto: UpdateOrgDto) {
    return this.orgService.update(orgId, dto);
  }

  @Post(':orgId/logo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Replace the organization's logo" })
  uploadLogo(@Param('orgId') orgId: string, @Body() dto: UploadLogoDto) {
    return this.orgService.replaceLogo(orgId, dto.data, dto.mimeType);
  }

  @Delete(':orgId/logo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove the organization's logo" })
  deleteLogo(@Param('orgId') orgId: string) {
    return this.orgService.removeLogo(orgId);
  }

  @Get(':orgId/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get organization settings' })
  getSettings(@Param('orgId') orgId: string) {
    return this.orgService.getSettings(orgId);
  }

  @Patch(':orgId/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update organization settings' })
  updateSettings(
    @Param('orgId') orgId: string,
    @Body() settings: Record<string, unknown>,
  ) {
    return this.orgService.updateSettings(orgId, settings);
  }

  /* ─── Locations (ORG-01) ────────────────────────────────────── */

  @Get(':orgId/locations')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Where the co-op is' })
  listLocations(@Param('orgId') orgId: string) {
    return this.orgService.listLocations(orgId);
  }

  @Post(':orgId/locations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a location to the organization' })
  addLocation(@Param('orgId') orgId: string, @Body() dto: CreateLocationDto) {
    return this.orgService.addLocation(orgId, dto);
  }

  @Patch(':orgId/locations/:locationId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  updateLocation(
    @Param('orgId') orgId: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.orgService.updateLocation(orgId, locationId, dto);
  }

  /** Refused while anything still names it — see the service. */
  @Delete(':orgId/locations/:locationId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  removeLocation(
    @Param('orgId') orgId: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    return this.orgService.removeLocation(orgId, locationId);
  }
}
