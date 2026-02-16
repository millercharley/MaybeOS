import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { OrgService } from './org.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';

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

  @Post(':orgId/locations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a location to the organization' })
  addLocation(
    @Param('orgId') orgId: string,
    @Body() dto: { name: string; address?: string; city?: string; state?: string; zip?: string; country?: string; timezone?: string },
  ) {
    return this.orgService.addLocation(orgId, dto);
  }
}
