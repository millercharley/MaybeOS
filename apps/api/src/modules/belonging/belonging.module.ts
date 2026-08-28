import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { EmailModule } from '../email/email.module';
import { BelongingSettingsService } from './belonging-settings.service';
import { BuddyService } from './buddy.service';

/**
 * Belonging Support (PRD, BEL-01…).
 *
 * Two tools that share one idea: a new member should not have to work out on
 * their own who to talk to or what this place expects of them.
 */
@Module({
  imports: [EmailModule],
  providers: [PrismaService, BelongingSettingsService, BuddyService],
  exports: [BelongingSettingsService, BuddyService],
})
export class BelongingModule {}
