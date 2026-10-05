import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { SupportService } from './support.service';
import {
  CreateSupportArticleDto,
  SupportImageDto,
  UpdateSupportArticleDto,
} from './dto/support-article.dto';

/** Whether this reader may write the documentation, as opposed to read it. */
function isPlatformAdmin(user: RequestUser): boolean {
  return user.globalRole === 'PLATFORM_ADMIN';
}

/**
 * MaybeOS's own documentation (PLT-05).
 *
 * Charley: "All Admins should see this documentation... make sure that I, as
 * a Super Admin, can edit the articles and add additional screenshots."
 *
 * So reading needs only a signed-in account and writing needs
 * `PLATFORM_ADMIN`, which is why the guard sits on the write routes
 * individually rather than on the controller: a controller-level
 * `PlatformAdminGuard` would lock out the four hundred organisers this is
 * written for.
 *
 * No `orgId` anywhere in these paths, because the articles belong to no
 * co-op. That is the difference from the handbook, and it is deliberate.
 */
@ApiTags('support')
@Controller('support')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('articles')
  @ApiOperation({ summary: "MaybeOS's documentation, for any signed-in organiser" })
  list(@CurrentUser() user: RequestUser) {
    return this.support.list(isPlatformAdmin(user));
  }

  @Get('articles/:slug')
  @ApiOperation({ summary: 'One article' })
  get(@Param('slug') slug: string, @CurrentUser() user: RequestUser) {
    return this.support.get(slug, isPlatformAdmin(user));
  }

  // ─── Writing: platform administrators only ────────────────────

  @Post('articles')
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Write a new article' })
  create(@Body() dto: CreateSupportArticleDto, @CurrentUser() user: RequestUser) {
    return this.support.create(user.userId, dto);
  }

  @Patch('articles/:id')
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Change an article' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupportArticleDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.support.update(id, user.userId, dto);
  }

  @Delete('articles/:id')
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Remove an article and its screenshots' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.remove(id);
  }

  @Post('articles/:id/images')
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Add a screenshot to an article' })
  addImage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportImageDto) {
    return this.support.addImage(id, dto.data, dto.mimeType, dto.caption);
  }

  @Delete('articles/:id/images/:imageId')
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Remove a screenshot' })
  removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.support.removeImage(id, imageId);
  }

  /**
   * Put any newly shipped articles into the database.
   *
   * By slug and never overwriting, so it is safe to press at any time — and
   * it is the one write here a platform admin might want on demand, after a
   * deploy that added an article.
   */
  @Post('seed')
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Add any documentation shipped since last time' })
  seed() {
    return this.support.seed();
  }
}
