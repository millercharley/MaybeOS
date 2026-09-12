import {
  findMentionQuery,
  matchMentions,
  mentionHref,
  mentionHtml,
  parseMention,
  channelLabel,
} from '@/lib/mentions';
import { renderBodyHtml } from '@/lib/rich-text';

/**
 * @ a member, # a channel (CMN-11).
 *
 * A mention is a real anchor, so the two halves of this — the composer that
 * writes the address and the reader that recognises it — have to agree
 * forever. They are tested against each other rather than against a fixed
 * string, because a string in a test is a third opinion that can be wrong on
 * its own.
 */
describe('mentions', () => {
  describe('spotting one being typed', () => {
    it('opens on a trigger at the start of a message', () => {
      expect(findMentionQuery('@ad')).toMatchObject({ trigger: '@', query: 'ad' });
      expect(findMentionQuery('#cyc')).toMatchObject({ trigger: '#', query: 'cyc' });
    });

    it('opens on a bare trigger, before anything is typed', () => {
      // The `@` button inserts exactly this and expects the list to appear.
      expect(findMentionQuery('hello @')).toMatchObject({ trigger: '@', query: '' });
    });

    it('opens after the non-breaking space a finished mention leaves behind', () => {
      // The composer inserts `&nbsp;` after each mention, so a second mention
      // typed straight after the first is preceded by U+00A0 rather than an
      // ordinary space. JavaScript's `\s` covers it; this is the case that
      // proves it, because getting it wrong makes the second @ silently dead.
      expect(findMentionQuery('hi \u00a0@ad')).toMatchObject({ trigger: '@', query: 'ad' });
    });

    it('does not fire inside an email address', () => {
      // The most irritating way to get this wrong: a picker opening halfway
      // through typing somebody's address.
      expect(findMentionQuery('write to ada@example')).toBeNull();
    });

    it('does not fire inside a word', () => {
      expect(findMentionQuery('c#minor')).toBeNull();
    });

    it('closes once the mention is finished and a space typed', () => {
      expect(findMentionQuery('@Ada Lovelace said ')).toBeNull();
    });

    it('reports how much to delete, trigger included', () => {
      // Off by one here eats the character before the mention, or leaves a
      // stray "@" in front of the finished link.
      expect(findMentionQuery('hi @ada')?.length).toBe(4);
      expect(findMentionQuery('hi @')?.length).toBe(1);
    });

    it('closes at a space rather than following a sentence', () => {
      // The query is one word. Typing "@Ada Lov" does not narrow anything —
      // the surname is found by typing the surname, which `matchMentions`
      // matches on. The alternative keeps a picker open over ordinary prose
      // after a stray "@", which is worse than a second attempt.
      expect(findMentionQuery('@Ada Lov')).toBeNull();
      expect(matchMentions([{ id: '1', name: 'Ada Lovelace' }], 'lov')).toHaveLength(1);
    });
  });

  describe('the address a mention carries', () => {
    it('round-trips a member', () => {
      const href = mentionHref('member', 'maybeitsfate', 'user-1');
      expect(parseMention(href)).toEqual({ kind: 'member', id: 'user-1' });
    });

    it('round-trips a channel', () => {
      const href = mentionHref('channel', 'maybeitsfate', 'chan-1');
      expect(parseMention(href)).toEqual({ kind: 'channel', id: 'chan-1' });
    });

    it('recognises the absolute form a paste or a quote produces', () => {
      expect(
        parseMention('https://app.maybeos.com/portal/maybeitsfate/directory?member=user-9'),
      ).toEqual({ kind: 'member', id: 'user-9' });
    });

    it('leaves an ordinary link alone', () => {
      expect(parseMention('https://example.com/directory')).toBeNull();
      expect(parseMention('https://example.com/?member=not-ours')).toBeNull();
      expect(parseMention('')).toBeNull();
    });

    it('survives the sanitiser, which is the point of using an href', () => {
      // A `data-member-id` would be stripped on the way out and the mention
      // would render as ordinary blue text.
      const body = `<p>thanks ${mentionHtml('member', 'maybeitsfate', 'user-1', '@Ada')}</p>`;
      const rendered = renderBodyHtml(body);

      expect(rendered).toContain('/portal/maybeitsfate/directory?member=user-1');
      expect(rendered).toContain('@Ada');
    });

    it('escapes a name that contains markup', () => {
      const html = mentionHtml('member', 'coop', 'user-1', '@<img src=x onerror=alert(1)>');
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });
  });

  describe('what the picker offers', () => {
    const people = [
      { id: '1', name: 'Ada Lovelace' },
      { id: '2', name: 'Charles Babbage' },
      { id: '3', name: 'Adam Smith' },
      { id: '4', name: 'Grace Hopper' },
    ];

    it('puts a name that starts with the query first', () => {
      const found = matchMentions(people, 'ada');
      expect(found.map((p) => p.name)).toEqual(['Ada Lovelace', 'Adam Smith']);
    });

    it('matches on a surname', () => {
      expect(matchMentions(people, 'hopper').map((p) => p.name)).toEqual(['Grace Hopper']);
    });

    it('does not match a fragment from the middle of a word', () => {
      // "ove" finding "Lovelace" makes the list noise on short queries.
      expect(matchMentions(people, 'ove')).toHaveLength(0);
    });

    it('offers everybody, in name order, before anything is typed', () => {
      expect(matchMentions(people, '').map((p) => p.name)).toEqual([
        'Ada Lovelace',
        'Adam Smith',
        'Charles Babbage',
        'Grace Hopper',
      ]);
    });

    it('never returns the whole co-op', () => {
      const many = Array.from({ length: 300 }, (_, i) => ({ id: `${i}`, name: `Member ${i}` }));
      expect(matchMentions(many, '').length).toBeLessThanOrEqual(8);
    });
  });

  describe('how a channel reads', () => {
    it('uses the emoji when it has one, and a # when it does not', () => {
      expect(channelLabel({ id: '1', name: 'General', emoji: '💬' })).toBe('💬 General');
      expect(channelLabel({ id: '2', name: 'General' })).toBe('#General');
    });
  });
});
