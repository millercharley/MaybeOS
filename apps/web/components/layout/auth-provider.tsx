'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/lib/auth-store';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return <>{children}</>;
}
