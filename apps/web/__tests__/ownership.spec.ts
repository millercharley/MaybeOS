import { readFileSync } from 'fs';
import { join } from 'path';
import { formatOwnership, formatShares } from '@/lib/ledger';

/**
 * Ownership moved off the directory and onto the member (MEM-24).
 *
 * The Members space listed every member largest holding first, numbered, with
 * their shares and their percentage beside their name. Charley, 2026-10-02:
 * "it feels like a ranking". It was one — a co-op's own directory telling
 * each member where they placed in a league table of their community every
 * time they looked somebody up.
 */

const WEB = join(__dirname, '..');
const directory = readFileSync(
  join(WEB, 'app', '(app)', 'portal', '[orgSlug]', 'directory', 'page.tsx'),
  'utf8',
);
const card = readFileSync(join(WEB, 'components', 'member', 'member-card.tsx'), 'utf8');

describe('the directory is a directory', () => {
  it('has no Shares or Ownership column', () => {
    expect(directory).not.toMatch(/>Shares</);
    expect(directory).not.toMatch(/>Ownership</);
  });

  it('does not number the members', () => {
    // The `#` column was the ranking made literal.
    expect(directory).not.toMatch(/holder\.rank/);
  });

  it('does not total the co-op at the bottom', () => {
    expect(directory).not.toMatch(/Total distributed/);
  });

  it('does not format a share figure anywhere', () => {
    // Not importing the formatters is the structural version of this: there
    // is nothing on hand to print a holding with.
    expect(directory).not.toMatch(/formatShares|formatOwnership/);
  });
});

describe('a member sees their own', () => {
  it('offers Ownership after About, Posts and Comments', () => {
    const order = ['>\n                    About', "setTab('posts')", "setTab('comments')", "setTab('ownership')"];
    let last = -1;
    for (const needle of order) {
      const at = card.indexOf(needle);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  it('shows the tab only on your own card', () => {
    expect(card).toMatch(/profile\.isYou && holding\?\.sharesEnabled/);
  });

  it('asks for the holding only when the card is yours', () => {
    // Not merely hiding a tab: opening somebody else's card does not ask
    // about shares at all, and there is no route that would answer.
    expect(card).toMatch(/if \(!token \|\| !profile\?\.isYou\)/);
    expect(card).toMatch(/api\.ledger\s*\n?\s*\.mine\(orgId, token\)/);
  });

  it('forgets the previous card’s figures when another opens', () => {
    expect(card).toMatch(/setHolding\(null\)/);
  });

  it('shows the log, the total and the percentage', () => {
    expect(card).toMatch(/Every grant you have received/);
    expect(card).toMatch(/formatOwnership\(shares, totalShares\)/);
    expect(card).toMatch(/formatShares\(shares\)/);
  });

  it('says plainly that nobody else can see it', () => {
    expect(card).toMatch(/Only you can see this/);
  });

  it('reads a negative adjustment as one', () => {
    expect(card).toMatch(/line\.shares < 0/);
  });
});

describe('the numbers themselves', () => {
  it('does not round a typical MaybeItsFate holding to nothing', () => {
    // A few hundred shares of eleven million. "0.00%" would tell four
    // hundred people they own none of the co-op they own part of.
    expect(formatOwnership(400, 11_274_100)).toBe('0.0035%');
    expect(formatShares(11_274_100)).toBe('11,274,100');
  });

  it('reads as a cap table above one per cent', () => {
    expect(formatOwnership(5_000_000, 11_274_100)).toBe('44.35%');
  });

  it('says nothing is nothing', () => {
    expect(formatOwnership(0, 11_274_100)).toBe('0%');
  });
});
