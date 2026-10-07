import { Module } from '@nestjs/common';
import { MemberService } from './member.service';
import { LedgerService } from './ledger.service';
import { MemberProfileService } from './member-profile.service';
import { LedgerController } from './ledger.controller';
import { MemberController } from './member.controller';
import { InviteController } from './invite.controller';
import { StripeModule } from '../stripe/stripe.module';
import { BelongingModule } from '../belonging/belonging.module';
import { EmailModule } from '../email/email.module';
import { StorageModule } from '../storage/storage.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  // PlatformModule for the audit log: changing the address a magic link is
  // sent to is an escalation, and it leaves a line (MEM-25).
  imports: [EmailModule, StripeModule, StorageModule, BelongingModule, PlatformModule],
  controllers: [MemberController, InviteController, LedgerController],
  providers: [MemberService, LedgerService, MemberProfileService],
  exports: [MemberService],
})
export class MemberModule {}
