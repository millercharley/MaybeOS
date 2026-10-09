import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Reacting to a post (CMN-20).
 *
 * Charley: "there's no feedback when clicking on an emoji on a comment.
 * There's no count or animation. When clicking an emoji, the whole comment
 * section reloads which is awful."
 *
 * Three separate faults behind one gesture. The endpoint was add-only and
 * returned the row it wrote, so pressing twice did nothing and the caller
 * learned nothing it could draw. The list endpoint sent a reaction *count* and
 * not the reactions, so the feed could not say which emoji they were. And with
 * nothing to draw, both screens re-read the post — the admin Commons re-read
 * the open thread too, which is the reload he saw.
 */
const strip = (s: string) =>
  s.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (...p: string[]) => strip(readFileSync(join(__dirname, '..', ...p), 'utf8'));

const admin = read('app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'commons', 'page.tsx');
const portal = read('app', '(app)', 'portal', '[orgSlug]', 'commons', 'page.tsx');
const client = read('lib', 'api.ts');

describe('the gesture', () => {
  it('toggles, so pressing twice takes it back', () => {
    expect(client).toMatch(/reactToPost:/);
    expect(client).not.toMatch(/addReaction:/);
    expect(client).not.toMatch(/removeReaction:/);
  });

  it('answers with the new counts, so there is something to draw', () => {
    expect(client).toMatch(/reactToPost[\s\S]{0,200}reactions: ReactionGroup\[\]/);
  });
});

describe('neither screen reloads the conversation', () => {
  it('the admin Commons updates in place', () => {
    /*
      It called `refetchPosts()` and, if the thread was open,
      `refetchExpandedPost()` — so pressing an emoji re-read the feed and the
      comments underneath the reader.
    */
    const fn = admin.slice(admin.indexOf('async function handleReact'));
    const body = fn.slice(0, fn.indexOf('\n  }'));

    expect(body).toMatch(/reactToPost\(/);
    expect(body).not.toMatch(/refetchPosts\(\)/);
    expect(body).not.toMatch(/refetchExpandedPost\(\)/);
  });

  it('the member Commons stops re-reading the whole post', () => {
    const fn = portal.slice(portal.indexOf('async function react'));
    const body = fn.slice(0, fn.indexOf('\n  }'));

    expect(body).toMatch(/reactToPost\(/);
    expect(body).not.toMatch(/getPost\(/);
  });
});

describe('both use the bar everything else uses', () => {
  it.each([
    ['the admin Commons', admin],
    ['the member Commons', portal],
  ])('%s renders ReactionBar on a post', (_name, source) => {
    // Optimistic, counted, highlights your own, and offers the full set —
    // none of which the four hand-rolled chips did.
    expect(source).toMatch(/<ReactionBar/);
  });

  it('the hand-rolled chips are gone', () => {
    expect(admin).not.toMatch(/QUICK_EMOJIS/);
  });

  it('the admin keeps the server’s counts across a re-render', () => {
    // The feed re-renders for reasons of its own; without this the count would
    // snap back to whatever the last fetch said.
    expect(admin).toMatch(/reactionOverrides\[post\.id\] \?\? post\.reactions \?\? \[\]/);
  });

  it('a failed press rolls back rather than raising a banner', () => {
    // `ReactionBar` restores its guess when `onToggle` answers null.
    const fn = admin.slice(admin.indexOf('async function handleReact'));
    expect(fn.slice(0, fn.indexOf('\n  }'))).toMatch(/return null/);
  });
});

describe('the comment composer in a thread', () => {
  it('is not wrapped in a flex row that collapses it', () => {
    /*
      It was `<div className="flex gap-2">` around a single child. The
      composer's root carries no width and a flex item is `flex: 0 1 auto`, so
      it shrank to the width of its own toolbar at the foot of a full-width
      thread.
    */
    const fn = admin.slice(admin.indexOf('function ReplyBox'));
    const body = fn.slice(0, fn.indexOf('\n}'));

    expect(body).toMatch(/<RichComposer/);
    expect(body).not.toMatch(/className="flex gap-2"/);
  });
});

describe('the emoji picker', () => {
  const bar = strip(readFileSync(join(__dirname, '..', 'components', 'reactions', 'reaction-bar.tsx'), 'utf8'));

  /**
   * Charley: "offer an emoji picker so people can get creative with their
   * emoji responses." The bar offered six and nothing else.
   */
  it('offers more than the six, without burying them', () => {
    // A picker that hides 👍 makes the ordinary case worse to make the rare
    // one possible.
    expect(bar).toMatch(/\[\.\.\.new Set\(\[\.\.\.REACTIONS, \.\.\.COMPOSER_EMOJI\]\)\]/);
    expect(bar).toMatch(/grid-cols-6/);
  });

  it('takes anything at all, typed', () => {
    // No emoji keyboard is shipped: every device already has one.
    expect(bar).toMatch(/Any emoji…/);
    expect(bar).toMatch(/Or use any emoji/);
  });

  it('answers a typo on the spot rather than by a silent rollback', () => {
    expect(bar).toMatch(/looksLikeEmoji\(chosen\)/);
    expect(bar).toMatch(/disabled=\{!looksLikeEmoji\(typed\)\}/);
    expect(bar).toMatch(/That needs to be an emoji/);
  });
});

describe('the rule the picker applies', () => {
  it('matches what the API will accept', () => {
    /*
      Two copies on purpose — the API's is the one that decides — so they are
      tested against the same cases to stop them drifting apart.
    */
    const { looksLikeEmoji } = require('@/lib/reactions');

    expect(looksLikeEmoji('🔥')).toBe(true);
    expect(looksLikeEmoji('👨‍👩‍👧‍👦')).toBe(true);
    expect(looksLikeEmoji('🇬🇧')).toBe(true);
    expect(looksLikeEmoji('nice')).toBe(false);
    expect(looksLikeEmoji(':-)')).toBe(false);
    expect(looksLikeEmoji('')).toBe(false);
    expect(looksLikeEmoji('🎉'.repeat(30))).toBe(false);
  });
});
