'use client';

import { useState } from 'react';
import { X, Users } from 'lucide-react';
import { MemberPicker } from '@/components/member/member-picker';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { api, type Member, type ThreadDetail } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { isBlankBody } from '@/lib/rich-text';

/** As many as a conversation holds, matching the API (CMN-16). */
const MAX_OTHERS = 19;

/**
 * Write to one or more members (CMN-16).
 *
 * Charley: "the user can type in one or more members, select that member or
 * members from the search list that appears as they type, and then compose a
 * message and send it. This can be a group message thread or an individual DM
 * thread."
 *
 * It does not ask which of those you want. One name is a DM, several are a
 * group, and the only thing the composer does differently is show more chips —
 * because underneath they are the same object.
 *
 * The search is `MemberPicker`, the same server-side typeahead the event form
 * uses (EVT-36): MaybeItsFate has 426 members, so a picker that filtered a
 * page already loaded would only ever find the first twenty names.
 */
export function NewMessage({
  orgId,
  onSent,
  onCancel,
}: {
  orgId: string;
  /** The thread that now exists — new, or the one these people already had. */
  onSent: (thread: ThreadDetail) => void;
  onCancel: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [chosen, setChosen] = useState<Member[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const ids = chosen.map((m) => m.user.id);
  const full = chosen.length >= MAX_OTHERS;

  function add(member: Member) {
    if (ids.includes(member.user.id) || full) return;
    setChosen((prev) => [...prev, member]);
    setError('');
  }

  function remove(id: string) {
    setChosen((prev) => prev.filter((m) => m.user.id !== id));
  }

  async function send() {
    if (!token) return;
    if (ids.length === 0) {
      setError('Choose at least one person to write to.');
      return;
    }
    if (isBlankBody(body)) {
      setError('Write something to send.');
      return;
    }

    setSending(true);
    setError('');
    try {
      onSent(
        await api.commons.startThread(orgId, { userIds: ids, body: composerValue(body) }, token),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not send.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">New message</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-gray-500 hover:text-gray-800"
        >
          Cancel
        </button>
      </div>

      <label className="mb-1 block text-xs font-medium text-gray-500">To</label>

      {/* The people chosen so far, each removable. Chips rather than a list,
          so adding a fourth name does not push the message box off screen. */}
      {chosen.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {chosen.map((m) => (
            <li key={m.user.id}>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1 text-sm text-brand-700">
                {m.user.name ?? 'A member'}
                <button
                  type="button"
                  onClick={() => remove(m.user.id)}
                  aria-label={`Remove ${m.user.name ?? 'this member'}`}
                  className="rounded-full p-0.5 hover:bg-brand-100"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="mb-3 text-xs text-gray-500">
          That is as many as a conversation holds. For more people than this, post in a channel.
        </p>
      ) : (
        <div className="mb-3">
          <MemberPicker
            orgId={orgId}
            onPick={add}
            exclude={ids}
            placeholder={chosen.length === 0 ? 'Start typing a name…' : 'Add somebody else…'}
          />
        </div>
      )}

      {/* Said before sending rather than after: who else can read this is the
          one thing about a group message somebody wants to be sure of. */}
      {chosen.length > 1 && (
        <p className="mb-3 inline-flex items-center gap-1.5 text-xs text-gray-500">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          A group conversation. All {chosen.length + 1} of you see every reply.
        </p>
      )}

      <RichComposer
        value={body}
        onChange={setBody}
        onSubmit={send}
        placeholder="Write your message…"
        submitLabel={sending ? 'Sending…' : 'Send'}
        rows={3}
      />

      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
    </section>
  );
}
