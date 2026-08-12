'use client';

import { useState, useEffect } from 'react';
import { Users, Search } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, Member } from '@/lib/api';

export default function PortalDirectoryPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Member Directory</h1>
        <p className="mt-2 text-sm text-gray-500">Sign in to view the member directory.</p>
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Member Directory</h1>
        <span className="text-sm text-gray-500">{members.length} members</span>
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
            <div
              key={member.id}
              className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4"
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
