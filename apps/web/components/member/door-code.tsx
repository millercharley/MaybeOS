'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * The code that opens the door (DOR-01), at the top of a member's own pages.
 *
 * Charley wants it in the top right of both My Profile and My Settings, and
 * the reason is the use it gets: a member standing at the door with a phone
 * does not want to remember which of their pages it was on. Two places is
 * one fewer wrong guess.
 *
 * Its own request rather than a field on the profile: a profile is one
 * account across every co-op a member belongs to, and a door code belongs to
 * exactly one of them. Null when this co-op has no door, and then nothing is
 * drawn at all — a label with no code under it is a question, not an answer.
 */
export function DoorCode() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [pin, setPin] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !orgId) return;
    let cancelled = false;

    api.door
      .myPin(orgId, token)
      .then(({ doorPin }) => {
        if (!cancelled) setPin(doorPin);
      })
      // A co-op with door access switched off answers with null, and a
      // failure here must not cost a member the page it sits on.
      .catch(() => {
        if (!cancelled) setPin(null);
      });

    return () => {
      cancelled = true;
    };
  }, [token, orgId]);

  if (!pin) return null;

  return (
    <p className="text-right text-sm font-medium text-[var(--text-primary)]">
      Door Access Pin Code:{' '}
      {/* Capitals in the display serif, letter-spaced: the shape that lets a
          code carry I and L without being misread (DOR-01). */}
      <span className="font-display uppercase tracking-[0.2em]">{pin}</span>
    </p>
  );
}
