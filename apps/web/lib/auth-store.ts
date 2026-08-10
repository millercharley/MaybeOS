'use client';

import { create } from 'zustand';
import * as Sentry from '@sentry/nextjs';
import { api, ApiError, UserProfile } from './api';

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  currentOrgId: string | null;
  isLoading: boolean;

  setToken: (token: string) => void;
  setCurrentOrg: (orgId: string) => void;
  loadProfile: () => Promise<void>;
  logout: () => void;
  init: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  currentOrgId: null,
  isLoading: true,

  setToken: (token: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('maybeos_token', token);
    }
    set({ token });
  },

  setCurrentOrg: (orgId: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('maybeos_org', orgId);
    }
    // Tag reports with the tenant. In a multi-tenant app "is this broken for
    // everyone or just one org?" is the first question worth answering.
    Sentry.setTag('org.id', orgId);
    set({ currentOrgId: orgId });
  },

  loadProfile: async () => {
    const { token } = get();
    if (!token) {
      set({ isLoading: false });
      return;
    }
    try {
      const user = await api.auth.profile(token);
      set({ user, isLoading: false });

      // Attach identity to every subsequent error report. Id only — an email
      // address in a third-party dashboard is member PII we have no reason to
      // send, and the id is enough to trace a report back to an account.
      Sentry.setUser({ id: user.id });

      // Auto-select first org if none selected
      const { currentOrgId } = get();
      if (!currentOrgId && user.orgs.length > 0) {
        get().setCurrentOrg(user.orgs[0].orgId);
      }
    } catch (err) {
      // This used to be a bare `catch {}` that discarded the session on *any*
      // failure. A 500 or a dropped connection would silently sign the user
      // out and look, from the outside, exactly like a normal logout — no
      // error, no report, nothing to debug. Only an actual rejection of the
      // credential should end the session.
      const rejected = err instanceof ApiError && (err.status === 401 || err.status === 403);

      if (rejected) {
        set({ token: null, user: null, isLoading: false });
        Sentry.setUser(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('maybeos_token');
        }
        return;
      }

      // Keep the token: the credential may well still be good and the next
      // attempt may succeed. Surface it instead of swallowing it.
      set({ isLoading: false });
      Sentry.captureException(err, {
        level: 'error',
        tags: { 'auth.stage': 'load-profile' },
      });
    }
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('maybeos_token');
      localStorage.removeItem('maybeos_org');
    }
    Sentry.setUser(null);
    set({ token: null, user: null, currentOrgId: null });
  },

  init: () => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('maybeos_token');
      const orgId = localStorage.getItem('maybeos_org');
      if (token) {
        set({ token, currentOrgId: orgId });
        get().loadProfile();
      } else {
        set({ isLoading: false });
      }
    }
  },
}));
