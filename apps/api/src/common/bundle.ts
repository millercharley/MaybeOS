/**
 * One request that carries several answers, and what to do when one fails.
 *
 * Written for the member dashboard (OPS-46) and generalised when the app
 * shell needed the same thing (OPS-47). Two bundles is the point at which a
 * second copy of this would have been written, and MEM-27 is the card about
 * what happens then: four correct copies of a rule are four chances for a
 * fifth to be written differently, and that is exactly how a guest came to
 * count as a member in published impact reports.
 *
 * So the machinery lives here and the bundles own only their own lists. A
 * bundle module holds the part that is a decision — which sections exist, and
 * which service answers each — and no queries at all.
 */

/** Every section of a bundle, each either an answer or `null`. */
export type Bundle<N extends string, T = unknown> = Record<N, T | null>;

/**
 * A failure carries its reason, so the caller never walks the results a
 * second time to find out why a section is null. The first version returned
 * bare names and the caller re-zipped names to results to recover the
 * reasons — two places deciding which section a result belonged to, which is
 * one more than there should be.
 */
export type BundleFailure<N extends string> = { name: N; reason: unknown };

/**
 * Settle, rather than await.
 *
 * The fan-out this replaced had one accidental virtue: a panel whose request
 * failed drew nothing and the others were unaffected. `Promise.all` would
 * turn one failing query into a 500 for the whole page — strictly worse than
 * what it replaced. Tests in both bundles refuse `Promise.all` by source
 * scan, and are verified by mutation.
 */
export function settleBundle<N extends string, T>(
  names: readonly N[],
  results: PromiseSettledResult<T>[],
): { sections: Bundle<N, T>; failed: BundleFailure<N>[] } {
  if (names.length !== results.length) {
    // A programming error, not a runtime condition: the caller built its task
    // list and its name list out of step. Loud, because the alternative is a
    // response that silently labels every section with the wrong data.
    throw new Error(`bundle: ${names.length} sections but ${results.length} results`);
  }

  const sections = {} as Bundle<N, T>;
  const failed: BundleFailure<N>[] = [];

  names.forEach((name, i) => {
    const result = results[i];
    if (result.status === 'fulfilled') {
      sections[name] = result.value;
      return;
    }
    sections[name] = null;
    failed.push({ name, reason: result.reason });
  });

  return { sections, failed };
}

/**
 * A section refused with 403 is a co-op not using the feature, not a failure.
 *
 * `teaching.listForOrg` throws when the switch is off, and most co-ops have it
 * off; logging that would write a warning on every dashboard load in the
 * product — exactly the noise D-046 exists to stop.
 *
 * Duck-typed rather than `instanceof HttpException`, so this file keeps no
 * framework import and a test can pass a plain object.
 */
export function isUnavailable(reason: unknown): boolean {
  const status = (reason as { getStatus?: () => unknown } | null)?.getStatus;
  return typeof status === 'function' && status.call(reason) === 403;
}
