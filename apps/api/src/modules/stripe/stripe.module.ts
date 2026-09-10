import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { StripeService } from './stripe.service';
import { ConnectService } from './connect.service';
import { AdoptionScanService } from './adoption-scan.service';
import { StripeController } from './stripe.controller';
import { ConnectController } from './connect.controller';
import { ConnectOAuthController } from './connect-oauth.controller';
import { AdoptionController } from './adoption.controller';

@Module({
  imports: [CalendarModule],
  controllers: [StripeController, ConnectController, ConnectOAuthController, AdoptionController],
  providers: [StripeService, ConnectService, AdoptionScanService],
  exports: [StripeService, ConnectService, AdoptionScanService],
})
export class StripeModule {}
