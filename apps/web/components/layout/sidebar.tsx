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
  BarChart3,
  Settings,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { Wordmark } from '@/components/brand/wordmark';

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/members', label: 'Members', icon: Users },
  { href: '/admin/events', label: 'Events', icon: Calendar },
  { href: '/admin/rooms', label: 'Rooms & Booking', icon: DoorOpen },
  { href: '/admin/commons', label: 'Commons', icon: MessageSquare },
  { href: '/admin/impact', label: 'Impact', icon: BarChart3 },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    /* Dark ink sidebar, per the design system's admin-app layout spec — it
       anchors the paper canvas and gives the accent red something to sit
       against. This is the second of the palette's two background fields. */
    <aside className="flex h-screen w-64 flex-col bg-ink">
      {/* No monogram: the design system is explicit that the wordmark is the
          only mark, and that a symbol should not be invented for it. */}
      <div className="flex h-16 items-center border-b border-white/15 px-6">
        <Wordmark className="text-xl text-paper" />
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
