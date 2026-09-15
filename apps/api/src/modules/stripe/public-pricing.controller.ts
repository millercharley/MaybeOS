import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicPricingService } from './public-pricing.service';

/**
 * MaybeOS's own prices, for the landing page (WEB-02). Public: these are the
 * prices anyone is offered, and they carry nothing about any co-op.
 */
@ApiTags('pricing')
@Controller('pricing')
export class PublicPricingController {
  constructor(private readonly pricing: PublicPricingService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=900')
  @ApiOperation({ summary: 'MaybeOS plan prices and transaction fees' })
  get() {
    return this.pricing.pricing();
  }
}
