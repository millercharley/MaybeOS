'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  Users,
  Calendar,
  DoorOpen,
  MessageSquare,
  Settings,
  CreditCard,
  UserCircle,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { Wordmark } from '@/components/brand/wordmark';

const adminNav = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/members', label: 'Members', icon: Users },
  { href: '/admin/tiers', label: 'Tiers & Dues', icon: CreditCard },
  { href: '/admin/events', label: 'Events', icon: Calendar },
  { href: '/admin/rooms', label: 'Rooms & Booking', icon: DoorOpen },
  { href: '/admin/commons', label: 'Commons', icon: MessageSquare },
  // Impact is intentionally absent: the admin Impact page was removed pending
  // the ImpactOS rebuild (D-021). Re-add it when the Signals view exists.
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
  { href: '/member/bookings', label: 'My Bookings', icon: DoorOpen },
  { href: '/member/billing', label: 'Billing', icon: CreditCard },
  { href: '/member/profile', label: 'Profile', icon: UserCircle },
];

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const logout = useAuthStore((s) => s.logout);

  const role = user?.orgs?.find((o) => o.orgId === currentOrgId)?.role;
  const navItems = role === 'ADMIN' || role === 'STAFF' ? adminNav : memberNav;

  return (
    /* Dark ink sidebar, per the design system's admin-app layout spec — it
       anchors the paper canvas and gives the accent red something to sit
       against. This is the second of the palette's two background fields. */
    <aside className="flex h-screen w-64 flex-col bg-ink">
      {/* No monogram: the design system is explicit that the wordmark is the
          only mark, and that a symbol should not be invented for it. */}
      <div className="flex h-16 items-center border-b border-white/15 px-6">
        <Wordmark tone="paper" height={22} />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast',
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'text-paper-deep hover:bg-white/10 hover:text-paper',
              )}
            >
              <item.icon className="h-5 w-5" strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/15 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
            <span className="text-xs font-semibold text-paper">
              {user?.name?.charAt(0) || user?.email?.charAt(0) || '?'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-paper">
              {user?.name || 'User'}
            </p>
            <p className="data truncate text-xs text-ink-faint">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="text-ink-faint transition-colors hover:text-paper"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
