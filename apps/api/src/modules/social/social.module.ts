import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { MetaGraphService } from './meta-graph.service';
import { SocialService } from './social.service';
import { WeeklyPostService } from './weekly-post.service';
import { SocialAdminController } from './social.controller';
import { MetaCallbackController } from './meta-callback.controller';

/**
 * The co-op's Facebook Page and Instagram connection (SOC-01, SOC-04).
 *
 * Members sharing their own events was removed in SOC-04 — in the two months
 * it existed not one member used it. What stays is the connection itself,
 * which the weekly co-op post is built on.
 */
@Module({
  imports: [StorageModule],
  controllers: [SocialAdminController, MetaCallbackController],
  providers: [SocialService, MetaGraphService, WeeklyPostService],
  exports: [WeeklyPostService],
})
export class SocialModule {}
