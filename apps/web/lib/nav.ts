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

const adminNav = [
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

/**
 * What a member's own dashboard offers (IMP-11).
 *
 * The sidebar had one list and showed it to everybody, and the dashboard
 * layout wraps `/member/*` as well as `/admin/*` — so a member on their own
 * profile page was looking at Members, Tiers & Dues and Settings, every one
 * of which answers 403. These pages all exist and are all theirs.
 */
const memberNav = [
  { href: '/member', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/member/rsvps', label: 'My RSVPs', icon: Calendar },
  { href: '/member/events', label: 'My Events', icon: CalendarPlus },
  { href: '/member/bookings', label: 'My Bookings', icon: DoorOpen },
  { href: '/member/billing', label: 'Billing', icon: CreditCard },
  { href: '/member/profile', label: 'Profile', icon: UserCircle },
];

/**
 * The co-op itself, which a member previously had no route to at all.
 *
 * Every item in `memberNav` is about *them* — their RSVPs, their bookings,
 * their billing, their profile — so a member signing in got a membership
 * admin panel and no membership: no channels, no proposals, no library, no
 * directory, and no way to see a room in order to book one, which is why
 * "My Bookings" could only ever be empty for them. Meanwhile `adminNav` has
 * carried a Commons link the whole time. Charley found it from the member
 * side on 2026-08-18: "there seems to be no way for a member to reach the
 * actual Commons".
 *
 * These surfaces already existed and already handled a signed-in member
 * correctly — the portal pages check for a token and offer participation
 * when they have one. Nothing linked to them, which is the same failure as
 * the hardcoded events pages: working code nobody could reach.
 *
 * They live under the co-op's own portal rather than being rebuilt inside
 * this shell, so there is one Commons rather than two that can disagree.
 * Whether the portal or the dashboard is the canonical home for a member is
 * a real question, and one worth deciding deliberately alongside SCL-01's
 * subdomains rather than by growing a second copy here.
 */
const coopNav = (slug: string) => [
  { href: `/portal/${slug}/commons`, label: 'Commons', icon: MessageSquare },
  { href: `/portal/${slug}/directory`, label: 'Directory', icon: Users },
  { href: `/portal/${slug}/events`, label: 'Events', icon: Calendar },
  { href: `/portal/${slug}/rooms`, label: 'Rooms', icon: DoorOpen },
];

/**
 * Which sections a person sees, given the membership they are looking at.
 *
 * Pure and exported so it can be argued with in a test: the failure it
 * prevents is a member having no route to their own co-op, which shipped and
 * survived until somebody hit it from the member side.
 */
export function navSectionsFor(membership?: NavMembership | null): NavSection[] {
  const role = membership?.role;
  if (role === 'ADMIN' || role === 'STAFF') {
    return [{ items: adminNav }];
  }

  const slug = membership?.org?.slug;

  return [
    { items: memberNav.slice(0, 1) },
    // Omitted rather than guessed when the slug is absent: `/portal/undefined/
    // commons` would read as a broken product rather than an unloaded profile.
    ...(slug
      ? [{ label: membership?.org?.name ?? 'My co-op', items: coopNav(slug) }]
      : []),
    { label: 'My membership', items: memberNav.slice(1) },
  ];
}

/**
 * The portal's left column (option B, Charley 2026-08-18).
 *
 * The portal is "the portal and core user experience", and it previously had
 * its own top-bar nav while the dashboard had a left sidebar — so a member
 * moving between their co-op and their own settings changed chrome, and
 * neither surface offered a route to the other. One column carries both.
 *
 * The hard constraint is that **the portal is public**. A signed-out visitor
 * is a legitimate viewer of a co-op's page, so the co-op section renders for
 * everyone and only the personal and organiser sections depend on a session.
 * Building the whole thing behind a token check would have hidden a co-op's
 * public face from the public.
 */
export function portalSectionsFor({
  orgSlug,
  membership,
  signedIn,
}: {
  orgSlug: string;
  membership?: NavMembership | null;
  signedIn: boolean;
}): NavSection[] {
  const base = `/portal/${orgSlug}`;

  const sections: NavSection[] = [
    {
      items: [
        { href: base, label: 'Home', icon: LayoutDashboard },
        { href: `${base}/events`, label: 'Events', icon: Calendar },
        { href: `${base}/rooms`, label: 'Rooms', icon: DoorOpen },
        { href: `${base}/commons`, label: 'Commons', icon: MessageSquare },
        { href: `${base}/directory`, label: 'Directory', icon: Users },
      ],
    },
  ];

  if (!signedIn) return sections;

  const role = membership?.role;
  if (role === 'ADMIN' || role === 'STAFF') {
    sections.push({ label: 'Organising', items: adminNav });
  }

  // `memberNav` already leads with the member's own dashboard, which is the
  // way back out of the portal and into their settings.
  sections.push({ label: 'My membership', items: memberNav });

  return sections;
}
