'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api';

/**
 * Handing a member a way in that is not email (MEM-29).
 *
 * Microsoft accepts MaybeOS mail with a clean `250` and then suppresses it:
 * the provider reports it delivered, and the member finds nothing in their
 * inbox and nothing in junk. For those members a magic link cannot be
 * emailed, so an organiser mints one here and passes it on by text or in
 * person.
 *
 * The warning is not decoration. The link signs its holder in as that member,
 * and an organiser who leaves it in a group chat has left an account open.
 * Saying so beside the button is the only moment anybody will read it.
 */
export function SignInLinkDialog({
  orgId,
  userId,
  memberName,
  token,
  open,
  onClose,
}: {
  orgId: string;
  userId: string;
  memberName: string;
  token: string;
  open: boolean;
  onClose: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  /*
    Minted when the dialog opens, not when the page loads.

    Every mint invalidates the member's previous link, so one must happen
    because an organiser asked for it — never as a side effect of a render.
  */
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setBusy(true);
    setError('');
    setLink(null);
    setCopied(false);

    api.members
      .createSignInLink(orgId, userId, token)
      .then((result) => {
        if (cancelled) return;
        setLink(result.url);
        setExpiresAt(result.expiresAt);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not make a link.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, orgId, userId, token]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused. The link is on screen and
      // selectable, so there is still a way to take it.
    }
  }

  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <Modal open={open} onClose={onClose} title={`A sign-in link for ${memberName}`}>
      <div className="px-6 py-5">
        <p className="text-sm text-gray-700">
          Send this to {memberName} by text, or show it to them in person. It signs them
          straight in, and they can set a password once they are there.
        </p>

        {busy && (
          <p className="mt-4 flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Making a link…
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {link && (
          <>
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              {/*
                Selectable and wrapped rather than truncated: an organiser on a
                phone with no clipboard permission has to be able to read the
                whole thing out.
              */}
              <p className="break-all font-mono text-xs text-gray-800">{link}</p>
            </div>

            <button type="button" onClick={copy} className="btn-primary mt-3 text-sm">
              {copied ? (
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4" aria-hidden /> Copied
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Copy className="h-4 w-4" aria-hidden /> Copy the link
                </span>
              )}
            </button>

            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Anybody holding this link can sign in as {memberName}, so give it to them and
                nobody else.{' '}
                {expiryLabel ? `It stops working on ${expiryLabel}.` : 'It expires shortly.'}{' '}
                Making this link also cancelled any earlier one they were sent.
              </span>
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
