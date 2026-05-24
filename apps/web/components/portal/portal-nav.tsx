'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { LogOut } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';

const navItems = [
  { path: '', label: 'Home' },
  { path: '/events', label: 'Events' },
  { path: '/rooms', label: 'Rooms' },
  { path: '/commons', label: 'Commons' },
  { path: '/directory', label: 'Directory' },
  { path: '/impact', label: 'Surveys' },
];

export function PortalNav() {
  const pathname = usePathname();
  const { org, orgSlug } = usePortal();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);

  const basePath = `/portal/${orgSlug}`;

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href={basePath} className="flex items-center gap-2 py-4">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: org?.brandColor || '#6366f1' }}
            >
              <span className="text-sm font-bold text-white">
                {org?.name?.charAt(0) || 'O'}
              </span>
            </div>
            <span className="text-lg font-semibold text-gray-900">{org?.name}</span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {navItems.map((item) => {
              const href = item.path ? `${basePath}${item.path}` : basePath;
              const isActive = item.path
                ? pathname === href || pathname?.startsWith(href + '/')
                : pathname === basePath;

              return (
                <Link
                  key={item.label}
                  href={href}
                  className={clsx(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {token && user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">{user.name || user.email}</span>
              <button
                onClick={logout}
                className="text-gray-400 hover:text-gray-600"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Link href="/login" className="btn-primary text-sm">
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
