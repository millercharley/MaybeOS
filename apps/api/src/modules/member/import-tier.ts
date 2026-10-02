/**
 * Matching a roster's tier column to the co-op's own tiers (MEM-21).
 *
 * Every co-op arriving from somewhere else knows what each member pays — it
 * is the column its old system was built around — and until now the importer
 * threw that away. MaybeItsFate imported 426 members and the Members page
 * showed a dash in the Tier column for every one of them, because the only
 * thing that had ever set a tier was Stripe.
 *
 * Matched by **name**, not id, because the file is written by a person and a
 * uuid is not something anybody types. Case and surrounding space are
 * ignored; everything else must match, since a co-op with "$10 Member" and
 * "$100 Member" would not thank us for a fuzzy match.
 */

export interface NamedTier {
  id: string;
  name: string;
}

/** Lowercased, trimmed, inner runs of space collapsed. */
function key(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export class UnknownTierError extends Error {
  constructor(name: string, known: NamedTier[]) {
    // Names the alternatives, because the organiser is looking at their own
    // spreadsheet and cannot see what MaybeOS calls these.
    const list = known.map((t) => `"${t.name}"`).join(', ');
    super(
      known.length > 0
        ? `No membership tier called "${name.trim()}" here. This co-op has ${list}.`
        : `No membership tier called "${name.trim()}" here, and this co-op has none set up yet.`,
    );
    this.name = 'UnknownTierError';
  }
}

/**
 * The tier id for a row's tier name.
 *
 * `undefined` when the row said nothing — the common case, and not an error.
 * Throws when it said something the co-op does not have, because silently
 * importing somebody with no tier is how a roster ends up half-priced without
 * anybody noticing.
 */
export function tierIdFor(name: string | undefined, tiers: NamedTier[]): string | undefined {
  if (name === undefined) return undefined;
  if (name.trim() === '') return undefined;

  const match = tiers.find((tier) => key(tier.name) === key(name));
  if (!match) throw new UnknownTierError(name, tiers);

  return match.id;
}
