'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, AlertTriangle, Check, Users, Image as ImageIcon } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, ImportResult } from '@/lib/api';
import { parseCsv } from '@/lib/csv';
import { PageHeader } from '@/components/layout/page-header';
import {
  IMPORT_FIELDS,
  guessMapping,
  prepareImport,
  chunk,
  Mapping,
  FieldKey,
} from '@/lib/member-import';

/**
 * Bring an existing community in from a .csv (MEM-06).
 *
 * Three steps, in the order MEM-06 asks for: choose a file, say what its
 * columns mean, then **look at the parsed result before anything is sent**.
 * The last one is the point. An import that runs on click is one typo away
 * from 300 members with somebody else's join date, and undoing it means
 * deleting people.
 *
 * Everything up to the confirm happens in the browser. Nothing is uploaded to
 * be inspected — the file is read locally, and only mapped rows in MaybeOS's
 * own field names ever leave.
 */
export default function ImportMembersPage(props: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = use(props.params);
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [parseError, setParseError] = useState('');

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [avatars, setAvatars] = useState<{ done: number; failed: number; running: boolean } | null>(null);
  const [failure, setFailure] = useState('');

  const prepared = useMemo(
    () => (mapping ? prepareImport(headers, rawRows, mapping) : null),
    [headers, rawRows, mapping],
  );

  async function readFile(file: File) {
    setParseError('');
    setResult(null);
    setAvatars(null);
    try {
      const { headers: found, rows } = parseCsv(await file.text());
      if (found.length === 0 || rows.length === 0) {
        setParseError('That file has no rows in it.');
        return;
      }
      setFileName(file.name);
      setHeaders(found);
      setRawRows(rows);
      setMapping(guessMapping(found));
    } catch {
      setParseError('That file could not be read as a .csv.');
    }
  }

  function setField(key: FieldKey, headerName: string, index = 0) {
    setMapping((current) => {
      if (!current) return current;
      const next = { ...current };
      const field = IMPORT_FIELDS.find((f) => f.key === key);

      if (field?.multiple) {
        const values = [...current[key]];
        if (headerName) values[index] = headerName;
        else values.splice(index, 1);
        next[key] = values.filter(Boolean);
      } else {
        next[key] = headerName ? [headerName] : [];
      }
      return next;
    });
  }

  async function runImport() {
    if (!prepared || !orgId || !token) return;

    setRunning(true);
    setFailure('');
    const totals: ImportResult = {
      created: 0, alreadyMembers: 0, linkedExistingUsers: 0, avatarsPending: 0, errors: [],
    };
    const batches = chunk(prepared.rows, 50);
    setProgress({ done: 0, total: prepared.rows.length });

    try {
      for (const [index, batch] of batches.entries()) {
        const outcome = await api.members.import(orgId, batch, token);
        totals.created += outcome.created;
        totals.alreadyMembers += outcome.alreadyMembers;
        totals.linkedExistingUsers += outcome.linkedExistingUsers;
        totals.avatarsPending += outcome.avatarsPending;
        totals.errors.push(...outcome.errors);
        setProgress({ done: Math.min((index + 1) * 50, prepared.rows.length), total: prepared.rows.length });
        setResult({ ...totals });
      }
    } catch (err) {
      // Partial rather than lost: every batch before this one is already in,
      // and re-running skips them as existing members.
      setFailure(
        `${err instanceof Error ? err.message : 'The import stopped'} — ${totals.created} members were imported before it stopped. Running the import again will pick up where it left off.`,
      );
    } finally {
      setRunning(false);
    }
  }

  /**
   * Copy the avatars across, a batch at a time.
   *
   * Separate from the import because each one is a download and an upload,
   * and two hundred of those do not fit in a single request. Walked with a
   * cursor so a member whose avatar cannot be fetched is passed over once.
   */
  async function copyAvatars() {
    if (!orgId || !token) return;

    setAvatars({ done: 0, failed: 0, running: true });
    let after: string | undefined;
    let done = 0;
    let failed = 0;

    try {
      for (;;) {
        const batch = await api.members.importAvatars(orgId, { after, limit: 8 }, token);
        done += batch.imported;
        failed += batch.failed;
        setAvatars({ done, failed, running: true });
        if (batch.done || !batch.lastId) break;
        after = batch.lastId;
      }
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Copying avatars stopped early');
    } finally {
      setAvatars((a) => (a ? { ...a, running: false } : a));
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/${orgSlug}/members`}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Members
      </Link>

      <div>
        <PageHeader
          title="Import members"
        />
        <p className="mt-1 text-sm text-gray-500">
          From a .csv exported by whatever your community uses now. Nothing is sent until you
          have seen what it will do, and <b>no one is emailed</b>.
        </p>
      </div>

      {/* ─── 1. The file ─────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">1. Choose a file</h2>
        <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-gray-300 px-4 py-6 hover:border-brand-400 hover:bg-brand-50/40">
          <Upload className="h-5 w-5 text-gray-400" />
          <span className="text-sm text-gray-600">
            {fileName || 'Choose a .csv file'}
            {rawRows.length > 0 && (
              <span className="ml-2 text-gray-400">
                · {rawRows.length} rows, {headers.length} columns
              </span>
            )}
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
      </section>

      {/* ─── 2. What the columns mean ────────────────────────── */}
      {mapping && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">2. Match the columns</h2>
          <p className="mt-1 text-xs text-gray-500">
            Filled in from the column names. Change anything that looks wrong — a column left
            unmatched is simply not imported.
          </p>

          <div className="mt-4 space-y-3">
            {IMPORT_FIELDS.map((field) => (
              <div key={field.key} className="grid gap-2 sm:grid-cols-[11rem_1fr] sm:items-start">
                <div className="pt-1.5">
                  <span className="text-sm font-medium text-gray-900">{field.label}</span>
                  {field.required && <span className="ml-1 text-red-500">*</span>}
                  {field.hint && <p className="text-xs text-gray-400">{field.hint}</p>}
                </div>

                {field.multiple ? (
                  <div className="space-y-1.5">
                    {[...mapping[field.key], ''].map((selected, i) => (
                      <select
                        key={`${field.key}-${i}`}
                        value={selected}
                        onChange={(e) => setField(field.key, e.target.value, i)}
                        className="input w-full text-sm"
                      >
                        <option value="">{i === 0 ? '— not imported —' : '— add another —'}</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    ))}
                  </div>
                ) : (
                  <select
                    value={mapping[field.key][0] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                    className="input w-full text-sm"
                  >
                    <option value="">— not imported —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── 3. What will happen ─────────────────────────────── */}
      {prepared && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">3. Check the result</h2>

          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 text-gray-900">
              <Users className="h-4 w-4 text-gray-400" />
              <b>{prepared.rows.length}</b> to import
            </span>
            {prepared.skipped.length > 0 && (
              <span className="text-red-600">{prepared.skipped.length} cannot be imported</span>
            )}
            {prepared.warnings.length > 0 && (
              <span className="text-amber-600">{prepared.warnings.length} with something to note</span>
            )}
            <span className="text-gray-500">
              {prepared.rows.filter((r) => r.avatarUrl).length} avatars to copy
            </span>
          </div>

          {(prepared.skipped.length > 0 || prepared.warnings.length > 0) && (
            <div className="mt-3 max-h-44 overflow-y-auto rounded-lg bg-gray-50 p-3 text-xs">
              {[...prepared.skipped, ...prepared.warnings].slice(0, 100).map((issue, i) => (
                <p key={i} className="flex gap-2 py-0.5 text-gray-600">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                  <span>
                    Line {issue.line}
                    {issue.email && <> · {issue.email}</>} — {issue.reason}
                  </span>
                </p>
              ))}
            </div>
          )}

          {/* The first few rows exactly as they will land, since a mapping
              that reads correctly can still be wrong about the data. */}
          {prepared.rows.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-gray-200 text-gray-500">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Name</th>
                    <th className="py-1.5 pr-3 font-medium">Email</th>
                    <th className="py-1.5 pr-3 font-medium">Joined</th>
                    <th className="py-1.5 pr-3 font-medium">Headline</th>
                    <th className="py-1.5 pr-3 font-medium">Location</th>
                    <th className="py-1.5 pr-3 font-medium">Links</th>
                    <th className="py-1.5 font-medium">Email marketing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {prepared.rows.slice(0, 8).map((row) => (
                    <tr key={row.email} className="text-gray-700">
                      <td className="py-1.5 pr-3">{row.name || <span className="text-gray-300">—</span>}</td>
                      <td className="py-1.5 pr-3">{row.email}</td>
                      <td className="py-1.5 pr-3">
                        {row.joinedAt ? new Date(row.joinedAt).toLocaleDateString() : <span className="text-amber-600">today</span>}
                      </td>
                      <td className="max-w-[12rem] truncate py-1.5 pr-3">{row.headline || <span className="text-gray-300">—</span>}</td>
                      <td className="py-1.5 pr-3">{row.location || <span className="text-gray-300">—</span>}</td>
                      <td className="py-1.5 pr-3">{row.links?.length ?? 0}</td>
                      <td className="py-1.5">
                        {row.emailOptIn === true ? 'opted in' : row.emailOptIn === false ? 'opted out' : <span className="text-gray-300">not asked</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {prepared.rows.length > 8 && (
                <p className="mt-2 text-xs text-gray-400">…and {prepared.rows.length - 8} more.</p>
              )}
            </div>
          )}

          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="mb-3 text-xs text-gray-500">
              Anyone already a member of this co-op is left exactly as they are — their role,
              their profile and their join date are not touched. Imported members have no
              password and are not emailed; invite them when you are ready.
            </p>
            <button
              onClick={runImport}
              disabled={running || prepared.rows.length === 0 || !orgId}
              className="btn-primary text-sm"
            >
              {running
                ? `Importing ${progress.done} of ${progress.total}...`
                : `Import ${prepared.rows.length} members`}
            </button>
          </div>
        </section>
      )}

      {failure && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{failure}</p>
      )}

      {/* ─── What actually happened ──────────────────────────── */}
      {result && !running && (
        <section className="rounded-xl border border-green-200 bg-green-50 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-green-900">
            <Check className="h-4 w-4" />
            Imported
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-green-900">
            <li><b>{result.created}</b> members added</li>
            {result.linkedExistingUsers > 0 && (
              <li>{result.linkedExistingUsers} already had a MaybeOS account and were joined to this co-op</li>
            )}
            {result.alreadyMembers > 0 && (
              <li>{result.alreadyMembers} were already members here and were left untouched</li>
            )}
          </ul>

          {result.errors.length > 0 && (
            <div className="mt-3 max-h-32 overflow-y-auto rounded bg-white/70 p-2 text-xs text-red-700">
              {result.errors.map((e, i) => <p key={i}>{e.email} — {e.reason}</p>)}
            </div>
          )}

          {result.avatarsPending > 0 && (
            <div className="mt-4 border-t border-green-200 pt-4">
              <p className="text-sm text-green-900">
                <b>{result.avatarsPending}</b> avatars are still hosted by your old platform.
                Those links stop working when that account does, so copy them into MaybeOS now.
              </p>
              <button
                onClick={copyAvatars}
                disabled={avatars?.running}
                className="btn-secondary mt-2 inline-flex items-center gap-2 text-sm"
              >
                <ImageIcon className="h-4 w-4" />
                {avatars?.running ? `Copying... ${avatars.done} done` : 'Copy avatars into MaybeOS'}
              </button>
              {avatars && !avatars.running && (
                <p className="mt-2 text-xs text-green-800">
                  {avatars.done} copied{avatars.failed > 0 && `, ${avatars.failed} could not be fetched`}.
                </p>
              )}
            </div>
          )}

          <Link href={`/admin/${orgSlug}/members`} className="btn-primary mt-4 inline-block text-sm">
            See the member list
          </Link>
        </section>
      )}
    </div>
  );
}
