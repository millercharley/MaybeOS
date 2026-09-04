'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import {
  api,
  BelongingEmailTemplate,
  BelongingSettings,
  BuddyInvitationRow,
  BuddyMemberRow,
  BuddyPairingRow,
  BuddySuggestion,
} from '@/lib/api';
import { apiUrl } from '@/lib/api';
import { timeAgo } from '@/lib/relative-time';
import { downloadAuthenticated } from '@/lib/download';
import { PageHeader } from '@/components/layout/page-header';

type Tab = 'settings' | 'pairs' | 'invitations' | 'members' | 'suggestions' | 'emails';

/**
 * Belonging Support, for an organiser (PRD §4, §5.4, §5.5).
 *
 * The tabs are ordered the way a co-op actually adopts this: turn it on,
 * watch what happens, then tune what the buddy is prompted to say. The log
 * comes before the suggestions because a co-op that has not yet seen a pairing
 * has nothing to write suggestions about.
 */
export default function BelongingPage() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [tab, setTab] = useState<Tab>('settings');
  const [settings, setSettings] = useState<BelongingSettings | null>(null);
  const [pairs, setPairs] = useState<BuddyPairingRow[]>([]);
  const [invitations, setInvitations] = useState<BuddyInvitationRow[]>([]);
  const [members, setMembers] = useState<BuddyMemberRow[]>([]);
  const [suggestions, setSuggestions] = useState<BuddySuggestion[]>([]);
  const [templates, setTemplates] = useState<BelongingEmailTemplate[]>([]);
  const [newSuggestion, setNewSuggestion] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      const [s, p, i, m, sg, tp] = await Promise.all([
        api.belonging.settings(orgId, token),
        api.belonging.pairings(orgId, token),
        api.belonging.invitations(orgId, token),
        api.belonging.buddyMembers(orgId, token),
        api.belonging.suggestions(orgId, token),
        api.belonging.emailTemplates(orgId, token),
      ]);
      setSettings(s);
      setPairs(p);
      setInvitations(i);
      setMembers(m);
      setSuggestions(sg);
      setTemplates(tp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this');
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Partial<BelongingSettings>) => {
    if (!token || !orgId || !settings) return;
    setSettings({ ...settings, ...patch });
    setBusy(true);
    try {
      setSettings(await api.belonging.updateSettings(orgId, patch, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  const tabs: Array<[Tab, string]> = [
    ['settings', 'Settings'],
    ['pairs', `Pairs (${pairs.filter((p) => p.state === 'ACTIVE').length})`],
    ['invitations', 'Invitations'],
    ['members', 'Who has been asked'],
    ['suggestions', 'Buddy suggestions'],
    ['emails', 'Emails'],
  ];

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Belonging Support"
          description="Making sure a new member knows one person by name, and knows what this place expects."
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'settings' && (
        <div className="space-y-4">
          <Toggle
            label="Buddy System"
            help="Pairs each new member with somebody who has agreed to welcome them. Off means no pairings and no emails at all."
            checked={settings.buddySystemEnabled}
            onChange={(v) => save({ buddySystemEnabled: v })}
            busy={busy}
          />

          {settings.buddySystemEnabled && (
            <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2">
              <Number
                label="Hours to answer an invitation"
                help="After this it passes to somebody else, and the person who didn’t answer is told they’re off the hook."
                value={settings.buddyInviteTimeoutHours}
                onChange={(v) => save({ buddyInviteTimeoutHours: v })}
              />
              <Number
                label="Days before asking the same person again"
                help="Relaxed automatically when it would leave nobody to ask."
                value={settings.buddyAskCooldownDays}
                onChange={(v) => save({ buddyAskCooldownDays: v })}
              />
              <Number
                label="Days before asking someone who has served"
                value={settings.buddyServeCooldownDays}
                onChange={(v) => save({ buddyServeCooldownDays: v })}
              />
              <Number
                label="How many new members one person can have at once"
                value={settings.buddyMaxActivePairings}
                onChange={(v) => save({ buddyMaxActivePairings: v })}
              />
            </div>
          )}

          <Toggle
            label="Welcoming"
            help="A place to write down how this community works, and — where you choose — to ask members to read and agree before they post."
            checked={settings.knowledgeCenterEnabled}
            onChange={(v) => save({ knowledgeCenterEnabled: v })}
            busy={busy}
          />

          {settings.knowledgeCenterEnabled && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <Number
                label="Days existing members have to read something new"
                help="People who were already here keep full access for this long after you publish. Anyone joining afterwards is asked at the door."
                value={settings.requiredReadingGraceDays}
                onChange={(v) => save({ requiredReadingGraceDays: v })}
              />
            </div>
          )}
        </div>
      )}

      {tab === 'pairs' && (
        <Table
          empty="Nobody has been paired yet."
          head={['New member', 'Buddy', 'Paired', 'Talking?', '']}
          rows={pairs.map((p) => [
            p.newMember.name ?? '—',
            p.buddy?.name ?? <span className="text-gray-400">looking…</span>,
            p.pairedAt ? timeAgo(p.pairedAt) : '—',
            // The number worth acting on. A pair that exists and has never
            // spoken is the failure this whole tool is meant to prevent.
            p.messageExchanged ? (
              <span className="text-green-700">yes</span>
            ) : p.silent ? (
              <span className="font-medium text-amber-700">no, for a fortnight</span>
            ) : (
              <span className="text-gray-400">not yet</span>
            ),
            <button
              key="close"
              onClick={async () => {
                if (!token || !orgId) return;
                await api.belonging.closePairing(orgId, p.id, undefined, token);
                await load();
              }}
              className="text-xs text-gray-500 underline hover:text-gray-900"
            >
              Close
            </button>,
          ])}
          view="pairings"
          orgId={orgId}
          token={token}
        />
      )}

      {tab === 'invitations' && (
        <Table
          empty="Nobody has been asked yet."
          head={['Asked', 'For', 'Sent', 'Answer']}
          rows={invitations.map((i) => [
            i.candidate.name ?? '—',
            i.newMember ?? '—',
            timeAgo(i.sentAt),
            i.state.toLowerCase(),
          ])}
          view="invitations"
          orgId={orgId}
          token={token}
        />
      )}

      {tab === 'members' && (
        <Table
          empty="No history yet."
          head={['Member', 'Asked', 'Served', 'Last asked', 'Opted out']}
          rows={members.map((m) => [
            m.name ?? '—',
            m.timesAsked,
            m.timesServed,
            m.lastAskedAt ? timeAgo(m.lastAskedAt) : 'never',
            m.optedOut ? 'yes' : '',
          ])}
          view="members"
          orgId={orgId}
          token={token}
        />
      )}

      {tab === 'emails' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            The five emails this sends, in your words if you want them. Leave one alone and it uses
            MaybeOS&rsquo;s wording — which means you also get any improvements to it, rather than a
            copy frozen on the day you joined.
          </p>
          {templates.map((t) => (
            <EmailEditor
              key={t.kind}
              template={t}
              onSave={async (subject, body) => {
                if (!token || !orgId) return;
                await api.belonging.saveEmailTemplate(orgId, t.kind, { subject, body }, token);
                await load();
              }}
              onReset={async () => {
                if (!token || !orgId) return;
                await api.belonging.resetEmailTemplate(orgId, t.kind, token);
                await load();
              }}
            />
          ))}
        </div>
      )}

      {tab === 'suggestions' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Short prompts a buddy sees above the message box, in their conversation with the person
            they’re welcoming. Tapping one drops it into the composer to edit — nothing sends
            automatically, and the new member never sees these.
          </p>

          <div className="flex gap-2">
            <input
              value={newSuggestion}
              onChange={(e) => setNewSuggestion(e.target.value)}
              placeholder="Offer to meet them at the space and give them a tour."
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              disabled={!newSuggestion.trim() || !token || !orgId}
              onClick={async () => {
                if (!token || !orgId) return;
                await api.belonging.createSuggestion(orgId, newSuggestion.trim(), token);
                setNewSuggestion('');
                await load();
              }}
              className="btn-primary text-sm"
            >
              <Plus className="mr-1 inline h-4 w-4" />
              Add
            </button>
          </div>

          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {suggestions.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-gray-500">
                No suggestions yet.
              </li>
            )}
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex-1 text-sm text-gray-800">{s.body}</span>
                <button
                  onClick={async () => {
                    if (!token || !orgId) return;
                    await api.belonging.deleteSuggestion(orgId, s.id, token);
                    await load();
                  }}
                  aria-label="Delete"
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const EMAIL_LABELS: Record<string, string> = {
  BUDDY_INVITATION: 'Asking somebody to be a buddy',
  OFF_THE_HOOK: 'Telling a non-responder they owe nothing',
  INTRO_TO_BUDDY: 'Introducing the new member to their buddy',
  INTRO_TO_NEW_MEMBER: 'Introducing the buddy to the new member',
  REQUIRED_READING: 'Announcing something everyone must read',
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
function EmailEditor({
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

function Toggle({
  label,
  help,
  checked,
  onChange,
  busy,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  busy: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <input
        type="checkbox"
        checked={checked}
        disabled={busy}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600"
      />
      <span>
        <span className="font-medium text-gray-900">{label}</span>
        <span className="mt-0.5 block text-sm text-gray-500">{help}</span>
      </span>
    </label>
  );
}

function Number({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <input
        type="number"
        defaultValue={value}
        onBlur={(e) => {
          const next = parseInt(e.target.value, 10);
          if (!isNaN(next) && next !== value) onChange(next);
        }}
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      {help && <span className="mt-1 block text-xs text-gray-500">{help}</span>}
    </label>
  );
}

function Table({
  head,
  rows,
  empty,
  view,
  orgId,
  token,
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
  view: 'pairings' | 'invitations' | 'members';
  orgId: string | null;
  token: string | null;
}) {
  const [failed, setFailed] = useState('');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-3">
        {failed && <span className="text-xs text-red-700">{failed}</span>}
        {/* A fetch, not a link: the endpoint wants a bearer token and an
            `<a href>` cannot carry one, so the link version answered 401 and
            the file never arrived. */}
        <button
          onClick={async () => {
            if (!orgId || !token) return;
            setFailed('');
            try {
              await downloadAuthenticated(
                apiUrl(`/orgs/${orgId}/belonging/buddy/export.csv?view=${view}`),
                `buddy-${view}.csv`,
                token,
              );
            } catch (err) {
              setFailed(err instanceof Error ? err.message : 'That did not download');
            }
          }}
          className="btn-secondary text-xs"
        >
          <Download className="mr-1 inline h-3.5 w-3.5" />
          CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={head.length} className="px-4 py-8 text-center text-gray-500">
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-3 text-gray-800">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
