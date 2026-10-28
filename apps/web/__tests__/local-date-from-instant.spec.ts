import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A local date is never sliced out of an instant (SPC-34, SRV-08).
 *
 * Twice in one week, in two unrelated features:
 *
 *   - room booking asked a member to confirm 19 February for a slot she had
 *     picked on the 18th, because 8:30pm in New York is 01:30 UTC;
 *   - the service rota's claim lists would have dated an evening turn to the
 *     following day for the same reason.
 *
 * Both were `someInstant.slice(0, 10)` — the first ten characters of an ISO
 * string, which is the *UTC* date. East of Greenwich it agrees with the local
 * date, so it reads correctly to anyone checking from Europe and is wrong for
 * every co-op in the Americas after early evening.
 *
 * The fix in both cases was the same: the server knows the co-op's day and
 * now sends it. This stops the pattern coming back, because the next person
 * to write it will have no reason to suspect anything.
 *
 * A source scan, because the defect is a *correct-looking expression* rather
 * than a behaviour any single test would exercise — it needs a reader in the
 * right timezone to notice.
 */
const ROOT = join(__dirname, '..');
const SEARCH = ['app', 'components', 'lib'];

/** Names that hold an instant rather than a calendar date. */
const INSTANT = /\b\w*(At|Time|Instant)\b\s*(?:\?\.)?\.slice\(\s*0\s*,\s*10\s*\)/;
const ISO_SLICE = /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;

/** The one line allowed to say it, and why, on the line above. */
const ALLOW = 'local-date-exempt';

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return files(rel);
    return /\.tsx?$/.test(entry) ? [rel] : [];
  });
}

describe('dates shown to a member', () => {
  /*
    Comments blanked, not removed — line numbers have to survive so an
    offender can be pointed at.

    Every file that fixes this bug also *describes* it, so a scan over raw
    source trips on its own documentation. `unauthenticated-routes`,
    `tenant-scoping` and the embed scan all had to learn this; writing it
    down again here because the next one will too.
  */
  const blankComments = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
      .replace(/^([ \t]*)\/\/.*$/gm, (line) => line.replace(/[^\n]/g, ' '));

  /*
    Both copies kept, and each is read for a different thing: offenders from
    the blanked source, so prose describing the bug is not one — and the
    exemption from the raw source, because the marker is itself a comment and
    blanking would erase the very thing being looked for.
  */
  const sources = SEARCH.flatMap(files).map((rel) => {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    return { rel, raw, code: blankComments(raw) };
  });

  it('has files to inspect, with comments really blanked', () => {
    // Guards against the whole suite passing because the walk broke, or
    // because the blanking ate the code along with the prose.
    expect(sources.length).toBeGreaterThan(50);

    const form = sources.find((f) => f.rel.endsWith('service/duty-form.tsx'))!;
    expect(form.code).not.toContain('is the UTC date');
    expect(form.code).toContain('const [startsOn, setStartsOn]');
  });

  it('are never sliced out of a UTC instant', () => {
    const offenders: string[] = [];

    for (const { rel, raw, code } of sources) {
      const lines = code.split('\n');
      const rawLines = raw.split('\n');

      lines.forEach((line, i) => {
        if (!INSTANT.test(line) && !ISO_SLICE.test(line)) return;

        /*
          An explicit, reviewed exemption in the comment just above. Four
          lines of room, because the reason is worth a sentence and a
          sentence does not fit on one.
        */
        const nearby = rawLines.slice(Math.max(0, i - 4), i + 1).join('\n');
        if (nearby.includes(ALLOW)) return;

        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 72)}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
