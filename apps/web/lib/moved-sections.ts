/**
 * Sections that used to be on My Profile (UI-03).
 *
 * Splitting My Settings out of My Profile moved several cards, and some of
 * them are linked to by anchor from emails that are already in people's
 * inboxes — `#interests` from every Radar digest ever sent, `#buddy` from the
 * Off the Hook notice. Those links cannot be edited now.
 *
 * So My Profile forwards the hashes it no longer has, rather than opening on
 * a page where the thing somebody was sent to look at is simply absent. An
 * old link keeps working; a new one goes straight to the right page.
 */
export const MOVED_TO_SETTINGS = ['interests', 'buddy', 'forum', 'demographics', 'email-preferences'];

/**
 * Where a hash should actually land, or null to stay put.
 *
 * Takes the raw `location.hash`, leading `#` and all, because that is what
 * the caller has.
 */
export function movedTo(hash: string, orgSlug: string): string | null {
  const name = (hash ?? '').replace(/^#/, '').trim();
  if (!name || !orgSlug) return null;

  return MOVED_TO_SETTINGS.includes(name) ? `/member/${orgSlug}/settings#${name}` : null;
}
