/**
 * The words that go out with a shared event (SOC-01), and the rules for an
 * Instagram username.
 *
 * The host writes the body. The credit line and the link are always added
 * here, after it, so a post cannot go out without saying who is hosting and
 * where to RSVP, and a host cannot credit someone else by editing the text.
 */

/** Instagram's caption limit. Facebook allows far more, so this is the binding one. */
export const CAPTION_LIMIT = 2200;

/** What a host can write, leaving room for the credit and the link. */
export const BODY_LIMIT = 1800;

/** Instagram usernames: letters, digits, periods and underscores, up to 30. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

/** A username as a member typed it, with or without the @, or null if it is not one. */
export function normaliseHandle(value: string | null | undefined): string | null {
  const handle = (value ?? '').trim().replace(/^@/, '');
  if (!handle) return null;
  return HANDLE.test(handle) && !handle.startsWith('.') && !handle.endsWith('.') ? handle.toLowerCase() : null;
}

export interface CaptionInput {
  body: string;
  hostName: string;
  instagramHandle: string | null;
  eventUrl: string;
}

export function facebookMessage({ body, hostName, instagramHandle, eventUrl }: CaptionInput): string {
  const credit = instagramHandle ? `Hosted by ${hostName} (@${instagramHandle} on Instagram)` : `Hosted by ${hostName}`;
  return clip([body.trim(), credit, `RSVP: ${eventUrl}`]);
}

/**
 * Instagram does not make links in a caption clickable, but the address is
 * still worth including: people copy it. The @handle is a real mention there,
 * so the host is notified and linked even if they do not accept the
 * collaborator invite.
 */
export function instagramCaption({ body, hostName, instagramHandle, eventUrl }: CaptionInput): string {
  const credit = instagramHandle ? `Hosted by @${instagramHandle}` : `Hosted by ${hostName}`;
  return clip([body.trim(), credit, `RSVP: ${eventUrl}`]);
}

/** Joins the parts, trimming the body, never the credit or link, to fit. */
function clip([body, ...tail]: string[]): string {
  const fixed = `\n\n${tail.join('\n')}`;
  const room = CAPTION_LIMIT - fixed.length;
  const text = body.length > room ? `${body.slice(0, Math.max(0, room - 1)).trimEnd()}…` : body;
  return `${text}${fixed}`.trim();
}

/** A starting body for the host to edit: title, when, where, and the first lines of the description. */
export function defaultBody(event: {
  title: string;
  startTime: Date;
  timezone: string | null;
  locationName: string | null;
  description: string | null;
}): string {
  const when = event.startTime.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: event.timezone || 'America/New_York',
  });
  const lines = [event.title, `${when}${event.locationName ? ` · ${event.locationName}` : ''}`];
  const description = (event.description ?? '').replace(/\s+/g, ' ').trim();
  if (description) {
    lines.push('', description.length > 400 ? `${description.slice(0, 399).trimEnd()}…` : description);
  }
  return lines.join('\n');
}
