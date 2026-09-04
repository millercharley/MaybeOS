'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Search, Plus, MoreHorizontal, Clock, RefreshCw, Mail, Upload } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/layout/page-header';

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
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');
  const [inviteTierId, setInviteTierId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [roleError, setRoleError] = useState('');
  const token = useAuthStore((s) => s.token);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);

  const { data, loading, error, refetch } = useApi(
    (token, orgId) => api.members.list(orgId, token, 1, 50),
    [],
  );

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        Failed to load members: {error}
      </div>
    );
  }

  const members = data?.data ?? [];
  const pendingInvites = (invitations ?? []).filter(
    (inv) => !inv.acceptedAt,
  );

  const filtered = members.filter(
    (m) =>
      (m.user.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (m.user.email ?? '').toLowerCase().includes(search.toLowerCase()),
  );

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

  return (
    <div className="space-y-6">
      {roleError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{roleError}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Members"
        />
        <div className="flex items-center gap-2">
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
          table somewhere to go; `min-w-[40rem]` stops the columns crushing
          into each other instead of scrolling. */}
      <div className="card overflow-x-auto !p-0">
        <table className="w-full min-w-[40rem]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Tier
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Joined
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.map((member) => (
              <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                <td className="whitespace-nowrap px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100">
                      <span className="text-xs font-medium text-brand-700">
                        {(member.user.name ?? member.user.email ?? '?').charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-gray-900">
                      {member.user.name ?? member.user.email ?? 'Member'}
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                  {member.user.email}
                </td>
                <td className="whitespace-nowrap px-6 py-4">
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
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                  {member.tier?.name ?? '-'}
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[member.subscriptionStatus ?? ''] ?? 'badge-info'}`}>
                    {member.subscriptionStatus ?? 'NONE'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                  {new Date(member.memberSince).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right">
                  <button className="text-gray-400 hover:text-gray-600">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-500">
                  No members found matching your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
