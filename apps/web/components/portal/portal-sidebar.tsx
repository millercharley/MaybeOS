'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { LogOut } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { portalSectionsFor } from '@/lib/nav';

/**
 * One left column for the portal and the member's own settings (option B).
 *
 * The portal used a top bar and the dashboard a left sidebar, so moving
 * between a co-op and your own membership changed the shape of the app and
 * neither offered a route to the other. This carries both.
 *
 * Light rather than the dashboard's ink: the portal is a co-op's public face,
 * carrying its own brand colour, and the design system reserves the ink field
 * for the admin app. Same structure, different skin — which is the point of
 * unifying navigation rather than appearance.
 *
 * Hidden below `lg`, where `PortalNav` still serves. A narrow screen wants a
 * drawer rather than a permanent column, and shipping a half-built one would
 * be worse than the top bar that already works there.
 */
export function PortalSidebar() {
  const pathname = usePathname();
  const { org, orgSlug } = usePortal();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const logout = useAuthStore((s) => s.logout);

  const membership = user?.orgs?.find((o) => o.orgId === currentOrgId);
  const sections = portalSectionsFor({
    orgSlug,
    membership,
    signedIn: Boolean(token && user),
  });

  const base = `/portal/${orgSlug}`;

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-white lg:flex">
      <Link href={base} className="flex items-center gap-2 border-b border-gray-200 px-5 py-4">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: org?.brandColor || '#6366f1' }}
        >
          <span className="text-sm font-bold text-white">{org?.name?.charAt(0) || 'O'}</span>
        </div>
        <span className="truncate text-base font-semibold text-gray-900">{org?.name}</span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, index) => (
          <div
            key={section.label ?? `section-${index}`}
            className={clsx('space-y-1', index > 0 && 'mt-6')}
          >
            {section.label && (
              <p className="truncate px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {section.label}
              </p>
            )}
            {section.items.map((item) => {
              // Home would otherwise light up on every portal page, since every
              // one of them starts with the base path.
              const isActive =
                item.href === base
                  ? pathname === base
                  : pathname === item.href || pathname?.startsWith(item.href + '/');

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  )}
                >
                  <item.icon className="h-5 w-5" strokeWidth={1.75} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-200 p-4">
        {token && user ? (
          <div className="flex items-center gap-3">
            {/* The name was a bare span, so the most obvious thing to click in
                the whole header did nothing. It goes to their profile. */}
            <Link href="/member/profile" className="min-w-0 flex-1 group">
              <p className="truncate text-sm font-medium text-gray-900 group-hover:text-brand-600">
                {user.name || user.email}
              </p>
              <p className="truncate text-xs text-gray-400">View profile</p>
            </Link>
            <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <Link href="/login" className="btn-primary block w-full text-center text-sm">
            Sign In
          </Link>
        )}
      </div>
    </aside>
  );
}
