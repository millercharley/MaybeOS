/**
 * Putting a name on the envelope (EML-01).
 *
 * Every MaybeOS message went out as a bare `noreply@maybeos.org` with no
 * display name at all, while its subject and body said "MaybeItsFate". To a
 * filter that is a brand it does not recognise arriving from a domain it does
 * not recognise, which is the shape of a phishing message — and Microsoft
 * treats it as one. Mail was accepted at the gateway with a clean `250` and
 * then suppressed: not in the inbox, not in junk, no bounce, no complaint.
 *
 * Naming the sender does not fix reputation on its own. It removes the
 * cheapest reason to doubt it.
 *
 * The name is the co-op's, not the platform's. A member of MaybeItsFate has
 * never heard of MaybeOS, and mail from a vendor they cannot place is worth
 * less than mail from the co-op they belong to.
 */

/**
 * The longest display name that still fits one RFC 2047 encoded word.
 *
 * An encoded word may not exceed 75 characters including its `=?UTF-8?B?`
 * and `?=` delimiters, which leaves 63 for base64, which holds 45 bytes.
 * Longer names are legal if split across several words, folded with
 * whitespace — correct, and considerably more to get wrong for a gain of
 * nothing: no co-op is called forty-six bytes of Japanese. Latin names get
 * the plainer limit below, where no encoding is involved.
 */
const MAX_ENCODED_BYTES = 45;

/** Long enough for any real name, short enough not to need folding. */
const MAX_PLAIN_CHARS = 64;

/**
 * Characters RFC 5322 will not accept in a bare display name.
 *
 * Present in real co-op names — "Maybe, It's Fate" has two of them — so the
 * quoted form is the common case rather than the exotic one.
 */
const NEEDS_QUOTING = /[()<>[\]:;@\\,."]/;

/**
 * Strip anything that could end the header early.
 *
 * The display name is the co-op's own, typed by an organiser, and it is
 * interpolated straight into a mail header. A carriage return in it would
 * let whoever typed it append headers of their own — a `Bcc`, say — to every
 * message the co-op sends. Removed rather than rejected: a co-op whose name
 * has a stray tab should still get mail out.
 */
function stripControls(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Cut to a byte budget without splitting a character in half. */
function truncateBytes(name: string, maxBytes: number): string {
  if (Buffer.byteLength(name, 'utf8') <= maxBytes) return name;

  let out = '';
  let used = 0;
  // Iterating the string yields whole code points, so an emoji or an accented
  // character is never cut down the middle into bytes that decode to nothing.
  for (const char of name) {
    const size = Buffer.byteLength(char, 'utf8');
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out;
}

/** Does this name need MIME encoding, or will the plain form carry it? */
function isAscii(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[^\u0000-\u007F]/.test(name);
}

/**
 * `Name <address>`, or the bare address when there is no name to use.
 *
 * Returns the address alone whenever the name cannot be made safe — empty,
 * whitespace, or nothing but control characters — because a message with no
 * display name still arrives, and a malformed `From` does not.
 */
export function fromHeader(address: string, displayName?: string | null): string {
  const addr = (address ?? '').trim();
  const name = stripControls(displayName ?? '');
  if (!name) return addr;

  if (!isAscii(name)) {
    const encoded = Buffer.from(truncateBytes(name, MAX_ENCODED_BYTES), 'utf8').toString('base64');
    return `=?UTF-8?B?${encoded}?= <${addr}>`;
  }

  const plain = name.slice(0, MAX_PLAIN_CHARS);
  if (!NEEDS_QUOTING.test(plain)) return `${plain} <${addr}>`;

  // Inside a quoted string only the quote and the backslash need escaping;
  // everything else RFC 5322 objects to is permitted once quoted.
  const quoted = plain.replace(/([\\"])/g, '\\$1');
  return `"${quoted}" <${addr}>`;
}
