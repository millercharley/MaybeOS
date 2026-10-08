import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A visually-hidden control must be hidden *inside* its label (SPC-30).
 *
 * Charley: "when reserving a room and clicking 18+ for the ages, the whole
 * page goes blank." Nothing crashed. `sr-only` is `position: absolute`, and
 * with no positioned ancestor the radio was laid out against the page — 1421px
 * down it, while the chip the member clicked was at 767px. Clicking the label
 * focuses the radio, the browser scrolls to wherever the focused element
 * actually is, and both the window and the scrolling `<main>` jumped to the
 * bottom. The form was still there; the viewport was not.
 *
 * `relative` on the wrapping label is the whole fix, and it is invisible: the
 * rendering looks identical either way until somebody clicks one. So it is
 * guarded here rather than left to be rediscovered.
 */
function tsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, found);
    else if (entry.endsWith('.tsx')) found.push(full);
  }
  return found;
}

const root = join(__dirname, '..');
const files = [...tsxFiles(join(root, 'components')), ...tsxFiles(join(root, 'app'))];

/** Every `sr-only` form control, with the label element that encloses it. */
function hiddenControls() {
  const offenders: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // The opening tag of each form control that is itself sr-only.
    const control = /<(input|select|textarea)\b[^>]*className=(?:"sr-only"|\{[^}]*['"`]sr-only)/g;

    let match: RegExpExecArray | null;
    while ((match = control.exec(source)) !== null) {
      const before = source.slice(0, match.index);
      const labelAt = before.lastIndexOf('<label');
      if (labelAt === -1) continue; // Not wrapped in a label; nothing to position against.

      /*
        The label's own attributes, with comments stripped.

        Not optional: the comment explaining *why* `relative` is needed sits
        between the label and the input and contains the word, so the first
        version of this test passed happily with the class removed. A guard
        that reads its own explanation is not a guard.
      */
      const labelTag = source
        .slice(labelAt, match.index)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      if (!/\brelative\b/.test(labelTag)) {
        const line = before.split('\n').length;
        offenders.push(`${file.replace(root + '/', '')}:${line}`);
      }
    }
  }

  return offenders;
}

describe('visually hidden form controls', () => {
  it('are positioned inside the label that wraps them', () => {
    /*
      Without `relative` on the label, `sr-only`'s `position: absolute`
      resolves against the nearest positioned ancestor — usually the page. The
      control is then laid out hundreds of pixels from the thing the member
      clicked, and focusing it scrolls the view there.
    */
    expect(hiddenControls()).toEqual([]);
  });

  it('actually finds the controls it is checking, so an empty pass means something', () => {
    // A scan that silently matches nothing would pass forever.
    const found = files.filter((f) => /className=(?:"sr-only"|\{[^}]*['"`]sr-only)/.test(
      readFileSync(f, 'utf8').replace(/<(span|div|p|h\d)\b[^>]*>/g, ''),
    ));
    expect(found.length).toBeGreaterThan(0);
  });
});
