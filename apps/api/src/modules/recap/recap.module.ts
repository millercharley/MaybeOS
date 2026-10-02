import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { ImpactModule } from '../impact/impact.module';
import { ServiceModule } from '../service/service.module';
import { StripeModule } from '../stripe/stripe.module';
import { RecapController } from './recap.controller';
import { RecapService } from './recap.service';

/**
 * The monthly recap (RCP-01).
 *
 * It reads from three other modules rather than recomputing what they own:
 * impact figures already clear the suppression floor, service hours are
 * already valued the way D-032 requires, and dues payments are recorded by
 * the Stripe webhook. A recap that did its own arithmetic over the same rows
 * would be a second answer to every question.
 */
@Module({
  imports: [EmailModule, ImpactModule, ServiceModule, StripeModule],
  controllers: [RecapController],
  providers: [RecapService],
  exports: [RecapService],
})
export class RecapModule {}
