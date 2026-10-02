'use client';

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { BelongingEmailTemplate } from '@/lib/api';

/** What each email is for, in the words an organizer would use. */
const EMAIL_LABELS: Record<string, string> = {
  BUDDY_INVITATION: 'Asking somebody to be a buddy',
  OFF_THE_HOOK: 'Telling a non-responder they owe nothing',
  INTRO_TO_BUDDY: 'Introducing the new member to their buddy',
  INTRO_TO_NEW_MEMBER: 'Introducing the buddy to the new member',
  REQUIRED_READING: 'Announcing something everyone must read',
  WELCOME: 'Welcoming somebody who has just become a member',
};

/**
 * One email, editable.
 *
 * The variables are listed rather than documented elsewhere, because an admin
 * writing this has one question — "what can I put in it?" — and answering it
 * anywhere but on the same screen means they will not go and look.
 *
 * The server validates and returns every problem at once; they are shown as a
 * list, unsaved, so nobody has to fix one thing per attempt.
 */
export function EmailEditor({
  template,
  onSave,
  onReset,
}: {
  template: BelongingEmailTemplate;
  onSave: (subject: string, body: string) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex flex-wrap w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="font-medium text-gray-900">
            {EMAIL_LABELS[template.kind] ?? template.kind}
          </span>
          <span className="mt-0.5 block truncate text-xs text-gray-500">{template.subject}</span>
        </span>
        <span className="shrink-0 text-xs text-gray-500">
          {template.isCustom ? 'Yours' : 'MaybeOS’s'}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-gray-100 p-4">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Message</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed"
            />
          </label>

          <p className="text-xs text-gray-500">
            You can use{' '}
            {template.variables.map((v, i) => (
              <span key={v}>
                {i > 0 && ', '}
                <code className="rounded bg-gray-100 px-1 py-0.5">{`{{${v}}}`}</code>
              </span>
            ))}
            . Anything ending in <code className="rounded bg-gray-100 px-1 py-0.5">_url</code>{' '}
            becomes a button and needs a line to itself.
          </p>

          {problems.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setProblems([]);
                try {
                  await onSave(subject, body);
                  setOpen(false);
                } catch (err) {
                  const message = err instanceof Error ? err.message : 'That did not save';
                  // The API answers with every problem at once so nobody has
                  // to fix one thing per attempt.
                  setProblems(message.split('\n').filter(Boolean));
                } finally {
                  setSaving(false);
                }
              }}
              className="btn-primary text-sm"
            >
              {saving && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />}
              Save
            </button>
            {template.isCustom && (
              <button
                onClick={async () => {
                  await onReset();
                  setOpen(false);
                }}
                className="btn-secondary text-sm"
              >
                <RotateCcw className="mr-1.5 inline h-4 w-4" />
                Use MaybeOS&rsquo;s wording
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
