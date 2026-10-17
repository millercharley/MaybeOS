'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Mail } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api';
import { progressLine, shouldContinue, type Pass } from '@/lib/announcement-send';

/**
 * Sending a Commons post to everybody (CMN-21).
 *
 * Two deliberate frictions, and both earn their place.
 *
 * **The post exists first.** An organiser writes it in the Commons, reads it
 * back, and only then decides to email it. Composing straight into four
 * hundred inboxes means the first reading of a typo is somebody else's.
 *
 * **The count is shown before the button.** "Email all members" is an
 * abstraction; "email 394 people" is a decision. It is the last moment at
 * which this is reversible, so it is the moment to be specific.
 */
export function EmailToMembers({
  orgId,
  postId,
  token,
  open,
  onClose,
  onSent,
}: {
  orgId: string;
  postId: string;
  token: string;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [audience, setAudience] = useState<{ remaining: number; subject: string } | null>(null);
  const [pass, setPass] = useState<Pass | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPass(null);
    setDone(false);
    setError('');
    setAudience(null);

    let cancelled = false;
    api.commons
      .previewAnnouncement(orgId, postId, token)
      .then((p) => {
        if (!cancelled) setAudience({ remaining: p.remaining, subject: p.subject });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not check who this reaches.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, orgId, postId, token]);

  async function send() {
    if (sending) return;
    setSending(true);
    setError('');

    try {
      let passes = 0;
      let latest: Pass = { sent: 0, total: 0, remaining: audience?.remaining ?? 0 };

      // The API sends what it can inside a deadline and says what is left;
      // finishing is this loop's job. `shouldContinue` owns when to stop.
      do {
        latest = await api.commons.sendAnnouncement(orgId, postId, token);
        passes += 1;
        setPass(latest);
      } while (shouldContinue(latest, passes));

      setDone(true);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not send.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onClose={sending ? () => undefined : onClose} title="Email this to members">
      <div className="px-6 py-5">
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {!audience && !error && (
          <p className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Checking who this reaches…
          </p>
        )}

        {audience && !pass && (
          <>
            <p className="text-sm text-gray-700">
              This sends your post to{' '}
              <strong>
                {audience.remaining} {audience.remaining === 1 ? 'member' : 'members'}
              </strong>{' '}
              by email. It stays in the Commons either way.
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Subject: <span className="text-gray-700">{audience.subject}</span>
            </p>

            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                An email can&rsquo;t be taken back. Members who turned announcements off
                won&rsquo;t get it, and everyone who does gets a link to stop them.
              </span>
            </div>
          </>
        )}

        {pass && (
          <p className="text-sm text-gray-700" aria-live="polite">
            {progressLine(pass, done)}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            {done ? 'Done' : 'Cancel'}
          </button>
          {!done && (
            <button
              type="button"
              onClick={send}
              disabled={sending || !audience || audience.remaining === 0}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {sending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sending…
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-4 w-4" aria-hidden />
                  Send to {audience?.remaining ?? 0}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
