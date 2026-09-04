'use client';

import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowUpRight, Plus, Trash2 } from 'lucide-react';
import { api, MUTATION_EVENT, OrgLink } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * The co-op's links to things that are not in MaybeOS (NAV-02).
 *
 * Charley: an admin should be able to add external links so members can reach
 * things kept off the platform. A co-op's life does not all live in one
 * product — the store is on Shopify, the white paper is a PDF, the app is in
 * the App Store, and half the community actually talks on Instagram. Members
 * were expected to find those on their own or to have been told once.
 *
 * **Managed in the nav itself, not in Settings.** These are navigation, and
 * the thing being arranged is on screen while it is being arranged — an admin
 * adding "Instagram" sees exactly where it lands. It also means the co-op's
 * links are edited in the one place every member sees them, which is the
 * shortest possible distance between noticing a bad label and fixing it.
 *
 * **Every one opens in a new tab.** A member following a link to the store has
 * not finished with the co-op's site; sending them away from it and leaving
 * Back as the only route home is the small rudeness this pattern exists to
 * avoid. `rel="noopener noreferrer"` goes with `target="_blank"` — without
 * `noopener` the opened page can reach back through `window.opener`, and these
 * point at sites MaybeOS does not control.
 */
export function OrgLinks({ isAdmin }: { isAdmin: boolean }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [links, setLinks] = useState<OrgLink[]>([]);
  const [ready, setReady] = useState(false);
  const [managing, setManaging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) {
      setReady(true);
      return;
    }
    try {
      setLinks(await api.orgs.listLinks(orgId, token));
    } catch {
      // A link list is not worth an error in the navigation. If it cannot
      // load, the nav is simply the nav.
      setLinks([]);
    } finally {
      setReady(true);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  // Switching co-op reloads the profile, which is a mutation-shaped change
  // this list cares about. Same hook the getting-started checklist uses.
  useEffect(() => {
    if (!ready) return;
    const refresh = () => load();
    window.addEventListener(MUTATION_EVENT, refresh);
    return () => window.removeEventListener(MUTATION_EVENT, refresh);
  }, [ready, load]);

  async function run(work: () => Promise<unknown>) {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!draft.label.trim() || !draft.url.trim()) return;
    await run(async () => {
      await api.orgs.createLink(orgId!, { label: draft.label.trim(), url: draft.url.trim() }, token!);
      setDraft({ label: '', url: '' });
      setAdding(false);
    });
  }

  function move(linkId: string, direction: -1 | 1) {
    const ids = links.map((l) => l.id);
    const index = ids.indexOf(linkId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => api.orgs.reorderLinks(orgId!, ids, token!));
  }

  // Nothing at all for a member of a co-op that has not added any. An empty
  // "Links" header is a section that says only that somebody could have.
  if (!ready || (links.length === 0 && !isAdmin)) return null;

  return (
    <div className="mt-6 space-y-1">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider text-paper-deep/60">
          Links
        </span>
        {isAdmin && links.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setManaging((m) => !m);
              setError('');
            }}
            className="shrink-0 text-[11px] font-medium text-ink-faint transition-colors hover:text-paper-deep"
          >
            {managing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {error && (
        <p className="px-3 pb-1 text-[11px] text-brand-400" role="alert">
          {error}
        </p>
      )}

      {links.map((link, index) => (
        <div key={link.id} className="group">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-paper-deep transition-colors duration-fast hover:bg-white/10 hover:text-paper"
          >
            {/* The arrow is the tell that this leaves MaybeOS. Every other row
                in this column stays inside it, and a link that behaves
                differently should look different before it is clicked. */}
            <ArrowUpRight className="h-5 w-5 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">{link.label}</span>
          </a>

          {isAdmin && managing && (
            <div className="flex flex-wrap items-center gap-2 px-3 pb-1">
              <button type="button" onClick={() => move(link.id, -1)} disabled={busy || index === 0}
                className="text-[11px] text-ink-faint hover:text-paper-deep disabled:opacity-40">Up</button>
              <button type="button" onClick={() => move(link.id, 1)} disabled={busy || index === links.length - 1}
                className="text-[11px] text-ink-faint hover:text-paper-deep disabled:opacity-40">Down</button>
              <button
                type="button"
                onClick={() =>
                  run(async () => {
                    if (!window.confirm(`Remove "${link.label}" from the sidebar?`)) return;
                    await api.orgs.deleteLink(orgId!, link.id, token!);
                  })
                }
                disabled={busy}
                className="text-ink-faint transition-colors hover:text-brand-400 disabled:opacity-40"
                aria-label={`Remove ${link.label}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}

      {isAdmin &&
        (adding ? (
          <form
            className="space-y-1.5 px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input
              autoFocus
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Name"
              aria-label="Link name"
              className="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-paper placeholder:text-ink-faint focus:border-white/40 focus:outline-none"
            />
            <input
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
              placeholder="instagram.com/your-coop"
              aria-label="Web address"
              className="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-paper placeholder:text-ink-faint focus:border-white/40 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy || !draft.label.trim() || !draft.url.trim()}
                className={clsx(
                  'rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors',
                  'hover:bg-brand-700 disabled:opacity-50',
                )}
              >
                {busy ? 'Adding...' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setError('');
                }}
                className="text-xs text-ink-faint transition-colors hover:text-paper-deep"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-ink-faint transition-colors duration-fast hover:bg-white/5 hover:text-paper-deep"
          >
            <Plus className="h-5 w-5 shrink-0" strokeWidth={1.75} />
            Add link
          </button>
        ))}
    </div>
  );
}
