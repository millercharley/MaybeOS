import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { MetaGraphService } from './meta-graph.service';
import { SocialService } from './social.service';
import { EventShareController, SocialAdminController } from './social.controller';
import { MetaCallbackController } from './meta-callback.controller';

/** Sharing public events to a co-op's Facebook Page and Instagram (SOC-01). */
@Module({
  imports: [StorageModule],
  controllers: [SocialAdminController, EventShareController, MetaCallbackController],
  providers: [SocialService, MetaGraphService],
})
export class SocialModule {}
