'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, MyImpact } from '@/lib/api';
import { SignalsView, CATEGORY_LABEL } from '@/components/impact/signals';
import { PageHeader } from '@/components/layout/page-header';
import { Panel } from '@/components/layout/panel';

/**
 * What you told your co-op, and what it learned from everyone (IMP-20).
 *
 * The half of ImpactOS that did not exist. A member answers a question a
 * month for a year and is told nothing back — and D-021 calls response rate
 * the binding constraint on the whole product, so this is load-bearing rather
 * than a courtesy. A co-op asking questions into silence gets fewer answers
 * every month until there is no report to write.
 *
 * Their own answers are theirs, in full and dated. The co-op's figures are
 * exactly the ones an organiser sees, suppression included: a member is not
 * entitled to read a small cell either, and two views of the same truth that
 * disagree is how one of them turns out to be wrong.
 */
export default function MyImpactPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const orgId = currentOrgId ?? user?.orgs?.[0]?.orgId;

  const [mine, setMine] = useState<MyImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !orgId) {
      setLoading(false);
      return;
    }
    api.impact
      .myImpact(orgId, token)
      .then(setMine)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this'))
      .finally(() => setLoading(false));
  }, [token, orgId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          title="What we&apos;re learning"
          description="Your co-op asks one short question at a time, at most once a month. Here is what you said, and what everyone&apos;s answers add up to."
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <Panel title="Together">
        {mine && <SignalsView signals={mine.community} />}
      </Panel>

      <Panel title="Your answers">
        {mine && mine.answers.length > 0 ? (
          <ul className="space-y-3">
            {mine.answers.map((a, i) => (
              <li key={`${a.question}-${i}`} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-sm text-gray-900">{a.question}</p>
                <p className="mt-1 text-sm font-medium text-brand-700">
                  {a.value}
                  {/* The label they were shown, so an old answer still reads
                      as an answer rather than as a bare number. */}
                  {a.anchorHigh && typeof a.value === 'number' && (
                    <span className="font-normal text-gray-400">
                      {' '}
                      ({a.anchorLow} → {a.anchorHigh})
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {a.category && `${CATEGORY_LABEL[a.category] ?? a.category} · `}
                  {a.window} · {new Date(a.answeredAt).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
            You haven&apos;t been asked anything yet. When you are, it will be one question,
            somewhere you already were.
          </p>
        )}
      </Panel>

      <p className="text-xs text-gray-400">
        {/* Stated to the person it is a promise to, not only in a privacy
            policy: §10 is the reason the totals above are the only thing
            anybody else can see. */}
        Organisers only ever see totals — never your individual answers, and never figures drawn
        from too few people to keep those answers private.
      </p>
    </div>
  );
}
