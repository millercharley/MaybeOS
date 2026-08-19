import { parseCsv, toRecord } from '@/lib/csv';

/**
 * The cases that decide whether an import produces a roster or a mess.
 *
 * Every one of these is present in a real Circle export: bios with commas and
 * line breaks, quoted names, and a BOM from whatever wrote the file.
 */
describe('parseCsv', () => {
  it('reads a plain file', () => {
    const { headers, rows } = parseCsv('Email,Name\na@x.org,Maya\nb@x.org,Alex');

    expect(headers).toEqual(['Email', 'Name']);
    expect(rows).toEqual([
      ['a@x.org', 'Maya'],
      ['b@x.org', 'Alex'],
    ]);
  });

  it('keeps commas inside a quoted field', () => {
    const { rows } = parseCsv('Email,Bio\na@x.org,"Potter, baker, and neighbour"');

    expect(rows[0][1]).toBe('Potter, baker, and neighbour');
  });

  it('keeps line breaks inside a quoted field', () => {
    // A bio written as two paragraphs. Split on newline and this one member
    // becomes two, the second with no email address.
    const { rows } = parseCsv('Email,Bio\na@x.org,"First line\nSecond line"\nb@x.org,Short');

    expect(rows).toHaveLength(2);
    expect(rows[0][1]).toBe('First line\nSecond line');
    expect(rows[1][0]).toBe('b@x.org');
  });

  it('reads a doubled quote as one literal quote', () => {
    const { rows } = parseCsv('Email,Headline\na@x.org,"They call me ""Doc"""');

    expect(rows[0][1]).toBe('They call me "Doc"');
  });

  it('handles CRLF line endings', () => {
    const { headers, rows } = parseCsv('Email,Name\r\na@x.org,Maya\r\n');

    expect(headers).toEqual(['Email', 'Name']);
    expect(rows).toEqual([['a@x.org', 'Maya']]);
  });

  it('strips a byte-order mark so the first header still matches', () => {
    const { headers } = parseCsv('﻿Email,Name\na@x.org,Maya');

    expect(headers[0]).toBe('Email');
  });

  it('reads a final row with no trailing newline', () => {
    const { rows } = parseCsv('Email\na@x.org');

    expect(rows).toEqual([['a@x.org']]);
  });

  it('drops blank lines rather than importing them as members', () => {
    const { rows } = parseCsv('Email,Name\na@x.org,Maya\n\n,\nb@x.org,Alex');

    expect(rows).toEqual([
      ['a@x.org', 'Maya'],
      ['b@x.org', 'Alex'],
    ]);
  });

  it('tolerates a short row rather than shifting the columns after it', () => {
    const { headers, rows } = parseCsv('Email,Name,Bio\na@x.org,Maya');

    expect(toRecord(headers, rows[0])).toEqual({ Email: 'a@x.org', Name: 'Maya', Bio: '' });
  });
});
