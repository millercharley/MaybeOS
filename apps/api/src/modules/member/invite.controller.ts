import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { MemberService } from './member.service';

@ApiTags('invites')
@Controller('invites')
export class InviteController {
  constructor(private readonly memberService: MemberService) {}

  @Get()
  @ApiOperation({ summary: 'Get invitation details by token (public)' })
  @ApiQuery({ name: 'token', required: true, type: String })
  getInvite(@Query('token') token: string) {
    return this.memberService.getInviteByToken(token);
  }

  @Post('accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept an invitation (authenticated)' })
  @ApiQuery({ name: 'token', required: true, type: String })
  @ApiQuery({
    name: 'tier',
    required: false,
    type: String,
    description:
      'Tier the invitee chose, when the invitation left the choice to them (MEM-15). Ignored if the invitation already names a tier.',
  })
  acceptInvite(
    @Query('token') token: string,
    @CurrentUser() user: RequestUser,
    @Query('tier') tier?: string,
  ) {
    return this.memberService.acceptInvite(token, user.userId, tier);
  }
}
