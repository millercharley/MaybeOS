import { Module } from '@nestjs/common';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { OrgModule } from '../org/org.module';
import { EventsModule } from '../events/events.module';
import { SpaceModule } from '../space/space.module';
import { MemberModule } from '../member/member.module';
import { DoorModule } from '../door/door.module';
import { ServiceModule } from '../service/service.module';
import { RadarModule } from '../radar/radar.module';
import { TeachingModule } from '../teaching/teaching.module';

/**
 * The member dashboard's one endpoint (OPS-46).
 *
 * It imports eight modules and is imported by none of them, which is why
 * there is a module here at all rather than eight more constructor arguments
 * on `OrgModule`: `OrgModule` is imported across the API, and giving it a
 * dependency on Events, Space, Member, Door, Service, Radar and Teaching
 * would put a cycle one future import away. A leaf can depend on everything
 * safely; the busiest module in the API cannot.
 */
@Module({
  imports: [
    OrgModule,
    EventsModule,
    SpaceModule,
    MemberModule,
    DoorModule,
    ServiceModule,
    RadarModule,
    TeachingModule,
  ],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
