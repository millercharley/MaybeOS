import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A message list opens on its newest message (CMN-18).
 *
 * Reported as "on my phone the Commons opens on the oldest messages and I
 * have to scroll to the bottom". Two faults, both silent:
 *
 * 1. Both views wrote `scrollTop` to the element holding the conversation.
 *    In the Commons that element only scrolls from `lg` up — below it the
 *    pane grows to fit every post and the app shell's `<main>` scrolls — and
 *    `scrollTop` written to an element that cannot scroll is accepted,
 *    clamped to zero, and reported as success.
 *
 * 2. The thread page scrolled on `messages.length` alone. `load()` sets the
 *    thread, awaits two more calls, then clears `loading` in its `finally`,
 *    so the messages land in one commit and the list mounts in a later one —
 *    and the component returns a spinner while `loading`, so the ref was
 *    null for the first and the count was unchanged by the second. It never
 *    ran against a mounted list, on any screen size.
 */
const files = {
  commons: 'app/(app)/portal/[orgSlug]/commons/page.tsx',
  thread: 'app/(app)/portal/[orgSlug]/messages/t/[threadId]/page.tsx',
};

function code(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('every message list lands on the newest message', () => {
  it.each(Object.entries(files))('%s asks which element is scrolling', (_name, path) => {
    expect(code(path)).toContain('scrollToBottom');
  });

  it.each(Object.entries(files))(
    '%s never writes scrollTop to an element it merely holds',
    (_name, path) => {
      // `el.scrollTop = el.scrollHeight` on the conversation container is the
      // original bug: silently a no-op wherever that container is unbounded.
      expect(code(path)).not.toMatch(/scroller\.current\.scrollTop\s*=/);
      expect(code(path)).not.toMatch(/list\.current\.scrollTop\s*=/);
    },
  );

  /**
   * The dependency is the fix, not decoration. Without `loading` the effect
   * runs once against a null ref and never again.
   */
  it('the thread scrolls again once the list has actually mounted', () => {
    const body = code(files.thread);
    const effect = body.slice(body.indexOf('scrollToBottom(list.current)'));
    const deps = effect.slice(effect.indexOf('}, ['), effect.indexOf(']);') + 1);

    expect(deps).toContain('loading');
    expect(deps).toContain('messages.length');
  });

  it('the Commons re-runs when late content changes the height', () => {
    // A welcome note arriving after the posts adds height above the
    // composer; without it the view sits short of the bottom.
    const body = code(files.commons);
    const effect = body.slice(body.indexOf('scrollToBottom(scroller.current)'));
    const deps = effect.slice(effect.indexOf('}, ['), effect.indexOf(']);') + 1);

    expect(deps).toContain('posts');
    expect(deps).toContain('joins');
  });

  it('loading older messages keeps the reader where they were', () => {
    // The same silent no-op: this adjusts scrollTop to absorb the height
    // that appeared above, and must do it on the element that scrolls.
    expect(code(files.commons)).toContain('scrollParent(scroller.current)');
  });
});
