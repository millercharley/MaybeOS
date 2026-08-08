'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Hash, User, Calendar, BookOpen, X } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, SearchResults } from '@/lib/api';

type FlatResult =
  | { kind: 'member'; id: string; label: string }
  | { kind: 'channel'; id: string; label: string }
  | { kind: 'event'; id: string; label: string }
  | { kind: 'page'; id: string; label: string; collectionName: string };

export function CommandPalette() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults(null);
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!token || !currentOrgId || query.trim().length < 2) {
      setResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const r = await api.commons.search(currentOrgId, query.trim(), token);
        setResults(r);
        setActiveIndex(0);
      } catch {
        setResults(null);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, token, currentOrgId]);

  const flatResults: FlatResult[] = useMemo(() => {
    if (!results) return [];
    return [
      ...results.members.map((m) => ({ kind: 'member' as const, id: m.id, label: m.name ?? 'Unknown' })),
      ...results.channels.map((c) => ({ kind: 'channel' as const, id: c.id, label: c.name })),
      ...results.events.map((e) => ({ kind: 'event' as const, id: e.id, label: e.title })),
      ...results.pages.map((p) => ({
        kind: 'page' as const,
        id: p.id,
        label: p.title,
        collectionName: p.collection.name,
      })),
    ];
  }, [results]);

  const handleSelect = useCallback(
    (result: FlatResult) => {
      setOpen(false);
      switch (result.kind) {
        case 'channel':
          router.push(`/admin/commons?channel=${result.id}`);
          break;
        case 'page':
          router.push(`/admin/commons?page=${result.id}`);
          break;
        case 'event':
          router.push('/admin/events');
          break;
        case 'member':
          router.push('/admin/members');
          break;
      }
    },
    [router],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && flatResults[activeIndex]) {
                handleSelect(flatResults[activeIndex]);
              }
            }}
            placeholder="Search members, channels, events, pages..."
            className="flex-1 border-none text-sm outline-none placeholder:text-gray-400"
          />
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto py-2">
          {query.trim().length < 2 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">Type at least 2 characters to search.</p>
          ) : flatResults.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">No results found.</p>
          ) : (
            flatResults.map((result, index) => {
              const Icon = result.kind === 'member' ? User : result.kind === 'channel' ? Hash : result.kind === 'event' ? Calendar : BookOpen;
              return (
                <button
                  key={`${result.kind}-${result.id}`}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                    index === activeIndex ? 'bg-brand-50 text-brand-700' : 'text-gray-700'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="truncate">{result.label}</span>
                  {result.kind === 'page' && (
                    <span className="ml-auto shrink-0 text-xs text-gray-400">{result.collectionName}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
