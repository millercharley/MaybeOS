import { safeRedirect } from '@/lib/safe-redirect';

/**
 * AUTH-08 made `?redirect=` the normal way into MaybeOS, so a forged one now
 * looks exactly like the ones the product sends. Every case below is a value
 * that a "starts with a slash" check would wave through.
 */
describe('where ?redirect= may send somebody', () => {
  it('keeps a path inside the app', () => {
    expect(safeRedirect('/portal/maybeitsfate/rooms', '/member')).toBe(
      '/portal/maybeitsfate/rooms',
    );
    expect(safeRedirect('/member/x/billing?tab=1', '/member')).toBe('/member/x/billing?tab=1');
  });

  it('refuses a protocol-relative URL', () => {
    // The browser reads this as absolute and leaves the site — and it starts
    // with a slash, so a prefix check passes it.
    expect(safeRedirect('//evil.example/login', '/member')).toBe('/member');
  });

  it('refuses a backslash the browser will normalise into one', () => {
    expect(safeRedirect('/\\evil.example', '/member')).toBe('/member');
  });

  it('refuses an absolute URL and a scheme', () => {
    expect(safeRedirect('https://evil.example', '/member')).toBe('/member');
    expect(safeRedirect('javascript:alert(1)', '/member')).toBe('/member');
  });

  it('refuses anything carrying a control character', () => {
    expect(safeRedirect('/member\nSet-Cookie: x=1', '/member')).toBe('/member');
    expect(safeRedirect('/\t/evil.example', '/member')).toBe('/member');
  });

  it('falls back when there is nothing there', () => {
    expect(safeRedirect(null, '/member')).toBe('/member');
    expect(safeRedirect('', '/member')).toBe('/member');
  });
});
