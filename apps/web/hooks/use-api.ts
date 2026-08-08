'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/auth-store';

interface UseApiOptions {
  skip?: boolean;
}

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApi<T>(
  fetcher: (token: string, orgId: string) => Promise<T>,
  deps: unknown[] = [],
  options: UseApiOptions = {},
): UseApiResult<T> {
  const token = useAuthStore((s) => s.token);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!options.skip);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (options.skip || !token || !currentOrgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher(token, currentOrgId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, currentOrgId, options.skip, ...deps]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

export function usePublicApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
