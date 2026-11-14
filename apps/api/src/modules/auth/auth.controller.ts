import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Request,
  Patch,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MagicLinkDto } from './dto/magic-link.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RESET_REQUESTED_MESSAGE } from './password-reset';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UploadAvatarDto } from './dto/upload-avatar.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user account' })
  async register(@Body() dto: RegisterDto) {
    const user = await this.authService.register(dto.email, dto.password, dto.name);
    return this.authService.login(user as any);
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Log in with email and password' })
  async login(@Body() _dto: LoginDto, @Request() req: any) {
    return this.authService.login(req.user);
  }

  @Post('magic-link')
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Request a magic link for passwordless login' })
  async sendMagicLink(@Body() dto: MagicLinkDto) {
    // The token is deliberately not bound to a variable and never returned:
    // it is a working credential, and echoing it would make the endpoint its
    // own bypass. Delivery is the email module's job.
    await this.authService.sendMagicLink(dto.email);
    return { message: 'If an account exists, a magic link has been sent.' };
  }

  @Get('magic-link/verify')
  @ApiOperation({ summary: 'Verify a magic link token and receive a JWT' })
  @ApiQuery({ name: 'token', required: true, description: 'Magic link token' })
  async verifyMagicLink(@Query('token') token: string) {
    const user = await this.authService.validateMagicLink(token);
    return this.authService.login(user as any);
  }

  /**
   * "I forgot my password" (AUTH-09).
   *
   * Three per minute, the same as a magic link, and for the same reason: this
   * endpoint causes mail to be sent to an address the caller chose, so an
   * unthrottled version is a way to use MaybeOS to pester somebody.
   *
   * One answer for every address. The service sends nothing for an unknown
   * one and swallows a send failure rather than letting it become a 500, so
   * there is no shape of response that says whether an account exists.
   */
  @Post('password-reset')
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Ask for a link to set a new password' })
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    await this.authService.requestPasswordReset(dto.email);
    return { message: RESET_REQUESTED_MESSAGE };
  }

  /**
   * Whether the emailed link is still good, before the form asks for a
   * password (AUTH-09).
   *
   * Public because the whole point is that nobody is signed in yet, and
   * harmless because it needs the token to ask: a holder learns only what
   * redeeming it would have told them. What it buys is a member not typing a
   * new password twice into a form that was always going to refuse it.
   */
  @Get('password-reset/check')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Whether a password-reset link can still be used' })
  @ApiQuery({ name: 'token', required: true, description: 'Token from the emailed link' })
  async checkPasswordReset(@Query('token') token: string) {
    return { usable: await this.authService.passwordResetIsUsable(token ?? '') };
  }

  /**
   * Set the new password (AUTH-09).
   *
   * No session is returned on purpose. Somebody who has just set a password
   * should prove they know it, and the form sends them to sign in with it —
   * which also means a leaked reset link cannot be turned into a session
   * without the attacker choosing a password the owner would then notice
   * failing. The `password-set` notice goes out either way.
   */
  @Post('password-reset/confirm')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Redeem a password-reset link and set the password' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Refresh JWT with current org roles' })
  async refreshToken(@CurrentUser() user: RequestUser) {
    return this.authService.refreshToken(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user profile' })
  async getProfile(@CurrentUser() user: RequestUser) {
    return this.authService.getProfile(user.userId);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update your own name or avatar' })
  async updateProfile(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.userId, dto);
  }

  /**
   * Replace the letter in the circle with a photo of yourself (MEM-11).
   *
   * Keyed on the caller's own id, never one from the URL or the body, so there
   * is no shape of this request that sets somebody else's picture.
   */
  @Post('profile/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload your own profile photo' })
  async uploadAvatar(
    @CurrentUser() user: RequestUser,
    @Body() dto: UploadAvatarDto,
  ) {
    return this.authService.setAvatar(user.userId, dto.data, dto.mimeType);
  }

  @Delete('profile/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove your profile photo' })
  async removeAvatar(@CurrentUser() user: RequestUser) {
    return this.authService.removeAvatar(user.userId);
  }

  /**
   * Rate-limited like the login routes: this endpoint takes a password and
   * says whether it was right, which is a guessing oracle if left open.
   */
  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change your own password' })
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
