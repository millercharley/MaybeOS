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
