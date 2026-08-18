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


/**
 * The user id inside a JWT, without verifying it.
 *
 * Only used to decide whether the profile in memory belongs to the account
 * that just signed in. Nothing is trusted on the strength of it — the API
 * verifies every token itself — so a malformed one simply means "assume a
 * different person" and refetch, which is the safe direction.
 */
function subjectOf(token: string): string | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    return JSON.parse(atob(payload)).sub ?? null;
  } catch {
    return null;
  }
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

    // The profile that belonged to the previous token is now stale, and
    // AuthProvider only fetches one when there is none — `token && !user`. So
    // signing in as somebody else in the same browser left the *previous*
    // person's name, role and org on screen: an admin signing in after a
    // member saw the member's nav and a locked page, and the reverse showed a
    // member somebody else's name. The API was never fooled — every request
    // used the new token — but the screen was.
    const previousUserId = get().user?.id;
    const nextUserId = subjectOf(token);
    const sameperson = previousUserId && nextUserId && previousUserId === nextUserId;

    if (sameperson) {
      // A refreshed token for the same account, as after creating an org.
      // Clear the profile so it reloads with the new roles, but keep which
      // org they were looking at.
      set({ token, user: null });
      return;
    }

    // A different account: the selected org belonged to the last one and may
    // not even be an org this person belongs to.
    if (typeof window !== 'undefined') {
      localStorage.removeItem('maybeos_org');
    }
    set({ token, user: null, currentOrgId: null });
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

      // Which org is selected is restored from localStorage by `init` before
      // the profile arrives, and until now nothing ever checked it was one of
      // *this person's* orgs — only that it was set. So a stale id survived
      // indefinitely and every org-scoped request answered 403 "Not a member
      // of this organization", with no way out through the UI, because every
      // screen that could change the selection is itself org-scoped.
      //
      // Charley hit this on 2026-08-18: a dev org id (Sunrise) left in a
      // browser then pointed at production, immediately after accepting an
      // invitation that had actually succeeded — so the one thing that looked
      // broken was the thing that had worked. The same trap catches an org
      // that no longer exists (the write probe tears one down on every run)
      // and a membership revoked while somebody was signed in.
      const { currentOrgId } = get();
      const stillAMember = user.orgs.some((org) => org.orgId === currentOrgId);

      if (!stillAMember) {
        if (user.orgs.length > 0) {
          get().setCurrentOrg(user.orgs[0].orgId);
        } else if (currentOrgId) {
          // Belongs to nothing: drop the selection rather than leave a
          // guaranteed 403 behind.
          if (typeof window !== 'undefined') {
            localStorage.removeItem('maybeos_org');
          }
          set({ currentOrgId: null });
        }
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
