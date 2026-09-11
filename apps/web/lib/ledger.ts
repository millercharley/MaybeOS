import { parseCsv } from './csv';

/**
 * The member ledger, on the web side (MEM-17): the words for each kind of
 * grant, how ownership is written, and reading the co-op's cap table.
 */

export const GRANT_KINDS = ['ANNUAL', 'FOUNDER', 'BELIEVER', 'BOUNTY', 'REFERRAL', 'ADJUSTMENT'] as const;
export type GrantKind = (typeof GRANT_KINDS)[number];

export const GRANT_LABELS: Record<GrantKind, string> = {
  ANNUAL: 'Annual grants',
  FOUNDER: 'Founder bonus',
  BELIEVER: 'Believer bonus',
  BOUNTY: 'Bounty grants',
  REFERRAL: 'Referral bonus',
  ADJUSTMENT: 'Adjustment',
};

export function formatShares(shares: number): string {
  return shares.toLocaleString('en-US');
}

/**
 * A holding as a share of the co-op.
 *
 * Two decimal places from 1% up, as a cap table reads. Below that, two
 * significant figures — because at MaybeItsFate a typical member holds a few
 * hundred of eleven million shares, and rounding them all to "0.00%" would
 * tell four hundred people they own nothing.
 */
export function formatOwnership(shares: number, total: number): string {
  if (!total || shares <= 0) return '0%';
  const pct = (shares / total) * 100;
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct < 0.0001) return '<0.0001%';
  return `${Number(pct.toPrecision(2))}%`;
}

export interface CapTableRow {
  name: string;
  email: string;
  annual: number;
  founder: number;
  believer: number;
  bounty: number;
  referral: number;
  totalShares: number;
}

export interface ParsedCapTable {
  rows: CapTableRow[];
  /** The sheet's own totals row, to check the import against. */
  sheetTotal: number | null;
}

export class CapTableFormatError extends Error {}

const number = (value: string | undefined) => {
  const n = Number((value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * Read the co-op's cap table as exported from its spreadsheet.
 *
 * The header is not on the first line — MaybeItsFate's sheet opens with a
 * summary row ("Active Members: 430") — so it is found rather than assumed:
 * the first row carrying Name, Email and Total Shares. The row straight after
 * with no name and no email is the sheet's totals row, and becomes the figure
 * the import has to reconcile to.
 */
export function parseCapTable(text: string): ParsedCapTable {
  const { headers, rows } = parseCsv(text);
  const all = [headers, ...rows].map((row) => row.map((cell) => cell.trim()));

  const at = all.findIndex(
    (row) => row.includes('Name') && row.includes('Email') && row.includes('Total Shares'),
  );
  if (at < 0) {
    throw new CapTableFormatError(
      'That does not look like the cap table — no row has Name, Email and Total Shares columns.',
    );
  }

  const header = all[at];
  const cell = (row: string[], column: string) => {
    const i = header.indexOf(column);
    return i < 0 ? '' : (row[i] ?? '');
  };

  let sheetTotal: number | null = null;
  const out: CapTableRow[] = [];

  for (const row of all.slice(at + 1)) {
    if (row.every((c) => !c)) continue;

    const name = cell(row, 'Name');
    const email = cell(row, 'Email');

    if (!name && !email) {
      if (sheetTotal === null && cell(row, 'Total Shares')) sheetTotal = number(cell(row, 'Total Shares'));
      continue;
    }

    out.push({
      name,
      email,
      annual: number(cell(row, 'Annual Grant')),
      founder: number(cell(row, 'Founder Bonus')),
      believer: number(cell(row, 'Believer Bonus')),
      bounty: number(cell(row, 'Bounty Grants')),
      referral: number(cell(row, 'Referral Bonus')),
      totalShares: number(cell(row, 'Total Shares')),
    });
  }

  return { rows: out, sheetTotal };
}
