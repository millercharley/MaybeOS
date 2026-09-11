'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, AlertTriangle, Check, Eye, Download } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, LedgerImportResult } from '@/lib/api';
import { parseCapTable, CapTableFormatError, formatShares, ParsedCapTable } from '@/lib/ledger';
import { PageHeader } from '@/components/layout/page-header';

/**
 * Import the co-op's cap table into Members' shares and ownership (MEM-17).
 *
 * Read in the browser, previewed on the server with writes switched off, then
 * imported — and the import replaces the ledger whole, so running it again
 * after the sheet changes is exact rather than cumulative.
 *
 * The number on this page that matters is the reconciliation: what the rows
 * add up to against the sheet's own totals row. Every member is about to be
 * told what they own, so an import that disagrees with the treasurer's sheet
 * is refused unless an organiser says, in so many words, that they know why.
 */
export default function ImportLedgerPage(props: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = use(props.params);
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedCapTable | null>(null);
  const [parseError, setParseError] = useState('');
  const [preview, setPreview] = useState<LedgerImportResult | null>(null);
  const [done, setDone] = useState<LedgerImportResult | null>(null);
  const [acceptMismatch, setAcceptMismatch] = useState(false);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState('');

  async function readFile(file: File) {
    setParseError('');
    setPreview(null);
    setDone(null);
    setAcceptMismatch(false);
    try {
      const result = parseCapTable(await file.text());
      if (result.rows.length === 0) {
        setParseError('That file has a header but no rows under it.');
        return;
      }
      setFileName(file.name);
      setParsed(result);
    } catch (err) {
      setParseError(err instanceof CapTableFormatError ? err.message : 'That file could not be read as a .csv.');
    }
  }

  async function send(dryRun: boolean) {
    if (!orgId || !token || !parsed) return;
    setRunning(true);
    setFailure('');
    try {
      const result = await api.ledger.importCapTable(
        orgId,
        {
          rows: parsed.rows,
          ...(parsed.sheetTotal !== null ? { sheetTotal: parsed.sheetTotal } : {}),
          dryRun,
          ...(dryRun ? {} : { acceptMismatch }),
        },
        token,
      );
      if (dryRun) setPreview(result);
      else setDone(result);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'The import did not run.');
    } finally {
      setRunning(false);
    }
  }

  const mismatch = preview?.matchesSheet === false;

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/${orgSlug}/members/import`}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Import members
      </Link>

      <div>
        <PageHeader title="Import the cap table" />
        <p className="mt-1 text-sm text-gray-500">
          Shares and ownership for the Members page, from the spreadsheet the co-op keeps them in.
          Every member will see what every member holds — names and shares only, never an email or a
          phone number.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">1. Choose the cap table</h2>
        <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-gray-300 px-4 py-6 hover:border-brand-400 hover:bg-brand-50/40">
          <Upload className="h-5 w-5 text-gray-400" />
          <span className="text-sm text-gray-600">
            {fileName || 'Choose a .csv exported from the cap table'}
            {parsed && <span className="ml-2 text-gray-400">· {parsed.rows.length} rows</span>}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
            }}
          />
        </label>
        {parseError && <p className="mt-2 text-sm text-red-600">{parseError}</p>}
        <button
          onClick={() => send(true)}
          disabled={!parsed || running}
          className="btn-secondary mt-4 inline-flex items-center gap-2"
        >
          <Eye className="h-4 w-4" />
          Preview the import
        </button>
      </section>

      {failure && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {failure}
        </p>
      )}

      {preview && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">2. Does it add up?</h2>

          {preview.matchesSheet === true && (
            <p className="mt-3 flex items-start gap-2 text-sm text-gray-700">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              Yes. The rows add up to {formatShares(preview.importedShares)} shares — exactly the
              sheet&apos;s own total.
            </p>
          )}
          {mismatch && (
            <p className="mt-3 flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              No. The rows add up to {formatShares(preview.importedShares)}, but the sheet&apos;s own
              total says {formatShares(preview.sheetTotal ?? 0)}. Every member is about to be told what
              they own, so this is worth resolving in the sheet first.
            </p>
          )}
          {preview.matchesSheet === null && (
            <p className="mt-3 text-sm text-gray-600">
              The sheet had no totals row, so there is nothing to check the {formatShares(preview.importedShares)} shares against.
            </p>
          )}

          {preview.manualShares !== 0 && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {formatShares(preview.manualShares)} shares have been granted in MaybeOS. This import keeps
              them — so if the sheet already includes those grants, they will be counted twice.
            </p>
          )}

          <ul className="mt-4 space-y-1.5 text-sm text-gray-600">
            <li>
              <b className="text-gray-900">{preview.holders}</b> people hold shares, across {preview.rows} rows
            </li>
            <li>
              <b className="text-gray-900">{preview.linkedToMembers}</b> are members in MaybeOS and will be named on the ledger
            </li>
            {preview.notYetMembers > 0 && (
              <li>
                <b className="text-gray-900">{preview.notYetMembers}</b> are not in MaybeOS yet — their shares are
                counted in one unnamed row until they join, and appear by name the day they do
              </li>
            )}
            {preview.repeatedEmails > 0 && (
              <li>
                <b className="text-gray-900">{preview.repeatedEmails}</b> people appear on more than one row;
                their rows are added together, as the sheet&apos;s own total does
              </li>
            )}
            {preview.skipped.map((row) => (
              <li key={`${row.name}-${row.shares}`}>
                <b className="text-gray-900">{row.name ?? 'A row with no name'}</b> ({formatShares(row.shares)} shares)
                is not imported — it has no email, so there is no member it could belong to
              </li>
            ))}
            {preview.adjusted.map((row) => (
              <li key={`${row.name}-${row.total}`}>
                <b className="text-gray-900">{row.name ?? 'A row'}</b>: its grant columns add up to{' '}
                {formatShares(row.parts)} but its Total Shares says {formatShares(row.total)} — the total is
                used, with an adjustment recorded
              </li>
            ))}
          </ul>

          {mismatch && (
            <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={acceptMismatch}
                onChange={(e) => setAcceptMismatch(e.target.checked)}
              />
              I know why these differ, and want to import it anyway.
            </label>
          )}

          <button
            onClick={() => send(false)}
            disabled={running || (mismatch && !acceptMismatch)}
            className="btn-primary mt-4 inline-flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            {running ? 'Importing…' : 'Import the cap table'}
          </button>
          <p className="mt-2 text-xs text-gray-500">
            This replaces the previous cap-table import. Shares granted in MaybeOS are kept. Nothing is
            written until you press it.
          </p>
        </section>
      )}

      {done && (
        <section className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-900">
          <p className="flex items-center gap-2 font-medium">
            <Check className="h-4 w-4" />
            Imported {formatShares(done.importedShares)} shares for {done.holders} people.
          </p>
          <Link href={`/portal/${orgSlug}/directory`} className="mt-2 inline-block text-brand-700 hover:underline">
            Open Members
          </Link>
        </section>
      )}
    </div>
  );
}
