import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
} from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { EmailHealthIndicator } from './email.health';
import { StorageHealthIndicator } from './storage.health';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private emailHealth: EmailHealthIndicator,
    private storageHealth: StorageHealthIndicator,
  ) {}

  @Get()
  @SkipThrottle()
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness + readiness probe' })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      // Reported, never failed: a deployment that cannot send email is still
      // serving requests, and taking it out of rotation would be worse than
      // the silence this exists to break.
      () => this.emailHealth.isHealthy('email'),
      // Same rule: reported, never failed. A revoked storage key breaks
      // attachments and avatars silently, because both paths swallow their
      // failures by design (MEM-10).
      () => this.storageHealth.isHealthy('storage'),
    ]);
  }
}
