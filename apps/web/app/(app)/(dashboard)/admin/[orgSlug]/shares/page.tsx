'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, Plus, Search, X, AlertTriangle, Check } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, LedgerAdminMember, LedgerAdminView, LedgerHistory } from '@/lib/api';
import { GRANT_KINDS, GRANT_LABELS, GrantKind, formatOwnership, formatShares } from '@/lib/ledger';
import { PageHeader } from '@/components/layout/page-header';
import { MemberName } from '@/components/member/member-name';

/** Every kind but the adjustment, which only "Set total" records. */
const GRANTABLE = GRANT_KINDS.filter((kind) => kind !== 'ADJUSTMENT');

/**
 * Shares & ownership, for organisers (MEM-19).
 *
 * Every member with what they hold; a way to grant to one member or to a
 * selection at once; and a member's history, where a balance is corrected by
 * recording the difference — never by editing a line that already exists.
 *
 * Only when the co-op has turned share tracking on. Off, this page says so
 * and points at the switch, rather than letting an organiser build a ledger
 * nobody can see and nobody asked for.
 */
export default function SharesPage(props: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = use(props.params);
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [view, setView] = useState<LedgerAdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [managing, setManaging] = useState<LedgerAdminMember | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = useCallback(async () => {
    if (!orgId || !token) return;
    try {
      setView(await api.ledger.adminView(orgId, token));
      setFailure('');
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Shares could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [orgId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const tiers = useMemo(
    () =>
      [...new Set((view?.members ?? []).map((m) => m.tierName).filter((t): t is string => Boolean(t)))].sort(),
    [view],
  );

  const visible = useMemo(
    () =>
      (view?.members ?? []).filter(
        (m) =>
          (!search || (m.user.name ?? '').toLowerCase().includes(search.toLowerCase())) &&
          (!tier || m.tierName === tier),
      ),
    [view, search, tier],
  );

  const allVisibleSelected = visible.length > 0 && visible.every((m) => selected.has(m.userId));
  const chosen = (view?.members ?? []).filter((m) => selected.has(m.userId));

  function toggle(userId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  // "Everyone on screen", so a tier filter plus this is "every Sustainer".
  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const m of visible) {
        if (allVisibleSelected) next.delete(m.userId);
        else next.add(m.userId);
      }
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const total = view?.totalShares ?? 0;

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/${orgSlug}/members`}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Members
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Shares & ownership"
          description="What each member holds. Every member sees this on the Members page."
        />
        {view?.sharesEnabled && (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/${orgSlug}/members/import/ledger`}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Upload className="h-4 w-4" />
              Import cap table
            </Link>
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              disabled={chosen.length === 0}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              {chosen.length === 0 ? 'Grant shares' : `Grant to ${chosen.length} selected`}
            </button>
          </div>
        )}
      </div>

      {failure && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{failure}</p>}
      {notice && (
        <p className="flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
        </p>
      )}

      {view && !view.sharesEnabled && (
        <section className="card space-y-2">
          <h2 className="text-base font-semibold text-gray-900">Share tracking is off</h2>
          <p className="text-sm text-gray-500">
            This co-op doesn&apos;t track shares or ownership, so members see a plain directory. Turn it
            on in Settings to record shares here and show them to every member.
          </p>
          <Link href={`/admin/${orgSlug}/settings`} className="btn-primary inline-flex text-sm">
            Go to Settings
          </Link>
        </section>
      )}

      {view?.sharesEnabled && (
        <>
          <section className="grid gap-4 sm:grid-cols-4">
            <Figure label="Shares distributed" value={formatShares(total)} />
            <Figure label="Members holding shares" value={String(view.members.filter((m) => m.shares > 0).length)} />
            <Figure label="From the cap table" value={formatShares(view.importedShares)} />
            <Figure label="Granted in MaybeOS" value={formatShares(view.grantedShares)} />
          </section>

          {view.importedShares !== 0 && view.grantedShares !== 0 && (
            <p className="text-xs text-gray-500">
              Re-importing the cap table replaces only the previous import — shares granted here are kept.
              If the sheet already includes them, they would be counted twice.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search members..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input w-full pl-10"
              />
            </div>
            {tiers.length > 0 && (
              <select value={tier} onChange={(e) => setTier(e.target.value)} className="input">
                <option value="">Every tier</option>
                {tiers.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select everyone shown"
                      checked={allVisibleSelected}
                      onChange={toggleVisible}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Tier</th>
                  <th className="px-4 py-3 text-right font-medium">Shares</th>
                  <th className="px-4 py-3 text-right font-medium">Ownership</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Manage</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((member) => (
                  <tr key={member.userId} className={selected.has(member.userId) ? 'bg-brand-50/40' : undefined}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${member.user.name ?? 'member'}`}
                        checked={selected.has(member.userId)}
                        onChange={() => toggle(member.userId)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <MemberName userId={member.userId} name={member.user.name ?? 'Member'} className="font-medium text-gray-900" />
                      {!member.isPublic && <span className="ml-2 text-xs text-gray-400">Hidden</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{member.tierName ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900">{formatShares(member.shares)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                      {formatOwnership(member.shares, total)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setManaging(member)}
                        className="text-sm font-medium text-brand-600 hover:text-brand-700"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                      No members match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {view.unlinked.length > 0 && (
            <details className="card">
              <summary className="cursor-pointer text-sm font-medium text-gray-900">
                {view.unlinked.length} cap-table {view.unlinked.length === 1 ? 'holder' : 'holders'} not in MaybeOS yet ·{' '}
                {formatShares(view.unlinked.reduce((sum, u) => sum + u.shares, 0))} shares
              </summary>
              <p className="mt-2 text-xs text-gray-500">
                Their shares count toward the total. Each appears on the Members page by name the day
                their membership exists.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {view.unlinked.map((holder, i) => (
                      <tr key={`${holder.name}-${i}`}>
                        <td className="py-2 text-gray-700">{holder.name ?? 'Unnamed holder'}</td>
                        <td className="py-2 text-right tabular-nums text-gray-900">{formatShares(holder.shares)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      {managing && orgId && token && (
        <ManageMember
          orgId={orgId}
          token={token}
          member={managing}
          total={total}
          onClose={() => setManaging(null)}
          onChanged={load}
        />
      )}

      {bulkOpen && orgId && token && (
        <BulkGrant
          orgId={orgId}
          token={token}
          members={chosen}
          onClose={() => setBulkOpen(false)}
          onDone={(message) => {
            setBulkOpen(false);
            setSelected(new Set());
            setNotice(message);
            load();
          }}
        />
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

/** A dialog shell shared by the two below. Escape closes it. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-12" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

const wholeNumber = (text: string) => {
  const n = Number(text.replace(/,/g, '').trim());
  return Number.isInteger(n) ? n : NaN;
};

/**
 * One member's shares: their balance, a grant, a corrected total, and every
 * line that got them here.
 */
function ManageMember({
  orgId,
  token,
  member,
  total,
  onClose,
  onChanged,
}: {
  orgId: string;
  token: string;
  member: LedgerAdminMember;
  total: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [history, setHistory] = useState<LedgerHistory | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<GrantKind>('ANNUAL');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [newTotal, setNewTotal] = useState('');
  const [totalNote, setTotalNote] = useState('');

  const reload = useCallback(async () => {
    try {
      setHistory(await api.ledger.history(orgId, member.userId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'History could not be loaded.');
    }
  }, [orgId, member.userId, token]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  const grantShares = wholeNumber(amount);
  const targetTotal = wholeNumber(newTotal);
  const balance = history?.balance ?? member.shares;
  const name = member.user.name ?? 'This member';

  return (
    <Dialog title={name} onClose={onClose}>
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <p className="text-3xl font-semibold tabular-nums text-gray-900">{formatShares(balance)}</p>
          <p className="text-xs text-gray-500">shares</p>
        </div>
        <div>
          <p className="text-3xl font-semibold tabular-nums text-gray-900">{formatOwnership(balance, total)}</p>
          <p className="text-xs text-gray-500">of the co-op</p>
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-gray-900">Grant shares</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as GrantKind)} className="input">
            {GRANTABLE.map((k) => (
              <option key={k} value={k}>
                {GRANT_LABELS[k]}
              </option>
            ))}
          </select>
          <input
            inputMode="numeric"
            placeholder="Shares"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input w-32"
          />
          <input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="input min-w-[10rem] flex-1"
          />
          <button
            type="button"
            disabled={busy || !(grantShares > 0)}
            onClick={() =>
              run(async () => {
                await api.ledger.grant(orgId, { userIds: [member.userId], kind, shares: grantShares, note: note || undefined }, token);
                setAmount('');
                setNote('');
              })
            }
            className="btn-primary text-sm"
          >
            Grant
          </button>
        </div>
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-gray-900">Set the total</h3>
        <p className="mt-1 text-xs text-gray-500">
          For a correction. The difference is recorded as its own adjustment line — the lines below stay as they are.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            inputMode="numeric"
            placeholder={formatShares(balance)}
            value={newTotal}
            onChange={(e) => setNewTotal(e.target.value)}
            className="input w-32"
          />
          <input
            placeholder="Why (optional)"
            value={totalNote}
            onChange={(e) => setTotalNote(e.target.value)}
            maxLength={500}
            className="input min-w-[10rem] flex-1"
          />
          <button
            type="button"
            disabled={busy || !history || !(targetTotal >= 0) || targetTotal === balance}
            onClick={() =>
              run(async () => {
                await api.ledger.setTotal(
                  orgId,
                  member.userId,
                  { total: targetTotal, expectedCurrent: balance, note: totalNote || undefined },
                  token,
                );
                setNewTotal('');
                setTotalNote('');
              })
            }
            className="btn-secondary text-sm"
          >
            Set total
          </button>
        </div>
        {newTotal && targetTotal >= 0 && targetTotal !== balance && (
          <p className="mt-1 text-xs text-gray-500">
            Records an adjustment of {targetTotal > balance ? '+' : '−'}
            {formatShares(Math.abs(targetTotal - balance))}.
          </p>
        )}
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-gray-900">History</h3>
        {!history ? (
          <p className="mt-2 text-sm text-gray-400">Loading…</p>
        ) : history.lines.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">No shares recorded yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="pb-2 pr-3 font-medium">When</th>
                  <th className="pb-2 pr-3 font-medium">Kind</th>
                  <th className="pb-2 pr-3 text-right font-medium">Shares</th>
                  <th className="pb-2 font-medium">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="py-2 pr-3 text-gray-500">{new Date(line.recordedAt).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 text-gray-900">
                      {GRANT_LABELS[line.kind]}
                      {line.note && <span className="block text-xs text-gray-500">{line.note}</span>}
                    </td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${line.shares < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {line.shares > 0 ? '+' : ''}
                      {formatShares(line.shares)}
                    </td>
                    <td className="py-2 text-xs text-gray-500">
                      {line.source === 'IMPORT' ? 'Cap table import' : `In MaybeOS${line.grantedBy ? ` by ${line.grantedBy}` : ''}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Dialog>
  );
}

/** The same grant to everyone selected, all or nothing. */
function BulkGrant({
  orgId,
  token,
  members,
  onClose,
  onDone,
}: {
  orgId: string;
  token: string;
  members: LedgerAdminMember[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [kind, setKind] = useState<GrantKind>('ANNUAL');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const each = wholeNumber(amount);
  const valid = each > 0;
  const shown = members.slice(0, 8).map((m) => m.user.name ?? 'Member');

  async function grant() {
    setBusy(true);
    setError('');
    try {
      const result = await api.ledger.grant(
        orgId,
        { userIds: members.map((m) => m.userId), kind, shares: each, note: note || undefined },
        token,
      );
      onDone(
        `Granted ${formatShares(result.sharesEach)} ${GRANT_LABELS[kind].toLowerCase()} shares to ${result.members} ${
          result.members === 1 ? 'member' : 'members'
        } — ${formatShares(result.totalGranted)} in all.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nothing was granted.');
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Grant shares to ${members.length} ${members.length === 1 ? 'member' : 'members'}`} onClose={onClose}>
      <p className="text-sm text-gray-600">
        {shown.join(', ')}
        {members.length > shown.length && ` and ${members.length - shown.length} more`}.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-gray-900">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as GrantKind)} className="input mt-1 w-full">
            {GRANTABLE.map((k) => (
              <option key={k} value={k}>
                {GRANT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-900">Shares for each member</span>
          <input
            inputMode="numeric"
            placeholder="100"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input mt-1 w-full"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-gray-900">Note</span>
          <input
            placeholder="2026 annual patronage grant"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="input mt-1 w-full"
          />
        </label>
      </div>

      {valid && (
        <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
          {members.length} {members.length === 1 ? 'member' : 'members'} × {formatShares(each)} ={' '}
          <b className="text-gray-900">{formatShares(each * members.length)} shares</b>, each recorded as its own line.
        </p>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={grant} disabled={busy || !valid} className="btn-primary">
          {busy ? 'Granting…' : 'Grant shares'}
        </button>
        <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
