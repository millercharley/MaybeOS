import { createHmac } from 'crypto';

/**
 * The request format the co-op's door Apps Script accepts (DOR-01), matching
 * `integrations/door-sheet/Code.gs`.
 *
 * Apps Script cannot read request headers, so the signature travels in the
 * body. It covers `timestamp + "." + payload`, where the payload is the exact
 * JSON string sent: both sides sign the same bytes, and nothing is
 * re-serialised between signing and checking.
 */

/** One member as the door sheet holds them. */
export interface DoorSheetMember {
  email: string;
  code: string;
  name: string;
  revoked: boolean;
}

export type DoorScriptAction =
  | { action: 'ping' }
  | { action: 'upsert'; members: DoorSheetMember[] };

export interface SignedDoorRequest {
  timestamp: number;
  payload: string;
  signature: string;
}

export function signDoorRequest(
  secret: string,
  body: DoorScriptAction,
  now: number = Date.now(),
): SignedDoorRequest {
  const payload = JSON.stringify(body);
  const signature = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${now}.${payload}`, 'utf8')
    .digest('base64');
  return { timestamp: now, payload, signature };
}

/**
 * A deployed Apps Script web app, and nothing else.
 *
 * MaybeOS posts member emails, names and door codes to this address, so it
 * cannot be "any URL": an organiser, or anyone who takes over an organiser's
 * session, could otherwise point the sync at their own server and collect
 * every code. Also accepts the Workspace-domain form, `/a/macros/<domain>/`.
 */
const SCRIPT_URL =
  /^https:\/\/script\.google\.com\/(?:macros|a\/macros\/[a-z0-9.-]+)\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;

export function isDoorScriptUrl(value: string): boolean {
  return SCRIPT_URL.test(value);
}

/**
 * The deployment id, however the address was copied.
 *
 * Apps Script hands out the same web app under three shapes, and only one of
 * them works for everybody:
 *
 *   https://script.google.com/macros/s/<id>/exec                 the real one
 *   https://script.google.com/macros/u/1/s/<id>/exec             browser copy
 *   https://script.google.com/a/macros/<domain>/s/<id>/exec      Workspace copy
 *
 * Paul Mercer, who built the door hardware and the first sheet, on the second
 * one: "The first link doesn't work because of the /u/1 in the address. It is
 * specifying a file in another open google account, multiple open accounts
 * are indexed 0,1,2 etc. just remove them from the link and it should work."
 *
 * He is right, and it is worse than a broken link: `/u/1` means *whoever is
 * second in the reader's own account switcher*, so the same address opens a
 * different account for every person who clicks it, and works for the person
 * who copied it. That is the shape the browser gives you when more than one
 * Google account is signed in — which is to say, the shape an organiser is
 * most likely to paste.
 *
 * The `/a/macros/<domain>/` form is the Workspace-scoped one: it resolves
 * only for somebody signed into that domain, so a member at the door with a
 * personal Google account, or no account, gets a sign-in wall instead of a
 * keypad.
 *
 * So MaybeOS takes any of the three and keeps the one that works. It used to
 * accept the Workspace form as given and refuse the `/u/N/` one outright,
 * which turned the most likely paste into an error message.
 */
export function canonicalDoorScriptUrl(value: string): string | null {
  const trimmed = value.trim();

  const match = trimmed.match(
    /^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+|macros)(?:\/u\/\d+)?\/s\/([A-Za-z0-9_-]{20,200})\/exec$/,
  );
  if (!match) return null;

  return `https://script.google.com/macros/s/${match[1]}/exec`;
}

/**
 * Where Apps Script sends the response. A POST to `/exec` answers with a 302
 * to this host, and the response body is fetched from there.
 */
export const SCRIPT_RESPONSE_HOST = 'script.googleusercontent.com';
