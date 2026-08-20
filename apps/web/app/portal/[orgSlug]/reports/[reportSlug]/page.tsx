'use client';

import { use, useEffect, useState } from 'react';
import { api, PublicReport } from '@/lib/api';
import { ReportBody } from '@/components/impact/report-body';

/**
 * A co-op's published impact report, to anybody with the link (IMP-22).
 *
 * Public on purpose, and the only public page in ImpactOS — a report a co-op
 * cannot send to a funder is not a report. It is safe to be public because
 * nothing below the suppression threshold was ever written into it: the
 * privacy rule is kept by the generator, not by this page remembering to hide
 * things.
 */
export default function PublicReportPage(props: {
  params: Promise<{ orgSlug: string; reportSlug: string }>;
}) {
  const { orgSlug, reportSlug } = use(props.params);
  const [data, setData] = useState<PublicReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.impact
      .publicReport(orgSlug, reportSlug)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [orgSlug, reportSlug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-20 text-center">
        <h1 className="text-xl font-semibold text-gray-900">Report not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          It may not have been published, or the link may be wrong.
        </p>
      </div>
    );
  }

  const { org, report } = data;

  return (
    <article className="mx-auto max-w-2xl py-8">
      <header className="border-b border-gray-200 pb-6">
        <p className="text-sm font-medium text-gray-500">{org.name}</p>
        <h1 className="mt-1 text-3xl font-bold text-gray-900">{report.title}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {new Date(report.periodStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} –{' '}
          {new Date(report.periodEnd).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          {report.publishedAt &&
            ` · published ${new Date(report.publishedAt).toLocaleDateString()}`}
        </p>
      </header>

      <div className="mt-8">
        <ReportBody blocks={report.blocks} />
      </div>

      <footer className="mt-12 border-t border-gray-200 pt-4 text-xs text-gray-400">
        Figures collected through MaybeOS.
      </footer>
    </article>
  );
}
