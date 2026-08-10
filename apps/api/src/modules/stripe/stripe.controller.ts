import {
  Controller,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { StripeService } from './stripe.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CreateBillingPortalDto } from './dto/create-billing-portal.dto';
import { PrismaService } from '../../config/prisma.service';

/**
 * NOTE: The POST /stripe/webhooks endpoint requires raw body parsing.
 * In main.ts, enable raw body support on the NestJS app:
 *
 *   const app = await NestFactory.create(AppModule, { rawBody: true });
 *
 * This ensures `req.rawBody` is available for Stripe signature verification.
 */

@ApiTags('stripe')
@Controller()
export class StripeController {
  private readonly logger = new Logger(StripeController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly prisma: PrismaService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Checkout
  // ──────────────────────────────────────────────────────────────

  @Post('orgs/:orgId/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe Checkout session for a membership tier' })
  async createCheckoutSession(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCheckoutDto,
  ) {
    const url = await this.stripeService.createCheckoutSession(
      orgId,
      user.userId,
      dto.tierId,
      dto.successUrl,
      dto.cancelUrl,
      dto.amountCents,
    );

    return { url };
  }

  // ──────────────────────────────────────────────────────────────
  // Billing Portal
  // ──────────────────────────────────────────────────────────────

  @Post('orgs/:orgId/billing-portal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe Billing Portal session' })
  async createBillingPortalSession(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBillingPortalDto,
  ) {
    // Look up the user's Stripe customer ID for this org
    const userOrg = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId: user.userId, orgId } },
    });

    if (!userOrg?.stripeCustomerId) {
      return { error: 'No billing account found for this organization membership' };
    }

    const url = await this.stripeService.createBillingPortalSession(
      userOrg.stripeCustomerId,
      dto.returnUrl,
    );

    return { url };
  }

  // ──────────────────────────────────────────────────────────────
  // Webhook
  // ──────────────────────────────────────────────────────────────

  @Post('stripe/webhooks')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook handler (no auth — verified by signature)' })
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string,
  ) {
    // rawBody is available when NestJS is configured with { rawBody: true }
    const rawBody = req.rawBody;

    if (!rawBody) {
      // A misconfiguration, not a bad request from Stripe. Raising a 500 means
      // Stripe keeps retrying while we fix it, rather than us quietly
      // discarding real payment events.
      this.logger.error(
        'Raw body not available. Ensure the app is created with { rawBody: true }.',
      );
      throw new InternalServerErrorException(
        'Webhook receiver misconfigured: raw body unavailable',
      );
    }

    // Deliberately not wrapped in try/catch. Exceptions belong to
    // GlobalExceptionFilter, which maps a signature failure to 400 and any
    // processing failure to 500 — and reports the 5xx to Sentry. The previous
    // version caught everything and answered 400, so a database error during
    // subscription activation looked like Stripe had sent a malformed request
    // and never reached error tracking.
    //
    // Any non-2xx tells Stripe to retry, which is what we want for a genuine
    // processing failure; the transaction in handleWebhook guarantees the
    // retry sees clean state.
    return this.stripeService.handleWebhook(rawBody, signature);
  }
}
