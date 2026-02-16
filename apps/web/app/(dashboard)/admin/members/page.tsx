'use client';

import { useState } from 'react';
import { Search, Plus, MoreHorizontal } from 'lucide-react';

type Role = 'ADMIN' | 'MEMBER' | 'STAFF';
type Status = 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  tier: string;
  status: Status;
  joined: string;
}

const members: Member[] = [
  {
    id: '1',
    name: 'Sarah Chen',
    email: 'sarah@example.com',
    role: 'ADMIN',
    tier: 'Founding',
    status: 'ACTIVE',
    joined: 'Jan 15, 2024',
  },
  {
    id: '2',
    name: 'Marcus Johnson',
    email: 'marcus@example.com',
    role: 'MEMBER',
    tier: 'Standard',
    status: 'ACTIVE',
    joined: 'Mar 2, 2024',
  },
  {
    id: '3',
    name: 'Priya Patel',
    email: 'priya@example.com',
    role: 'STAFF',
    tier: 'Staff',
    status: 'ACTIVE',
    joined: 'Feb 10, 2024',
  },
  {
    id: '4',
    name: 'David Kim',
    email: 'david@example.com',
    role: 'MEMBER',
    tier: 'Standard',
    status: 'PAST_DUE',
    joined: 'Apr 22, 2024',
  },
  {
    id: '5',
    name: 'Elena Rodriguez',
    email: 'elena@example.com',
    role: 'MEMBER',
    tier: 'Premium',
    status: 'CANCELED',
    joined: 'Dec 5, 2023',
  },
];

const roleBadge: Record<Role, string> = {
  ADMIN: 'badge-success',
  MEMBER: 'badge-info',
  STAFF: 'badge-warning',
};

const statusBadge: Record<Status, string> = {
  ACTIVE: 'badge-success',
  PAST_DUE: 'badge-warning',
  CANCELED: 'badge-danger',
};

export default function MembersPage() {
  const [search, setSearch] = useState('');

  const filtered = members.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Members</h1>
        <button className="btn-primary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Invite Member
        </button>
      </div>

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

      <div className="card overflow-hidden !p-0">
        <table className="w-full">
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
                        {member.name.charAt(0)}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-gray-900">{member.name}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                  {member.email}
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadge[member.role]}`}>
                    {member.role}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                  {member.tier}
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[member.status]}`}>
                    {member.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                  {member.joined}
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
