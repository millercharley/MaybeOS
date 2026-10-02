import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The payer's address does not leave the database (PAY-10, D-020).
 *
 * `DuesPayment.payerEmail` exists so a payment can be traced after the
 * membership is gone — a receipt, a refund, a question from somebody's bank.
 * It is not there to be displayed. The ledger and the member card show no
 * addresses, and a column that quietly becomes part of an API response is how
 * that stops being true without anybody deciding it should.
 *
 * Scoped to the files that touch the dues ledger, because `payerEmail` is
 * also an unrelated parameter on the room-booking checkout (SPC-06) and a
 * search for the bare word finds that instead.
 *
 * This is a tripwire, not a wall. If a route genuinely needs to return it,
 * change this test deliberately, in the same commit, with a reason.
 */

const SRC = join(__dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
}

const ledgerFiles = sourceFiles(SRC)
  .map((path) => ({ path: path.slice(SRC.length + 1), text: readFileSync(path, 'utf8') }))
  .filter((file) => /\bduesPayment\./.test(file.text));

describe('the payer’s address stays in the database', () => {
  it('finds the files that query the ledger at all', () => {
    // If this drops to nothing the rest of the file is asserting about an
    // empty list, which would pass forever and mean nothing.
    expect(ledgerFiles.length).toBeGreaterThan(0);
  });

  it('is read back by nothing', () => {
    // The writers reach it through `payerFrom`, so the column name does not
    // appear in them either. Anything naming it here is reading it.
    const readers = ledgerFiles.filter((file) => /payerEmail/.test(file.text));

    expect(readers.map((file) => file.path)).toEqual([]);
  });

  it('is in no DTO or controller', () => {
    const exposed = sourceFiles(SRC)
      .map((path) => path.slice(SRC.length + 1))
      .filter((path) => /dues.*\.(dto|controller)\.ts$|recap.*\.(dto|controller)\.ts$/.test(path))
      .filter((path) => /payerEmail|payerName/.test(readFileSync(join(SRC, path), 'utf8')));

    expect(exposed).toEqual([]);
  });
});
