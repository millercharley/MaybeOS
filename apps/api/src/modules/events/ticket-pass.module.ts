import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { TicketPassController } from './ticket-pass.controller';
import { TicketPassService } from './ticket-pass.service';

/**
 * Ticket confirmations and door passes (EVT-46).
 *
 * Its own module rather than part of `EventsModule`, and that is structural
 * rather than tidiness: `EventsModule` imports `StripeModule`, and the Stripe
 * webhook is what needs to send a confirmation. Putting this service in
 * `EventsModule` would make the two import each other.
 *
 * It depends on nothing but Prisma (global) and email, so the direction stays
 * one-way: Stripe and the scheduler both reach in here, and this reaches back
 * into neither.
 */
@Module({
  imports: [EmailModule],
  controllers: [TicketPassController],
  providers: [TicketPassService],
  exports: [TicketPassService],
})
export class TicketPassModule {}
