'use client';

import { useState, useEffect } from 'react';
import { Users, Search, X, Calendar, Link2, MapPin } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, Member } from '@/lib/api';
import { safeProfileLinks, profileLinkLabel } from '@/lib/profile-links';
import { PageHeader } from '@/components/layout/page-header';

export default function PortalDirectoryPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Opening a card was the whole ask: the page answered "who is in this co-op"
  // and not "who is this person", which is the question somebody actually has
  // before a first conversation.
  const [openMember, setOpenMember] = useState<Member | null>(null);

  useEffect(() => {
    if (!org || !token) { setLoading(false); return; }
    api.members
      .list(org.id, token, 1, 100)
      .then((data) => setMembers(data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [org, token]);

  if (!token) {
    return (
      <div className="py-12 text-center">
        <Users className="mx-auto h-10 w-10 text-gray-300" />
        <PageHeader
          title="Member Directory"
          description="Sign in to view the member directory."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  // Name only. Members no longer receive each other's email addresses, and
  // searching one they cannot see would only tell them whether an address
  // belongs to somebody here.
  const filtered = search
    ? members.filter((m) =>
        m.user.name?.toLowerCase().includes(search.toLowerCase()),
      )
    : members;

  const roleBadge: Record<string, string> = {
    ADMIN: 'bg-purple-50 text-purple-700',
    STAFF: 'bg-blue-50 text-blue-700',
    MEMBER: 'bg-gray-100 text-gray-600',
    GUEST: 'bg-yellow-50 text-yellow-700',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Member Directory"
          description={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
        />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full pl-10"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          {search ? 'No members match your search.' : 'No members yet.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => setOpenMember(member)}
              className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-gray-300 hover:shadow-sm"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100">
                {member.user.avatarUrl ? (
                  <img
                    src={member.user.avatarUrl}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-medium text-brand-700">
                    {member.user.name?.charAt(0).toUpperCase() || '?'}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">
                  {member.user.name || 'Member'}
                </p>
                {member.headline && (
                  <p className="truncate text-xs text-gray-500">{member.headline}</p>
                )}
                <div className="mt-0.5 flex items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      roleBadge[member.role] || roleBadge.MEMBER
                    }`}
                  >
                    {member.role}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {openMember && <MemberProfile member={openMember} onClose={() => setOpenMember(null)} />}
    </div>
  );
}

/**
 * What one member may know about another.
 *
 * Deliberately not everything on the record. Charley's rule (2026-08-12):
 * belonging to the same co-op earns you a name and a face, not everybody's
 * email address — a member list is exactly the kind of thing that should not
 * be harvestable by whoever joins. The API already enforces it, stripping
 * `email` and billing for anyone who is not an organiser or the member
 * themselves, so this renders the address when it arrives and shows nothing
 * when it does not, rather than deciding for itself.
 *
 * Demographics are absent by construction rather than by omission here: D-021
 * promises members that only suppressed aggregates are shown, and the Prisma
 * client now redacts that column for every query that does not ask for it.
 */
function MemberProfile({ member, onClose }: { member: Member; onClose: () => void }) {
  const joined = new Date(member.memberSince);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-20"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-100">
              {member.user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={member.user.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <span className="text-xl font-medium text-brand-700">
                  {member.user.name?.charAt(0).toUpperCase() || '?'}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-gray-900">{member.user.name || 'Member'}</h2>
              {member.headline && (
                <p className="mt-0.5 text-sm text-gray-600">{member.headline}</p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Member since{' '}
                  {joined.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                {member.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {member.location}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {member.bio ? (
          <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-gray-700">{member.bio}</p>
        ) : (
          <p className="mt-5 text-sm italic text-gray-400">
            {member.user.name?.split(' ')[0] || 'This member'} hasn&apos;t written an introduction yet.
          </p>
        )}

        {member.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {member.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                {tag}
              </span>
            ))}
          </div>
        )}

        {safeProfileLinks(member.links).length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {safeProfileLinks(member.links).map((link) => (
              <li key={link}>
                <a
                  href={link}
                  target="_blank"
                  // noreferrer as well as noopener: these point off the co-op's
                  // site to somewhere a member chose, and the page they land on
                  // has no business knowing which co-op sent them.
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-2 text-sm text-brand-600 hover:underline"
                >
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate">{profileLinkLabel(link)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        {/* Present only when the API sent it — organisers, and yourself. */}
        {member.user.email && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <a href={`mailto:${member.user.email}`} className="text-sm text-brand-600 hover:underline">
              {member.user.email}
            </a>
            <p className="mt-1 text-xs text-gray-400">
              Visible to organisers so they can contact members — not to the whole co-op.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
