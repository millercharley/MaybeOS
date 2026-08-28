import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { EmailModule } from '../email/email.module';
import { BelongingSettingsService } from './belonging-settings.service';
import { BuddyService } from './buddy.service';
import { BuddyLogService } from './buddy-log.service';
import { KnowledgeService } from './knowledge.service';
import { BelongingController } from './belonging.controller';
import { BuddyPublicController } from './buddy-public.controller';

/**
 * Belonging Support (PRD, BEL-01…).
 *
 * Two tools that share one idea: a new member should not have to work out on
 * their own who to talk to or what this place expects of them.
 */
@Module({
  imports: [EmailModule],
  controllers: [BelongingController, BuddyPublicController],
  providers: [
    PrismaService,
    BelongingSettingsService,
    BuddyService,
    BuddyLogService,
    KnowledgeService,
  ],
  exports: [BelongingSettingsService, BuddyService, KnowledgeService],
})
export class BelongingModule {}
