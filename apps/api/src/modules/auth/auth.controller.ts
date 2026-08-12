import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Request,
  Patch,
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
    const token = await this.authService.sendMagicLink(dto.email);
    // The actual email sending is delegated to the email module.
    // In a real implementation, the token would be embedded in a URL
    // and sent via email. Here we return a confirmation message.
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
}
