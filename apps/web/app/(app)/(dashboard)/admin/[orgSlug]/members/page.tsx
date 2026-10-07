'use client';

import { useState, useEffect, FormEvent, MouseEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PieChart, Search, Plus, MoreHorizontal, Clock, RefreshCw, Mail, Upload } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { MENU_WIDTH, menuPosition, payingDues } from '@/lib/member-removal';
import { MANUAL_STATUSES, STATUS_LABEL, STRIPE_OWNS_IT, canSetStatus } from '@/lib/member-status';
import {
  PER_PAGE,
  SEARCH_DEBOUNCE_MS,
  appendPage,
  hasMore,
  rosterCount,
} from '@/lib/member-roster';
import { useAuthStore } from '@/lib/auth-store';
import { api, type Member } from '@/lib/api';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/layout/page-header';
import { MemberName } from '@/components/member/member-name';
import { lastSeenLabel, neverSignedIn } from '@/lib/last-seen';

const roleBadge: Record<string, string> = {
  ADMIN: 'badge-success',
  MEMBER: 'badge-info',
  STAFF: 'badge-warning',
  GUEST: 'bg-yellow-50 text-yellow-700',
};

const statusBadge: Record<string, string> = {
  ACTIVE: 'badge-success',
  PAST_DUE: 'badge-warning',
  CANCELED: 'badge-danger',
};

export default function MembersPage() {
  const orgSlug = useParams<{ orgSlug: string }>().orgSlug;
  const [search, setSearch] = useState('');
  /**
   * The roster, a page at a time (MEM-22).
   *
   * `query` lags `search` by a moment so typing is not one request per
   * keystroke, and it is the server that searches: filtering the rows the
   * browser was holding meant a 426-member co-op searched 50 of them and
   * answered "No members found".
   */
  const [query, setQuery] = useState('');
  const [more, setMore] = useState<Member[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');
  const [inviteTierId, setInviteTierId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  /**
   * Which member's menu is open, and which one is being removed.
   *
   * The menu button had no handler at all until 2026-10-02 — it rendered and
   * did nothing, which is the only reason nobody had met the bug underneath
   * it: removing a member used to delete the row and leave their dues
   * running.
   */
  const [openMenu, setOpenMenu] = useState<{
    member: Member;
    top: number;
    left: number;
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');

  // A viewport-positioned menu does not travel with the row it belongs to, so
  // anything that moves the row has to close it rather than leave it pointing
  // at somebody else's name.
  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [openMenu]);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState<string | null>(null);
  const [roleError, setRoleError] = useState('');
  const token = useAuthStore((s) => s.token);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  const { data, loading, error, refetch } = useApi(
    (token, orgId) => api.members.list(orgId, token, 1, PER_PAGE, query || undefined),
    [query],
  );

  // A new first page replaces everything after it; the pages that followed
  // belonged to the old search.
  useEffect(() => {
    setMore([]);
    setPage(1);
    setMoreError('');
  }, [data]);

  /** Everyone loaded so far: the first page, plus every page since. */
  const shown = [...(data?.data ?? []), ...more];

  const { data: tiers } = useApi(
    (token, orgId) => api.members.listTiersForAdmin(orgId, token),
    [],
  );

  const { data: invitations, refetch: refetchInvites } = useApi(
    (token, orgId) => api.members.listInvitations(orgId, token),
    [],
  );

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!token || !currentOrgId || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteResult(null);
    try {
      await api.members.invite(
        currentOrgId,
        {
          email: inviteEmail.trim(),
          role: inviteRole,
          // Sent only when chosen. An invitation with no tier means joining
          // without dues, which is right for staff and for co-ops that do not
          // charge — so an empty picker must not become an empty-string tier.
          ...(inviteTierId ? { tierId: inviteTierId } : {}),
        },
        token,
      );
      setInviteResult({ type: 'success', message: `Invitation sent to ${inviteEmail.trim()}` });
      setInviteEmail('');
      setInviteRole('MEMBER');
      setInviteTierId('');
      refetchInvites();
      setTimeout(() => {
        setShowInvite(false);
        setInviteResult(null);
      }, 2000);
    } catch (err) {
      setInviteResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to send invitation' });
    } finally {
      setInviting(false);
    }
  }

  async function handleResend(inviteId: string) {
    if (!token || !currentOrgId) return;
    setResendingId(inviteId);
    try {
      await api.members.resendInvite(currentOrgId, inviteId, token);
      refetchInvites();
    } catch (err) {
      // Swallowed silently before: "Resend" looked identical whether the
      // email went out or the request failed. Reuses the banner the invite
      // form already renders rather than adding a second one.
      setInviteResult({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not resend that invitation',
      });
    }
    setResendingId(null);
  }

  // Only while there is nothing to show yet. Searching refetches, and a
  // spinner in place of the page would unmount the search box and take the
  // cursor with it on every keystroke that reaches the server (MEM-22).
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        Failed to load members: {error}
      </div>
    );
  }

  const pendingInvites = (invitations ?? []).filter(
    (inv) => !inv.acceptedAt,
  );

  const filtered = shown;


  async function changeRole(userId: string, role: string) {
    if (!token || !currentOrgId) return;
    setSavingRole(userId);
    setRoleError('');
    try {
      await api.members.updateRole(currentOrgId, userId, role, token);
      refetch();
    } catch (err) {
      // Shown, not swallowed: the refusal an admin will actually hit is
      // "this is the co-op's only organiser", and that sentence is the
      // whole point of the guard.
      setRoleError(err instanceof Error ? err.message : 'Could not change that role');
    } finally {
      setSavingRole(null);
    }
  }

  /** One item today; the height is pinned so the flip-up maths has a number. */
  const MENU_HEIGHT = 44;

  /**
   * Open the row menu against the viewport rather than the cell (UI-02).
   *
   * The table scrolls sideways inside its card, and a menu positioned inside
   * that card is clipped by it — which is what Charley hit: the menu appeared,
   * mostly past the edge, and nothing would scroll to the rest of it.
   */
  function toggleMenu(event: MouseEvent<HTMLButtonElement>, member: Member) {
    if (openMenu?.member.id === member.id) {
      setOpenMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const where = menuPosition(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      MENU_HEIGHT,
    );
    setOpenMenu({ member, ...where });
  }

  /**
   * Remove somebody from the co-op, and stop their dues (MEM-20).
   *
   * The API cancels the subscription first and refuses the whole thing if the
   * cancel fails, so a failure here means they are still a member and still
   * paying — which is the state the message has to describe.
   */
  /** The next page, appended to what is already on screen. */
  async function loadMore() {
    if (!token || !currentOrgId || loadingMore) return;
    setLoadingMore(true);
    setMoreError('');
    try {
      const next = await api.members.list(
        currentOrgId,
        token,
        page + 1,
        PER_PAGE,
        query || undefined,
      );
      // Deduplicated: the roster is ordered by join date, so somebody
      // joining while this page is open shifts every later row down one and
      // page 2 legitimately repeats a name from page 1.
      const first = data?.data ?? [];
      setMore((current) =>
        appendPage([...first, ...current], next.data ?? []).slice(first.length),
      );
      setPage((current) => current + 1);
    } catch (err) {
      setMoreError(err instanceof Error ? err.message : 'Could not load any more');
    } finally {
      setLoadingMore(false);
    }
  }

  async function removeMember(member: Member) {
    if (!token || !currentOrgId) return;
    setRemoving(true);
    setRemoveError('');
    try {
      await api.members.remove(currentOrgId, member.user.id, token);
      setConfirmRemove(null);
      refetch();
    } catch (err) {
      setRemoveError(
        err instanceof Error ? err.message : 'Could not remove them. Nothing was changed.',
      );
    } finally {
      setRemoving(false);
    }
  }

  /**
   * Set a status by hand (MEM-23).
   *
   * The API refuses it for anybody Stripe is billing, so the failure an
   * organiser can actually hit is worth showing rather than swallowing — it
   * names who is deciding instead.
   */
  async function changeStatus(userId: string, status: string) {
    if (!token || !currentOrgId) return;
    setSavingStatus(userId);
    setRoleError('');
    try {
      await api.members.setStatus(currentOrgId, userId, status, token);
      refetch();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Could not change that status');
    } finally {
      setSavingStatus(null);
    }
  }

  /** Whether this member may share events to the co-op's Facebook and Instagram (SOC-01). */
  async function changeSocial(userId: string, value: string) {
    if (!token || !currentOrgId) return;
    setSavingRole(userId);
    setRoleError('');
    try {
      await api.social.setMember(currentOrgId, userId, value === '' ? null : value === 'on', token);
      refetch();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Could not change that');
    } finally {
      setSavingRole(null);
    }
  }

  return (
    <div className="space-y-6">
      {roleError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{roleError}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Members"
        />
        <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/${orgSlug}/shares`}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <PieChart className="h-4 w-4" />
          Shares
        </Link>
        <Link
          href={`/admin/${orgSlug}/members/import`}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Upload className="h-4 w-4" />
          Import
        </Link>
        <button
          onClick={() => { setShowInvite(true); setInviteResult(null); }}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Invite Member
        </button>
        </div>
      </div>

      <Modal open={showInvite} onClose={() => setShowInvite(false)} title="Invite Member">
        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email Address</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="member@example.com"
              className="input w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="input w-full"
            >
              <option value="MEMBER">Member</option>
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
              <option value="GUEST">Guest</option>
            </select>
          </div>
          {/*
            The tier the invitation is for (MEM-04). Accepting used to create a
            membership with no tier, so an invited member joined free while
            somebody arriving through the public page paid — one co-op, two
            prices, decided by which door you came through.

            The default hands the choice to the invitee rather than assigning
            nothing (MEM-15): "No dues" was doing double duty as both "this
            person doesn't pay" and "I haven't decided", and the second one
            silently became the first. Now the invitation asks them.
          */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Membership tier <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <select
              value={inviteTierId}
              onChange={(e) => setInviteTierId(e.target.value)}
              className="input w-full"
            >
              <option value="">Let the person decide</option>
              {(tiers ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.priceMonthly > 0 ? ` — $${(t.priceMonthly / 100).toFixed(2)}/mo` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Pick a tier and they&apos;ll be taken to payment after accepting. Leave it
              as “Let the person decide” and they choose from your tiers on the
              invitation itself — staff and guests are never asked, since they don&apos;t
              pay dues.
            </p>
          </div>
          {inviteResult && (
            <div className={`rounded-lg p-3 text-sm ${inviteResult.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {inviteResult.message}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setShowInvite(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={inviting || !inviteEmail.trim()} className="btn-primary">
              {inviting ? 'Sending...' : 'Send Invitation'}
            </button>
          </div>
        </form>
      </Modal>

      {openMenu && (
        <>
          {/* Clicking anywhere else closes it, which is what everybody
              expects of a menu and what nothing else here was doing. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} aria-hidden />
          <div
            role="menu"
            style={{ top: openMenu.top, left: openMenu.left, width: MENU_WIDTH }}
            className="fixed z-50 rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setConfirmRemove(openMenu.member);
                setRemoveError('');
                setOpenMenu(null);
              }}
              className="block w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
            >
              Remove from the community
            </button>
          </div>
        </>
      )}

      <Modal
        open={confirmRemove !== null}
        onClose={() => {
          if (!removing) setConfirmRemove(null);
        }}
        title="Remove from the community"
      >
        {confirmRemove && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              {confirmRemove.user.name ?? confirmRemove.user.email ?? 'This member'} will lose
              access to everything members see here — events, the directory, bookings and anything
              behind a membership.
            </p>
            {payingDues(confirmRemove) && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Their dues are cancelled immediately, not at the end of the period. They are not
                  refunded for the part of the month they have already paid for.
                </p>
            )}
            <p className="text-sm text-gray-500">
              This cannot be undone. They would have to be invited again, and would start a new
              membership if they came back.
            </p>
            {removeError && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {removeError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmRemove(null)}
                disabled={removing}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Keep them
              </button>
              <button
                type="button"
                onClick={() => removeMember(confirmRemove)}
                disabled={removing}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {removing ? 'Removing…' : 'Remove and cancel their dues'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {pendingInvites.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-900">
              Pending Invitations ({pendingInvites.length})
            </h2>
          </div>
          <div className="space-y-2">
            {pendingInvites.map((inv) => {
              const isExpired = new Date(inv.expiresAt) < new Date();
              return (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between rounded-lg bg-white px-4 py-3 border border-amber-100 gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
                      <Mail className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{inv.email}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadge[inv.role] ?? 'badge-info'}`}>
                          {inv.role}
                        </span>
                        {isExpired ? (
                          <span className="text-xs text-red-500 font-medium">Expired</span>
                        ) : (
                          <span className="text-xs text-gray-400">
                            Sent {new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleResend(inv.id)}
                    disabled={resendingId === inv.id}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${resendingId === inv.id ? 'animate-spin' : ''}`} />
                    {resendingId === inv.id ? 'Sending...' : 'Resend'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search members by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {/* `overflow-hidden` clipped the table on a narrow screen rather than
          letting it scroll, so the last columns were unreachable on a phone
          (UI-01). `overflow-x-auto` keeps the rounded corners and gives the
          table somewhere to go on a phone; `min-w-[44rem]` stops the columns
          crushing into each other instead of scrolling. On a desktop nothing
          should scroll sideways at all — an Actions column you have to scroll
          to is how the row menu became unreachable (UI-02) — so the padding
          is modest and the two text columns truncate. */}
      <div className="card overflow-x-auto !p-0">
        <table className="w-full min-w-[44rem] table-auto">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Member
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Role
              </th>
              <th
                className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                title="Whether they can share events to the co-op's Facebook and Instagram"
              >
                Socials
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Tier
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Joined
              </th>
              <th
                className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                title="When they last signed in to MaybeOS"
              >
                Last seen
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                {/* The word is wider than the button below it, and the button
                    announces itself to a screen reader already. */}
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.map((member) => (
              <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-3 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100">
                      <span className="text-xs font-medium text-brand-700">
                        {(member.user.name ?? member.user.email ?? '?').charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0 max-w-[11rem] overflow-hidden">
                      <div className="truncate text-sm font-medium text-gray-900">
                        <MemberName userId={member.user.id} name={member.user.name ?? member.user.email ?? 'Member'} />
                      </div>
                      {member.user.email && (
                        <div className="truncate text-xs text-gray-500" title={member.user.email}>
                          {member.user.email}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  {/* Changeable at last (ORG-02). The route has existed since
                      the foundation with nothing calling it, so the only way
                      to make somebody an organiser was to invite them as one
                      — and a co-op whose organiser stepped down could not
                      hand over. The API refuses to demote the last one. */}
                  <select
                    value={member.role}
                    onChange={(e) => changeRole(member.user.id, e.target.value)}
                    disabled={savingRole === member.user.id}
                    aria-label={`Role for ${member.user.name ?? member.user.email ?? 'member'}`}
                    className={`rounded-full border-0 px-2.5 py-0.5 text-xs font-medium focus:ring-2 focus:ring-brand-500 ${roleBadge[member.role] ?? 'badge-info'}`}
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="STAFF">STAFF</option>
                    <option value="MEMBER">MEMBER</option>
                    <option value="GUEST">GUEST</option>
                  </select>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-xs text-gray-500">
                  {/* SOC-01. Admins and staff can always share, and guests
                      never can, so only members get a choice. */}
                  {member.role === 'ADMIN' || member.role === 'STAFF' ? (
                    'Always'
                  ) : member.role === 'GUEST' ? (
                    'Never'
                  ) : (
                    <select
                      value={member.socialShareAllowed == null ? '' : member.socialShareAllowed ? 'on' : 'off'}
                      onChange={(e) => changeSocial(member.user.id, e.target.value)}
                      disabled={savingRole === member.user.id}
                      aria-label={`Sharing to socials for ${member.user.name ?? member.user.email ?? 'member'}`}
                      className="rounded-md border border-gray-200 px-1.5 py-0.5 text-xs text-gray-700"
                    >
                      <option value="">Default</option>
                      <option value="on">Can share</option>
                      <option value="off">Can’t share</option>
                    </select>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                  {member.tier?.name ?? '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  <div className="flex flex-col items-start">
                  {/* Settable by hand only where Stripe is not deciding it
                      (MEM-23). A co-op's $0 members never have a subscription,
                      and NONE is a sentence about Stripe standing in for a
                      sentence about whether somebody is a member. */}
                  {canSetStatus(member) ? (
                    <select
                      value={member.subscriptionStatus ?? 'NONE'}
                      onChange={(e) => changeStatus(member.user.id, e.target.value)}
                      disabled={savingStatus === member.user.id}
                      aria-label={`Status for ${member.user.name ?? member.user.email ?? 'member'}`}
                      className={`rounded-full border-0 px-2.5 py-0.5 text-xs font-medium focus:ring-2 focus:ring-brand-500 ${statusBadge[member.subscriptionStatus ?? ''] ?? 'badge-info'}`}
                    >
                      {MANUAL_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {STATUS_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      title={STRIPE_OWNS_IT}
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[member.subscriptionStatus ?? ''] ?? 'badge-info'}`}
                    >
                      {STATUS_LABEL[member.subscriptionStatus ?? 'NONE'] ?? member.subscriptionStatus}
                    </span>
                  )}
                  {/* Somebody who has cancelled still reads as ACTIVE until
                      their paid period runs out, which is correct and useless
                      to an organiser looking at this list (PLT-06). */}
                  {member.cancelAtPeriodEnd && (
                    <span
                      className="mt-1 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
                      title={
                        member.currentPeriodEnd
                          ? `Ends ${new Date(member.currentPeriodEnd).toLocaleDateString()}`
                          : 'Ends when the paid period does'
                      }
                    >
                      Leaving
                      {member.currentPeriodEnd
                        ? ` ${new Date(member.currentPeriodEnd).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}`
                        : ''}
                    </span>
                  )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                  {new Date(member.memberSince).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </td>
                {/* Grey like the rest, except "Never" — during a migration
                    that is the one value an organiser is scanning for. */}
                <td
                  className={`whitespace-nowrap px-3 py-4 text-sm ${
                    neverSignedIn(member.user.lastLoginAt) ? 'text-gray-400' : 'text-gray-600'
                  }`}
                  title={
                    member.user.lastLoginAt
                      ? new Date(member.user.lastLoginAt).toLocaleString()
                      : 'Has not signed in yet'
                  }
                >
                  {lastSeenLabel(member.user.lastLoginAt)}
                  {/*
                    Why they have never signed in (MEM-25).

                    Without this, a bounced address is indistinguishable from a
                    member who is ignoring their email — and the two call for
                    opposite responses. Settings → Sign-in links is where it
                    gets fixed; this is where it gets noticed.
                  */}
                  {member.signInBouncedAt && (
                    <span
                      className="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
                      title={member.signInBounceKind ?? 'Their sign-in email bounced'}
                    >
                      Email bounced
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-right">
                  <button
                    type="button"
                    aria-label={`Actions for ${member.user.name ?? member.user.email ?? 'this member'}`}
                    aria-expanded={openMenu?.member.id === member.id}
                    onClick={(e) => toggleMenu(e, member)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                  {query
                    ? 'No members match that search.'
                    : 'No members yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* The roster's own size, always stated (MEM-22). A list that stops at
          fifty and says nothing is how an organiser concludes the import
          dropped the other 376. */}
      {data && (
        <div className="flex flex-col items-center gap-3 py-2">
          <p className="text-sm text-gray-500">
            {loading ? 'Searching…' : rosterCount(filtered.length, data.meta, query !== '')}
          </p>

          {moreError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {moreError}
            </p>
          )}

          {hasMore(filtered.length, data.meta) && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingMore
                ? 'Loading…'
                : `Show ${Math.min(PER_PAGE, data.meta.total - filtered.length)} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
