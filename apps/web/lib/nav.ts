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

/** Managing the co-op. Its own dashboard is hoisted out, see `sidebarSections`. */
const adminNav: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/members', label: 'Members', icon: Users },
  { href: '/admin/tiers', label: 'Tiers & Dues', icon: CreditCard },
  { href: '/admin/events', label: 'Events', icon: Calendar },
  { href: '/admin/rooms', label: 'Rooms & Booking', icon: DoorOpen },
  { href: '/admin/commons', label: 'Commons', icon: MessageSquare },
  // Spending, not Impact: the admin Impact page was removed pending the
  // ImpactOS rebuild (D-021), and the Signals view that replaces it does not
  // exist yet. This is the one piece of it that stands alone (IMP-16) — an
  // API nobody can reach is how the last one ended up unused for months.
  { href: '/admin/expenses', label: 'Spending', icon: Receipt },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

/** A member's own things (IMP-11). */
const memberNav: NavItem[] = [
  { href: '/member', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/member/rsvps', label: 'My RSVPs', icon: Calendar },
  { href: '/member/events', label: 'My Events', icon: CalendarPlus },
  { href: '/member/bookings', label: 'My Bookings', icon: DoorOpen },
  { href: '/member/billing', label: 'Billing', icon: CreditCard },
  { href: '/member/profile', label: 'Profile', icon: UserCircle },
];

/** The co-op itself, under its own portal. */
const coopNav = (slug: string): NavItem[] => [
  { href: `/portal/${slug}/commons`, label: 'Commons', icon: MessageSquare },
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
}: {
  membership?: NavMembership | null;
  /** The co-op whose page is on screen. Wins over the selected membership. */
  orgSlug?: string;
  orgName?: string;
  signedIn: boolean;
}): NavSection[] {
  const role = membership?.role;
  const isOrganiser = role === 'ADMIN' || role === 'STAFF';

  const slug = orgSlug ?? membership?.org?.slug;
  const name = orgName ?? membership?.org?.name ?? 'My co-op';

  const sections: NavSection[] = [];

  if (signedIn) {
    // One dashboard, whichever this person's is.
    sections.push({ items: [isOrganiser ? adminNav[0] : memberNav[0]] });
  }

  // Omitted rather than guessed when there is no slug: `/portal/undefined/...`
  // reads as a broken product rather than a profile that has not loaded.
  if (slug) {
    sections.push({ label: name, items: coopNav(slug) });
  }

  if (signedIn && isOrganiser) {
    sections.push({ label: 'Organising', items: adminNav.slice(1) });
  }

  if (signedIn) {
    sections.push({ label: 'My membership', items: memberNav.slice(1) });
  }

  return sections;
}
