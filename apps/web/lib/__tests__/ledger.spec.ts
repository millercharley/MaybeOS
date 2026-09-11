import { formatOwnership, parseCapTable, CapTableFormatError } from '../ledger';

/**
 * Reading the cap table, and writing ownership (MEM-17).
 *
 * The fixture has the real sheet's shape: a summary line before the header,
 * a totals row straight after it, the LLC row with no email, a person on two
 * rows, and a name with a comma in it.
 */
const SHEET = [
  ',,,,Active Members:,430,181,17,234,,,,,,,,,,,',
  'Name,Email,Date Joined,Access,Code,Total,Sustainer,Believer,PWYC,Amount,Annual Grant,Founder Bonus,Believer Bonus,Bounty Grants,Referral Bonus,Total Shares',
  ',,,,,430,181,17,234,"$4,854.00",81300,10012700,1300,1180000,0,"11,275,200"',
  'MaybeItsFate LLC,,4/1/2023,LLC,,0,,,,$0.00,0,10000000,,,,10000000',
  '"Miller, Charles",c@example.com,9/22/2023,Yes,,1,1,,,$19.50,400,5000000,,,,5000400',
  'Dee,dee@example.com,1/1/2024,Duplicate,,0,,,0,$0.00,100,,,,,100',
  'Dee,dee@example.com,1/1/2024,Yes Cohort,,0,,,0,$0.00,200,,,,,200',
].join('\n');

describe('parseCapTable', () => {
  it('finds the header even though it is not the first line', () => {
    const { rows } = parseCapTable(SHEET);
    expect(rows[0].name).toBe('MaybeItsFate LLC');
  });

  it('reads the totals row as the figure to reconcile to', () => {
    expect(parseCapTable(SHEET).sheetTotal).toBe(11_275_200);
  });

  it('keeps the LLC row, with no email, for the server to report', () => {
    const llc = parseCapTable(SHEET).rows[0];
    expect(llc.email).toBe('');
    expect(llc.founder).toBe(10_000_000);
  });

  it('reads a quoted name with a comma as one name', () => {
    const charles = parseCapTable(SHEET).rows[1];
    expect(charles.name).toBe('Miller, Charles');
    expect(charles.totalShares).toBe(5_000_400);
    expect(charles.founder).toBe(5_000_000);
  });

  it('keeps both rows for a person listed twice', () => {
    expect(parseCapTable(SHEET).rows.filter((r) => r.email === 'dee@example.com')).toHaveLength(2);
  });

  it('refuses a file that is not a cap table', () => {
    expect(() => parseCapTable('First Name,Last Name\nAda,L')).toThrow(CapTableFormatError);
  });
});

describe('formatOwnership', () => {
  const total = 11_275_200;

  it('writes a large holding to two decimals', () => {
    expect(formatOwnership(5_000_400, total)).toBe('44.35%');
  });

  it('does not round a typical member down to nothing', () => {
    // 200 of 11.3 million is 0.0018% — "0.00%" would tell them they own none.
    expect(formatOwnership(200, total)).toBe('0.0018%');
  });

  it('says zero for zero', () => {
    expect(formatOwnership(0, total)).toBe('0%');
    expect(formatOwnership(100, 0)).toBe('0%');
  });

  it('floors the unreadably small rather than printing an exponent', () => {
    expect(formatOwnership(1, 1_000_000_000)).toBe('<0.0001%');
  });
});
