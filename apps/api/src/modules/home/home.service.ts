import { Injectable, Logger } from '@nestjs/common';
import { DashboardService } from '../org/dashboard.service';
import { EventsService } from '../events/events.service';
import { SpaceService } from '../space/space.service';
import { MemberService } from '../member/member.service';
import { DoorService } from '../door/door.service';
import { ServiceService } from '../service/service.service';
import { RadarService } from '../radar/radar.service';
import { TeachingService } from '../teaching/teaching.service';
import {
  MEMBER_HOME_SECTIONS,
  isUnavailable,
  settleSections,
  type SectionName,
} from './member-home';

export interface HomeViewer {
  userId: string;
  isStaff: boolean;
}

/**
 * The member dashboard's ten panels, answered together (OPS-46).
 *
 * This module composes the existing services; it owns no queries of its own.
 * That is deliberate and it is the only reason the change is safe: the seats
 * arithmetic in `events.service.ts`, the visibility scoping, the door's
 * reconciliation state, the roster's definition of a member — every one of
 * those is a rule somebody got wrong once and fixed in one place. A second
 * copy here would be correct on the day it was written and wrong within a
 * month, and nobody would know which copy a member was reading.
 *
 * The ten routes it composes all stay. Each is used somewhere else — the
 * portal's events page, My RSVPs, My Bookings, the teaching page — and this
 * is an extra way to ask, not a replacement. Nothing is removed.
 */
@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private readonly dashboard: DashboardService,
    private readonly events: EventsService,
    private readonly space: SpaceService,
    private readonly members: MemberService,
    private readonly door: DoorService,
    private readonly service: ServiceService,
    private readonly radar: RadarService,
    private readonly teaching: TeachingService,
  ) {}

  /**
   * Every call here is the body of an existing controller handler, unchanged.
   *
   * Written as a list of thunks paired with `MEMBER_HOME_SECTIONS` rather than
   * an object literal, so the order cannot drift from the names: the pure
   * `settleSections` throws if the two lengths disagree, and a test pins the
   * names themselves.
   */
  async memberHome(orgId: string, viewer: HomeViewer, from?: string) {
    const tasks: Record<SectionName, () => Promise<unknown>> = {
      stats: () => this.dashboard.memberStats(orgId),
      joins: () => this.dashboard.recentJoins(orgId, viewer.userId),
      bookings: () => this.space.listUserBookings(viewer.userId, orgId, 'upcoming'),
      rsvps: () => this.events.listUserRsvps(orgId, viewer.userId),
      // `true` is "the caller is a member", proven by the guard on the route
      // and never claimed by a query parameter — the same rule the
      // `events/visible` handler states.
      events: () => this.events.listPublicEvents(orgId, { from, perPage: 100 }, true),
      spotlight: () => this.members.spotlight(orgId, viewer.userId),
      doorPin: () => this.door.pinFor(orgId, viewer.userId),
      teaching: () => this.teaching.listForOrg(orgId, viewer),
      service: () => this.service.myService(orgId, viewer.userId),
      ask: () => this.radar.nextAsk(orgId, viewer.userId),
    };

    const names = MEMBER_HOME_SECTIONS;
    const results = await Promise.allSettled(names.map((name) => tasks[name]()));
    const { sections, failed } = settleSections(names, results);

    /*
      Reported once with the list, not once per section.

      Ten separate requests produced ten separate Sentry issues with ten
      identical-looking titles, which is the noise D-046 was written about. One
      line naming which sections failed is the thing somebody reading it
      actually needs.

      A section refused with 403 is left out: that is a co-op not using the
      feature, which is most co-ops for teaching, and logging it would write a
      warning on every dashboard load in the product. `isUnavailable` says why.

      `warn`, not `error`: the dashboard renders. A panel that cannot draw is a
      state this page has always had a design for.
    */
    const broken = failed.filter((failure) => !isUnavailable(failure.reason));

    if (broken.length > 0) {
      const reasons = broken
        .map((failure) => `${failure.name}: ${failure.reason}`)
        .join('; ');
      this.logger.warn(`member-home sections failed for org ${orgId} — ${reasons}`);
    }

    return sections;
  }
}
