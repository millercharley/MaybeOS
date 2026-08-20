'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { LogOut, ChevronDown, Check } from 'lucide-react';
import { sidebarSections } from '@/lib/nav';
import { useAuthStore } from '@/lib/auth-store';
import { Wordmark } from '@/components/brand/wordmark';

/**
 * The one navigation, on every screen.
 *
 * The portal used to have its own light column while the dashboard had this
 * one, so moving between a co-op and its admin changed the shape and the
 * colour of the app. Charley, 2026-08-19: "This nav bar should be the same
 * across all screens." So the portal renders this, and the light one is gone.
 *
 * `orgSlug` / `orgName` let a portal page say which co-op is on screen, which
 * is not always the one the person has selected — somebody reading another
 * co-op's public page should get links to *that* co-op rather than being
 * silently navigated back to their own.
 */
export function Sidebar({ orgSlug, orgName }: { orgSlug?: string; orgName?: string } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);
  const logout = useAuthStore((s) => s.logout);

  const [switching, setSwitching] = useState(false);

  const orgs = user?.orgs ?? [];
  const membership = orgs.find((o) => o.orgId === currentOrgId);
  const signedIn = Boolean(token && user);

  const sections = sidebarSections({
    membership,
    orgSlug,
    orgName,
    signedIn,
    isPlatformAdmin: user?.globalRole === 'PLATFORM_ADMIN',
  });

  // Only worth a control when there is somewhere to switch to.
  const canSwitch = signedIn && orgs.length > 1;
  const activeName = membership?.org?.name ?? orgName ?? 'Select a co-op';

  function switchTo(orgId: string, slug?: string) {
    setCurrentOrg(orgId);
    setSwitching(false);
    // Stay in the same part of the product, in the co-op just chosen — an
    // organiser switching co-ops wants the other co-op's admin, not to be
    // dropped into a public portal. Staying put is not an option either: the
    // address names a co-op, so it would be the previous one's page under the
    // new one's nav.
    if (!slug) return router.push('/member');
    const area = pathname?.startsWith('/admin') ? 'admin' : pathname?.startsWith('/member') ? 'member' : 'portal';
    router.push(`/${area}/${slug}`);
  }

  return (
    /* Dark ink, per the design system's app layout spec — it anchors the paper
       canvas and gives the accent red something to sit against. */
    <aside className="flex h-screen w-64 flex-col bg-ink">
      {/* No monogram: the design system is explicit that the wordmark is the
          only mark, and that a symbol should not be invented for it. */}
      <div className="flex h-16 shrink-0 items-center border-b border-white/15 px-6">
        <Wordmark tone="paper" height={22} />
      </div>

      {canSwitch && (
        <div className="relative shrink-0 border-b border-white/15 px-3 py-3">
          <button
            type="button"
            onClick={() => setSwitching((open) => !open)}
            aria-expanded={switching}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-paper transition-colors hover:bg-white/10"
          >
            <span className="min-w-0 flex-1 truncate">{activeName}</span>
            <ChevronDown
              className={clsx('h-4 w-4 shrink-0 text-ink-faint transition-transform', switching && 'rotate-180')}
            />
          </button>

          {switching && (
            <ul className="absolute inset-x-3 z-20 mt-1 overflow-hidden rounded-md border border-white/15 bg-ink shadow-lg">
              {orgs.map((o) => (
                <li key={o.orgId}>
                  <button
                    type="button"
                    onClick={() => switchTo(o.orgId, o.org?.slug)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-paper-deep transition-colors hover:bg-white/10 hover:text-paper"
                  >
                    <span className="min-w-0 flex-1 truncate">{o.org?.name ?? 'Co-op'}</span>
                    {o.orgId === currentOrgId && <Check className="h-4 w-4 shrink-0 text-brand-500" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, index) => (
          <div
            key={section.label ?? `section-${index}`}
            className={clsx('space-y-1', index > 0 && 'mt-6')}
          >
            {section.label && (
              <p className="truncate px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-paper-deep/60">
                {section.label}
              </p>
            )}
            {section.items.map((item) => {
              // A portal home would otherwise light up on every portal page,
              // since all of them start with its path.
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
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/15 p-4">
        {signedIn ? (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10">
              <span className="text-xs font-semibold text-paper">
                {user?.name?.charAt(0) || user?.email?.charAt(0) || '?'}
              </span>
            </div>
            {/* The name was a bare span for a long time: the most obvious thing
                to click did nothing. */}
            <Link href={membership?.org?.slug ? `/member/${membership.org.slug}/profile` : '/member'} className="min-w-0 flex-1 group">
              <p className="truncate text-sm font-medium text-paper group-hover:text-brand-500">
                {user?.name || 'User'}
              </p>
              <p className="data truncate text-xs text-ink-faint">{user?.email}</p>
            </Link>
            <button
              onClick={logout}
              className="shrink-0 text-ink-faint transition-colors hover:text-paper"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          /* The portal is public, so this column renders for visitors too. */
          <Link
            href="/login"
            className="block rounded-md bg-brand-600 px-3 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            Sign In
          </Link>
        )}
      </div>
    </aside>
  );
}
