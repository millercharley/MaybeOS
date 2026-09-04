'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { api, Org } from '@/lib/api';

interface PortalContextValue {
  org: Org | null;
  orgSlug: string;
  loading: boolean;
  error: string | null;
}

const PortalContext = createContext<PortalContextValue>({
  org: null,
  orgSlug: '',
  loading: true,
  error: null,
});

export function PortalProvider({
  orgSlug,
  children,
}: {
  /**
   * The co-op whose portal is on screen, or undefined anywhere else.
   *
   * Undefined is a real state, not a missing prop. The provider wraps the
   * whole signed-in app so that one sidebar survives every navigation
   * (NAV-03) — wrapping it only on portal routes would change the tree's
   * shape between areas and unmount the shell, which is the bug that
   * restructuring was done to fix.
   */
  orgSlug?: string;
  children: React.ReactNode;
}) {
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(Boolean(orgSlug));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Off the portal there is no co-op to fetch, and no loading state to be
    // in. Anything reading this context outside a portal page gets a settled
    // "there is no org here" rather than a spinner that never resolves.
    if (!orgSlug) {
      setOrg(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    api.orgs
      .getBySlug(orgSlug)
      .then((data) => {
        if (!cancelled) setOrg(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Organization not found');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [orgSlug]);

  return (
    <PortalContext.Provider value={{ org, orgSlug: orgSlug ?? '', loading, error }}>
      {children}
    </PortalContext.Provider>
  );
}

export function usePortal() {
  return useContext(PortalContext);
}
