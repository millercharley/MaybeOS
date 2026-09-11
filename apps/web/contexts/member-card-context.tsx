'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MemberCard } from '@/components/member/member-card';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';

/**
 * One member card for the whole app (MEM-18).
 *
 * Charley: "the same card that shows anywhere in MaybeOS when someone clicks
 * on another person's name." So there is exactly one, mounted once in the
 * shell, and every name opens it through `openMember` — a page does not get
 * its own copy to drift from the others.
 *
 * The co-op is the one the page is about: the portal's when on the portal,
 * otherwise the one selected in the dashboard. A caller can name it outright.
 * Outside this provider — the public site — `openMember` does nothing, which
 * is correct: a stranger has no business opening a member's card.
 */
interface OpenArgs {
  userId: string;
  name?: string | null;
  orgId?: string;
}

const MemberCardContext = createContext<{ openMember: (args: OpenArgs) => void }>({
  openMember: () => {},
});

export function MemberCardProvider({ children }: { children: React.ReactNode }) {
  const { org } = usePortal();
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const pathname = usePathname();
  const [open, setOpen] = useState<OpenArgs | null>(null);

  const openMember = useCallback((args: OpenArgs) => setOpen(args), []);
  const close = useCallback(() => setOpen(null), []);

  // Moving to another page closes it — "Message" and a post link both leave.
  useEffect(() => setOpen(null), [pathname]);

  const orgId = open?.orgId ?? org?.id ?? currentOrgId ?? null;
  const value = useMemo(() => ({ openMember }), [openMember]);

  return (
    <MemberCardContext.Provider value={value}>
      {children}
      {open && orgId && (
        <MemberCard userId={open.userId} orgId={orgId} fallbackName={open.name ?? null} onClose={close} />
      )}
    </MemberCardContext.Provider>
  );
}

export function useMemberCard() {
  return useContext(MemberCardContext);
}
