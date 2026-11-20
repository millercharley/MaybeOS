import { Injectable, Logger } from '@nestjs/common';
import { CommonsService } from '../commons/commons.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { OrgService } from '../org/org.service';
import { KnowledgeService } from '../belonging/knowledge.service';
import {
  SHELL_SECTIONS,
  settleShell,
  isUnavailable,
  type ShellSection,
} from './app-shell';

export interface ShellViewer {
  userId: string;
  isStaff: boolean;
}

/**
 * The chrome's four answers, in one request (OPS-47).
 *
 * **This service composes and owns no queries.** It is the same rule the
 * dashboard bundle follows and for the same reason: the unread arithmetic,
 * the checklist's notion of a finished step and the reading gate's grace
 * period are each a rule somebody got wrong once and fixed in one place. A
 * second copy here would be right the day it was written and wrong within a
 * month, with no way to tell which copy a member was reading. A test refuses
 * a Prisma import in this module.
 */
@Injectable()
export class ShellService {
  private readonly logger = new Logger(ShellService.name);

  constructor(
    private readonly commons: CommonsService,
    private readonly onboarding: OnboardingService,
    private readonly orgs: OrgService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async appShell(orgId: string, viewer: ShellViewer) {
    const tasks: Record<ShellSection, () => Promise<unknown>> = {
      // `isStaff` comes from the JWT, never a second lookup — the same actor
      // the commons controller passes, so the badge counts what the sidebar
      // would let this member open.
      unread: () =>
        this.commons.unreadCounts(orgId, viewer.userId, { isStaff: viewer.isStaff }),
      onboarding: () => this.onboarding.forMember(orgId, viewer.userId),
      links: () => this.orgs.listLinks(orgId),
      reading: () => this.knowledge.outstandingForUser(orgId, viewer.userId),
    };

    const names = SHELL_SECTIONS;
    const results = await Promise.allSettled(names.map((name) => tasks[name]()));
    const { sections, failed } = settleShell(names, results);

    /*
      Reported once with the list, not once per section — the lesson of D-046,
      where four endpoints filed four Sentry issues in the same second from
      one member.

      A section refused with 403 is a co-op not using the feature, and is left
      out: this runs on every page of the product, so a warning per load would
      be the loudest line in the log by a wide margin.

      `warn`, not `error`: the chrome renders. A badge that cannot draw is a
      state the sidebar has always had a design for.
    */
    const broken = failed.filter((failure) => !isUnavailable(failure.reason));

    if (broken.length > 0) {
      const reasons = broken
        .map((failure) => `${failure.name}: ${failure.reason}`)
        .join('; ');
      this.logger.warn(`app-shell sections failed for org ${orgId} — ${reasons}`);
    }

    return sections;
  }
}
