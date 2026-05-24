import { Module } from '@nestjs/common';
import { MemberService } from './member.service';
import { MemberController } from './member.controller';
import { InviteController } from './invite.controller';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [MemberController, InviteController],
  providers: [MemberService],
  exports: [MemberService],
})
export class MemberModule {}
