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
 * Where Apps Script sends the response. A POST to `/exec` answers with a 302
 * to this host, and the response body is fetched from there.
 */
export const SCRIPT_RESPONSE_HOST = 'script.googleusercontent.com';
