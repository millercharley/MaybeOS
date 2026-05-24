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
  orgSlug: string;
  children: React.ReactNode;
}) {
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
    <PortalContext.Provider value={{ org, orgSlug, loading, error }}>
      {children}
    </PortalContext.Provider>
  );
}

export function usePortal() {
  return useContext(PortalContext);
}
