/**
 * A CSV reader, to RFC 4180.
 *
 * Hand-written rather than a dependency, but not because parsing CSV is
 * trivial — because the hard parts are exactly the parts a member export
 * contains. A bio runs to 1,800 characters and holds commas, quotation marks
 * and line breaks; a naive `split(',')` turns one such member into nine
 * broken ones and nobody notices until the roster is wrong.
 *
 * The rules being honoured: a field wrapped in quotes may contain commas and
 * newlines, `""` inside a quoted field is one literal quote, and a file may
 * end without a trailing newline.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  // A BOM survives Excel and would otherwise become part of the first header,
  // so "Email" silently stops matching.
  const input = text.replace(/^\uFEFF/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      started = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      started = true;
      continue;
    }

    if (char === '\r') continue; // CRLF, and a lone CR is not a field.

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      started = false;
      continue;
    }

    field += char;
    started = true;
  }

  // Whatever the file ended on, if it ended on anything.
  if (started || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headers = [], ...body] = rows;

  return {
    headers: headers.map((h) => h.trim()),
    // A row of nothing but empty strings is a blank line, not a member.
    rows: body.filter((r) => r.some((cell) => cell.trim() !== '')),
  };
}

/** Pair a row with its headers, so mapping reads by column name. */
export function toRecord(headers: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, i) => {
    record[header] = (row[i] ?? '').trim();
  });
  return record;
}
