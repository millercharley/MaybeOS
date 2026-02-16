'use client';

import { create } from 'zustand';
import { api, UserProfile } from './api';

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

      // Auto-select first org if none selected
      const { currentOrgId } = get();
      if (!currentOrgId && user.orgs.length > 0) {
        get().setCurrentOrg(user.orgs[0].orgId);
      }
    } catch {
      set({ token: null, user: null, isLoading: false });
      if (typeof window !== 'undefined') {
        localStorage.removeItem('maybeos_token');
      }
    }
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('maybeos_token');
      localStorage.removeItem('maybeos_org');
    }
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
