import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * What Sync now says when it has finished (DOR-06).
 *
 * Sync now is a full resend: it always reports the hundred rows it just sent,
 * so the press that completes the job reads exactly like the five presses
 * after it. The only thing distinguishing them was a "still to go" clause
 * that stopped appearing — and an absent sentence is not a signal.
 *
 * Charley pressed it six times against an unchanging "Issued 0 codes, sent
 * 100 rows to the sheet", with every member already in step from the third
 * press on, and had no way to tell.
 */
const panel = stripComments(
  readFileSync(join(__dirname, '..', 'components', 'settings', 'door-access.tsx'), 'utf8'),
);

describe('the sync result', () => {
  it('says how much is left when something is', () => {
    expect(panel).toMatch(/still to go/);
    expect(panel).toMatch(/press Sync now again/);
  });

  it('says so out loud when nothing is left', () => {
    // The fix: the finished case had an empty string where a sentence
    // belongs.
    expect(panel).toMatch(/nothing left to send/);
  });

  it('never answers the finished case with silence', () => {
    /*
      Scoped to the `remaining` ternary. An earlier version of this test
      sliced from the first mention of `remaining` and caught the `emailed`
      ternary beside it, whose empty branch is correct — "emailed 0" is noise
      on a press that emailed nobody, whereas "finished" is the whole point.
    */
    const after = panel.slice(panel.indexOf('still to go'));
    const falseBranch = after.slice(0, after.indexOf(')'));

    expect(falseBranch).toMatch(/nothing left to send/);
    expect(falseBranch).not.toMatch(/:\s*''/);
  });

  it('still reports what it sent, which is what it did', () => {
    expect(panel).toMatch(/sent \$\{synced\}/);
  });
});
