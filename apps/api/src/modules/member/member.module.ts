import { Module } from '@nestjs/common';
import { MemberService } from './member.service';
import { LedgerService } from './ledger.service';
import { LedgerController } from './ledger.controller';
import { MemberController } from './member.controller';
import { InviteController } from './invite.controller';
import { StripeModule } from '../stripe/stripe.module';
import { BelongingModule } from '../belonging/belonging.module';
import { EmailModule } from '../email/email.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [EmailModule, StripeModule, StorageModule, BelongingModule],
  controllers: [MemberController, InviteController, LedgerController],
  providers: [MemberService, LedgerService],
  exports: [MemberService],
})
export class MemberModule {}
