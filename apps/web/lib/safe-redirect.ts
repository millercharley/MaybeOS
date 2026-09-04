/**
 * Where `?redirect=` is allowed to send somebody after they sign in.
 *
 * The parameter has always been passed straight to `router.push`, which will
 * happily navigate off-site — so `maybeos.org/login?redirect=https://evil...`
 * took a person to somebody else's page the instant they typed their password.
 * That was latent while almost nothing produced the parameter. AUTH-08 made it
 * the normal path: every blocked portal page now hands out a `/login?redirect=`
 * URL, so a forged one looks exactly like the ones MaybeOS itself sends, which
 * is what turns a latent open redirect into a usable phishing link.
 *
 * Only a path inside this app is allowed. Anything else falls back to the
 * caller's own default rather than being repaired — a value somebody tampered
 * with is not a destination worth guessing at.
 *
 * The cases that matter, and why none is caught by "starts with a slash":
 *
 * - `//evil.com` is **protocol-relative**: the browser reads it as an absolute
 *   URL and leaves the site. It starts with a slash.
 * - `/\\evil.com` is normalised to `//evil.com` by browsers. It also starts
 *   with a slash.
 * - `https://evil.com` and `javascript:...` are absolute, and rejected outright.
 * - A newline or tab can slip past a naive check or split a header, so any
 *   control character disqualifies the whole value.
 */
export function safeRedirect(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) return fallback;

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;

  return value;
}
