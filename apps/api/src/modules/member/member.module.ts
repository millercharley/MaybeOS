import { Module } from '@nestjs/common';
import { MemberService } from './member.service';
import { MemberController } from './member.controller';
import { InviteController } from './invite.controller';
import { StripeModule } from '../stripe/stripe.module';
import { EmailModule } from '../email/email.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [EmailModule, StripeModule, StorageModule],
  controllers: [MemberController, InviteController],
  providers: [MemberService],
  exports: [MemberService],
})
export class MemberModule {}
