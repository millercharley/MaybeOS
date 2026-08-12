import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { ConnectService } from './connect.service';
import { StripeController } from './stripe.controller';
import { ConnectController } from './connect.controller';

@Module({
  controllers: [StripeController, ConnectController],
  providers: [StripeService, ConnectService],
  exports: [StripeService, ConnectService],
})
export class StripeModule {}
