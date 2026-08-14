import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { StripeService } from './stripe.service';
import { ConnectService } from './connect.service';
import { StripeController } from './stripe.controller';
import { ConnectController } from './connect.controller';
import { ConnectOAuthController } from './connect-oauth.controller';

@Module({
  imports: [CalendarModule],
  controllers: [StripeController, ConnectController, ConnectOAuthController],
  providers: [StripeService, ConnectService],
  exports: [StripeService, ConnectService],
})
export class StripeModule {}
