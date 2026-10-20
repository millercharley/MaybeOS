import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every lookup of a user by address normalises it (AUTH-07).
 *
 * Three modules already had a `normalizeEmail` of their own — the ledger, the
 * sign-in audit, the Stripe scan — while the three ways into the product sat
 * beside them comparing raw strings. Nobody had done anything careless; the
 * rule simply was not written down anywhere a new lookup would meet it.
 *
 * So it is written down here. A `findUnique({ where: { email } })` with an
 * unnormalised variable is the exact shape that cost MaybeItsFate a duplicate
 * of itself.
 */
const SRC = join(__dirname, '../..');

function sources(): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(join(SRC, dir))) {
      const rel = join(dir, entry);
      if (statSync(join(SRC, rel)).isDirectory()) {
        if (entry !== '__tests__' && entry !== 'node_modules') walk(rel);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
        out.push({
          path: rel,
          code: readFileSync(join(SRC, rel), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, ''),
        });
      }
    }
  };
  walk('.');
  return out;
}

/** How far back a shorthand lookup may look for its normalisation. */
const NEARBY_LINES = 15;

/**
 * Was `email` normalised in the few lines before this lookup?
 *
 * Bounded deliberately. A normalisation four screens away is not something a
 * reader will connect to this line, and connecting them is the point.
 */
function normalisedNearby(code: string, at: number): boolean {
  const before = code.slice(0, at).split('\n').slice(-NEARBY_LINES).join('\n');
  return /\bconst\s+email\s*=\s*(normalizeEmail\(|[^;]*\.toLowerCase\()/.test(before);
}

/**
 * `where: { email: <something> }` and the shorthand `where: { email }`.
 *
 * The shorthand has to be caught too, and is the more dangerous of the two:
 * it reads as though somebody chose the value deliberately, when all it says
 * is that a variable happened to be called `email`. The first version of this
 * scan missed it entirely and reported a clean sweep.
 */
const EMAIL_WHERE = /where:\s*\{\s*email\s*(?::\s*([^},]+)|(\}))/g;

describe('looking a person up by address', () => {
  const files = sources();

  it('finds the lookups it is meant to be checking', () => {
    // A scan that matches nothing passes every assertion below it.
    const total = files.reduce(
      (n, f) => n + [...f.code.matchAll(EMAIL_WHERE)].length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it('never searches on a raw variable', () => {
    const raw: string[] = [];

    for (const { path, code } of files) {
      for (const match of code.matchAll(EMAIL_WHERE)) {
        const [, value, shorthand] = match;

        /*
          Shorthand carries no expression to judge, so look at where the
          variable came from: `const email = normalizeEmail(...)` just above
          is as safe as spelling it out at the lookup, and reads better in a
          loop that uses the address a dozen times.

          Bounded to the preceding few lines deliberately. A normalisation
          four screens away is not something a reader will connect to this
          line, and connecting them is the point.
        */
        const expr = shorthand
          ? normalisedNearby(code, match.index ?? 0)
            ? 'normalizeEmail(…) nearby'
            : 'email  (shorthand, not normalised nearby)'
          : value.trim();

        // Normalised at the point of use, or a name that says it already was.
        const safe =
          /normalizeEmail\(|toLowerCase\(/.test(expr) ||
          /^(address|normalized|normalised|lower)/i.test(expr) ||
          /^['"`]/.test(expr);

        if (!safe) raw.push(`${path}: where: { email: ${expr} }`);
      }
    }

    expect(raw).toEqual([]);
  });
});
