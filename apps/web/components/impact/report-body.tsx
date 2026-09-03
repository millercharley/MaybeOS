import { ReportBlock } from '@/lib/api';

/**
 * A report as a reader sees it (IMP-22).
 *
 * Shared between the admin's preview and the public page, so what an
 * organiser approves is exactly what a funder opens. A preview that renders
 * differently from the published page is a preview of nothing.
 */
export function ReportBody({ blocks }: { blocks: ReportBlock[] }) {
  return (
    <div className="space-y-8">
      {blocks.map((block) => (
        <section key={block.id}>
          {block.heading && (
            <h2 className="text-lg font-semibold text-gray-900">{block.heading}</h2>
          )}
          {block.body && (
            <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-gray-700">
              {block.body.split('\n\n').map((para, i) => (
                <p key={i} className="whitespace-pre-line">{para}</p>
              ))}
            </div>
          )}
          <BlockFigures block={block} />
        </section>
      ))}
    </div>
  );
}

/**
 * The counts under a figure.
 *
 * Rendered from the block's frozen payload rather than recomputed, which is
 * the whole of G5: a reader can always ask "out of how many, and when" and
 * this answers from what was true when the report was written.
 */
function BlockFigures({ block }: { block: ReportBlock }) {
  const data = block.data as
    | {
        figures?: Array<{ label: string; average: number; respondents: number; higherIsBetter: boolean }>;
        windows?: Array<{ label: string; responses: number; responseRate: number }>;
      }
    | null
    | undefined;

  if (data?.figures?.length) {
    return (
      <div className="mt-4 space-y-3">
        {data.figures.map((f) => (
          <div key={f.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
              <span className="text-gray-600">{f.label}</span>
              <span className="tabular-nums text-gray-900">
                {f.average.toFixed(1)}
                <span className="text-gray-400"> / 5</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${f.higherIsBetter ? 'bg-brand-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.max(0, Math.min(100, ((f.average - 1) / 4) * 100))}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">
              from {f.respondents} {f.respondents === 1 ? 'person' : 'people'}
              {!f.higherIsBetter && ' · lower is better here'}
            </p>
          </div>
        ))}
      </div>
    );
  }

  if (data?.windows?.length) {
    return (
      <ul className="mt-3 space-y-1 text-sm text-gray-500">
        {data.windows.map((w) => (
          <li key={w.label}>
            <span className="font-medium text-gray-700">{w.label}</span> — {w.responses} members
            answered ({w.responseRate}%)
          </li>
        ))}
      </ul>
    );
  }

  return null;
}
