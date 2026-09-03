import {
  LayoutDashboard,
  Users,
  Calendar,
  CalendarPlus,
  DoorOpen,
  MessageSquare,
  Settings,
  CreditCard,
  UserCircle,
  Receipt,
  type LucideIcon,
  Activity,
  HandCoins,
  Landmark,
  BookOpen,
  HeartHandshake,
  Mail,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

/** The membership shape this needs — `org` is optional on the profile. */
export interface NavMembership {
  role?: string;
  org?: { name?: string; slug?: string } | null;
}

/**
 * Managing the co-op. Its own dashboard is hoisted out, see `sidebarSections`.
 *
 * Every address names its co-op. `/admin` used to mean whichever org was in
 * localStorage, so one address meant different things to different people, two
 * tabs could not sit on two co-ops, and a stale selection made every screen
 * answer 403 with no way out (AUTH-05). It also gives SCL-01's subdomains
 * something to rewrite *to*, the way the portal already works — which is why
 * `/admin` had to be excluded from tenant routing until now.
 */
const adminNav = (slug: string): NavItem[] => [
  { href: `/admin/${slug}`, label: 'Dashboard', icon: LayoutDashboard },
  { href: `/admin/${slug}/members`, label: 'Members', icon: Users },
  { href: `/admin/${slug}/tiers`, label: 'Tiers & Dues', icon: CreditCard },
  { href: `/admin/${slug}/events`, label: 'Events', icon: Calendar },
  { href: `/admin/${slug}/rooms`, label: 'Rooms & Booking', icon: DoorOpen },
  { href: `/admin/${slug}/commons`, label: 'Commons', icon: MessageSquare },
  // Two entries rather than one "Impact", because they are two jobs. This is
  // the switch and the question list (IMP-18) — what the co-op asks and
  // whether it is asking. The Signals view that reports what came back is
  // IMP-20 and joins it here when it exists.
  { href: `/admin/${slug}/impact`, label: 'Measuring', icon: Activity },
  { href: `/admin/${slug}/expenses`, label: 'Spending', icon: Receipt },
  // Money owed *out* to members who hosted, which is a different job from
  // spending and a different one from ticket sales (EVT-15).
  { href: `/admin/${slug}/payouts`, label: 'Host payouts', icon: HandCoins },
  { href: `/admin/${slug}/welcome`, label: 'Welcoming', icon: BookOpen },
  { href: `/admin/${slug}/belonging`, label: 'Belonging', icon: HeartHandshake },
  { href: `/admin/${slug}/settings`, label: 'Settings', icon: Settings },
];

/**
 * MaybeOS's own console (PLT-01), shown only to a platform admin.
 *
 * Deliberately its own section rather than an entry among a co-op's tools:
 * it is not one of them, and a co-op's organiser must never see it at all.
 */
const platformNav: NavItem[] = [
  { href: '/platform', label: 'Co-ops on MaybeOS', icon: Landmark },
];

/** A member's own things (IMP-11), in the co-op they are looking at. */
const memberNav = (slug: string): NavItem[] => [
  { href: `/member/${slug}`, label: 'Dashboard', icon: LayoutDashboard },
  // No 'My RSVPs': it lives inside My Events now, because hosting something
  // and going to something are the same question asked twice.
  { href: `/member/${slug}/events`, label: 'My Events', icon: CalendarPlus },
  { href: `/member/${slug}/bookings`, label: 'My Bookings', icon: DoorOpen },
  { href: `/member/${slug}/billing`, label: 'Billing', icon: CreditCard },
  // What they told the co-op and what it added up to (IMP-20). A member who
  // answers a question a month and is told nothing stops answering, and
  // response rate is the constraint the whole of ImpactOS rests on.
  { href: `/member/${slug}/impact`, label: 'What we’re learning', icon: Activity },
  { href: `/member/${slug}/profile`, label: 'Profile', icon: UserCircle },
];

/** The co-op itself, under its own portal. */
const coopNav = (slug: string): NavItem[] => [
  // First, deliberately. It is what a co-op wants a new member to read before
  // they read anything else, and burying it under the things regulars use
  // would mean only regulars ever found it.
  { href: `/portal/${slug}/welcome`, label: 'Welcome', icon: BookOpen },
  { href: `/portal/${slug}/commons`, label: 'Commons', icon: MessageSquare },
  { href: `/portal/${slug}/messages`, label: 'Messages', icon: Mail },
  { href: `/portal/${slug}/directory`, label: 'Directory', icon: Users },
  { href: `/portal/${slug}/events`, label: 'Events', icon: Calendar },
  { href: `/portal/${slug}/rooms`, label: 'Rooms', icon: DoorOpen },
];

/**
 * One navigation for every screen (Charley, 2026-08-19).
 *
 * There were two: a dark column on the dashboard and a light one on the
 * portal, so moving between a co-op and its admin changed the shape *and* the
 * colour of the app. Worse, they disagreed about who you were — an organiser
 * got the admin tools and nothing else, so the person running a co-op had no
 * route to the co-op. Being an admin is a role you hold *in addition to* being
 * a member, and the nav now says so: organisers get the community, the
 * organising tools, and their own membership.
 *
 * Two things it must keep straight:
 *
 *   - **The portal is public.** A signed-out visitor is a legitimate viewer of
 *     a co-op's page, so the community section renders without a session and
 *     only the personal and organising sections need one.
 *   - **The co-op on screen is not always the one you have selected.** On a
 *     portal page the community section follows the URL, so somebody looking
 *     at another co-op's public page sees *that* co-op — not links to their
 *     own that would silently navigate them elsewhere.
 */
export function sidebarSections({
  membership,
  orgSlug,
  orgName,
  signedIn,
  isPlatformAdmin = false,
}: {
  membership?: NavMembership | null;
  /** The co-op whose page is on screen. Wins over the selected membership. */
  orgSlug?: string;
  orgName?: string;
  signedIn: boolean;
  /** MaybeOS's own operators. Nobody else ever sees this section. */
  isPlatformAdmin?: boolean;
}): NavSection[] {
  const role = membership?.role;
  const isOrganiser = role === 'ADMIN' || role === 'STAFF';

  const slug = orgSlug ?? membership?.org?.slug;
  const name = orgName ?? membership?.org?.name ?? 'My co-op';

  const sections: NavSection[] = [];

  // Without a slug there is no address to build: the personal and organising
  // sections all name their co-op now. The community section below is the one
  // thing that can still render, and it has its own slug from the portal.
  const admin = slug ? adminNav(slug) : [];
  const member = slug ? memberNav(slug) : [];

  if (signedIn && slug) {
    // One dashboard, whichever this person's is.
    sections.push({ items: [isOrganiser ? admin[0] : member[0]] });
  }

  // Omitted rather than guessed when there is no slug: `/portal/undefined/...`
  // reads as a broken product rather than a profile that has not loaded.
  if (slug) {
    sections.push({ label: name, items: coopNav(slug) });
  }

  if (signedIn && isOrganiser && slug) {
    sections.push({ label: 'Organising', items: admin.slice(1) });
  }

  if (signedIn && slug) {
    sections.push({ label: 'My membership', items: member.slice(1) });
  }

  // Last, and labelled as MaybeOS rather than as part of the co-op — because
  // it is not part of the co-op, and a console sitting among a co-op's own
  // tools would read as one of them (PLT-01).
  if (signedIn && isPlatformAdmin) {
    sections.push({ label: 'MaybeOS', items: platformNav });
  }

  return sections;
}

/**
 * Whether a nav item could be the page on screen.
 *
 * A prefix match, so `/admin/mif/members/import` still counts as Members —
 * with the `/` guard, or `/portal/mif/rooms` would match `/portal/mif/roomsy`.
 *
 * "Could be", not "is": several items can match one address, because a
 * dashboard's href is a prefix of every page in its area. Use `activeNavHref`
 * to pick the one to light up.
 */
export function isNavItemActive(href: string, pathname?: string | null): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + '/');
}

/**
 * The one item to light up — the longest href that matches (NAV-01).
 *
 * Two things were lit at once before this. The Dashboard's href *is* the root
 * of its area (`/admin/<slug>`), so on Host payouts both Dashboard and Host
 * payouts came up red, and the nav answered "where am I" twice with different
 * answers. Longest match is the fix: a more specific item beats the root it
 * sits under, and nothing else changes.
 */
export function activeNavHref(
  sections: NavSection[],
  pathname?: string | null,
): string | null {
  let best: string | null = null;

  for (const section of sections) {
    for (const item of section.items) {
      if (!isNavItemActive(item.href, pathname)) continue;
      if (!best || item.href.length > best.length) best = item.href;
    }
  }

  return best;
}

/**
 * The one section to leave open (NAV-01).
 *
 * The nav lists everything a person can reach, which for an organiser is three
 * sections and twenty-odd links — so the thing they are actually looking at
 * sits somewhere in the middle of a column that scrolls. Collapsing the rest
 * makes the open section the answer to "where am I".
 *
 * Built on the active item rather than on "contains a match", so the same
 * prefix problem cannot open two sections: on `/admin/<slug>` the active item
 * is the hoisted Dashboard, which belongs to no labelled section, and
 * everything stays closed.
 */
export function openSectionLabel(
  sections: NavSection[],
  pathname?: string | null,
): string | null {
  const active = activeNavHref(sections, pathname);
  if (!active) return null;

  const section = sections.find(
    (s) => s.label && s.items.some((i) => i.href === active),
  );

  return section?.label ?? null;
}
