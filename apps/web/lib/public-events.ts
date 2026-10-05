/**
 * Where "View all events" sends somebody (PUB-05).
 *
 * Charley: "Make sure the View all events link takes the user to a public view
 * of events at the community... If the URL entry is left blank, show a single
 * page of events that do not require a logged in user to view, RSVP, and buy
 * tickets."
 *
 * So blank is an answer, not an omission — and the answer is a page that needs
 * no account. The link used to go to `/portal/<slug>/events`, which is public
 * to read but wrapped in the signed-in app's shell, so a visitor arriving from
 * a co-op's own website met a sidebar full of things they cannot open.
 */
export function publicEventsHref(
  slug: string,
  publicEventsUrl?: string | null,
): string {
  const theirs = (publicEventsUrl ?? '').trim();
  return theirs || `/orgs/${slug}/events`;
}

/** Whether the link leaves MaybeOS, which decides if it needs `target`. */
export function leavesMaybeOs(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
