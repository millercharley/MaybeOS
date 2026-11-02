import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Where an organiser finds the email feed (EVT-55).
 *
 * The endpoint shipped with nothing in the admin pointing at it, so the only
 * way to reach it was to be told the URL. Charley, looking for it: "There is
 * only one embed option for events in 'Join page & embeds' and this is the
 * embed that's a script for the website."
 *
 * It belongs on that same tab, beside the script. An organiser looking for
 * "how do my events get out of MaybeOS" looks in one place — and the mistake
 * worth preventing is pasting the script into an email, which only reads as a
 * mistake when the two sit together.
 */
const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8')
    /*
      Comments blanked, line breaks kept: both files explain this at length
      and a scan matching prose proves nothing.

      The line comments are stripped only where one *starts* a line. The
      obvious `\/\/[^\n]*` also matches the `//` inside `https://maybeos.org`,
      which truncated the very line this file checks the origin on — the
      assertion failed on a rule the code keeps. Same form the other embed
      scans use.
    */
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '');

const CARD = read('components/settings/email-embed.tsx');
const SETTINGS = read('app/(app)/(dashboard)/admin/[orgSlug]/settings/page.tsx');

describe('it lives on Join page & embeds', () => {
  it('is rendered on that tab, not somewhere of its own', () => {
    expect(SETTINGS).toMatch(/activeTab === 'website' && org && <EmailEmbed org=\{org\} \/>/);
    expect(SETTINGS).toContain("from '@/components/settings/email-embed'");
  });

  it('sits with the website embeds rather than above them', () => {
    // The script is the one most co-ops want; this is the answer to "that
    // did not work in my email", so it reads second.
    const script = SETTINGS.indexOf('<WebsiteEmbed org={org} show="events" />');
    expect(script).toBeGreaterThan(-1);
    expect(SETTINGS.indexOf('<EmailEmbed')).toBeGreaterThan(script);
  });

  it('still shows the tab under the name an organiser sees', () => {
    expect(SETTINGS).toContain("{ key: 'website', label: 'Join page & embeds' }");
  });
});

describe('what it hands over', () => {
  it('is the feed address, not a snippet', () => {
    expect(CARD).toMatch(/const feedUrl = `\$\{origin\}\/api\/embed\/\$\{org\.slug\}\/rss`/);
    expect(CARD).toContain('Copy feed address');
  });

  it('builds it from the host this app is served from', () => {
    // So a staging copy never hands out a production feed.
    expect(CARD).toContain("window.location.origin");
  });

  it('says plainly why the script above will not do', () => {
    expect(CARD).toMatch(/email clients strip scripts/i);
  });

  it('names what a campaign tool calls this', () => {
    expect(CARD).toMatch(/RSS campaign/i);
  });

  it('repeats the privacy line, which matters more in email', () => {
    expect(CARD).toMatch(/Only public events appear/);
    expect(CARD).toMatch(/forwarded/);
  });
});

describe('the preview is the real thing', () => {
  it('reads the feed rather than re-rendering the layout', () => {
    /*
      A preview built from a second implementation can disagree with what
      gets sent, which is the failure it exists to catch. This parses the
      real RSS and shows the real item.
    */
    expect(CARD).toContain('new DOMParser()');
    expect(CARD).toContain("doc.querySelector('item > description')");
    expect(CARD).toMatch(/await fetch\(feedUrl/);
  });

  it('bypasses the edge cache when asked to refresh', () => {
    // The feed is cached five minutes; an organiser pressing Refresh after
    // an edit means it.
    expect(CARD).toContain("cache: 'no-store'");
    expect(CARD).toContain('Refresh');
  });

  it('renders it in a frame rather than in the admin’s own styles', () => {
    // Email HTML carries its own styles on every element and lives in a
    // 600px world; the admin stylesheet would show something neither
    // accurate nor email-like.
    expect(CARD).toContain('<iframe');
    expect(CARD).toContain('srcDoc=');
  });

  it('sandboxes the frame, because members wrote the text in it', () => {
    expect(CARD).toMatch(/sandbox=""/);
  });

  it('opens any link inside it in a new tab', () => {
    expect(CARD).toContain('<base target="_blank">');
  });

  it('grows the frame to its content, since an email has no scrollbar', () => {
    expect(CARD).toMatch(/body\.scrollHeight/);
    expect(CARD).toContain('onLoad={fit}');
  });

  it('says what went wrong rather than showing an empty box', () => {
    // The three it can distinguish.
    for (const message of ['not valid XML', 'carried no events', 'answered']) {
      expect(CARD).toContain(message);
    }

    /*
      And that the message actually reaches the screen. Checking only that
      the strings exist passed while the catch threw them away — they are
      written at the `throw`, and a `setError('')` underneath left the box
      blank with every sentence still in the file.
    */
    expect(CARD).toMatch(/setError\(err instanceof Error \? err\.message :/);
    expect(CARD).toMatch(/\{error\}/);
  });
});
