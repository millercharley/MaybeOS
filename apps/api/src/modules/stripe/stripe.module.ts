import { PublicPricingController } from './public-pricing.controller';
import { PublicPricingService } from './public-pricing.service';
import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
// The webhook tells a ticket buyer they bought a ticket (EVT-46). One-way:
// TicketPassModule imports nothing from here.
import { TicketPassModule } from '../events/ticket-pass.module';
import { StripeService } from './stripe.service';
import { ConnectService } from './connect.service';
import { AdoptionScanService } from './adoption-scan.service';
import { StripeController } from './stripe.controller';
import { ConnectController } from './connect.controller';
import { ConnectOAuthController } from './connect-oauth.controller';
import { AdoptionController } from './adoption.controller';

@Module({
  imports: [CalendarModule, TicketPassModule],
  controllers: [StripeController, ConnectController, ConnectOAuthController, AdoptionController, PublicPricingController],
  providers: [StripeService, ConnectService, AdoptionScanService, PublicPricingService],
  exports: [StripeService, ConnectService, AdoptionScanService],
})
export class StripeModule {}
