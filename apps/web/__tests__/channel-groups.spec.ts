import { groupChannels } from '../lib/channel-groups';

const section = (id: string) => ({ id, name: id });
const channel = (id: string, sectionId: string | null = null, isPinned = false) => ({ id, sectionId, isPinned });
const ids = (groups: ReturnType<typeof groupChannels>) =>
  groups.map((g) => [g.section ? (g.section as { id: string }).id : null, g.channels.map((c) => (c as { id: string }).id)]);

describe('groupChannels', () => {
  it('puts channels under their section, ungrouped first, sections in order', () => {
    const groups = groupChannels(
      [channel('general'), channel('art', 'clubs'), channel('events'), channel('books', 'clubs')],
      [section('clubs')],
    );
    expect(ids(groups)).toEqual([
      [null, ['general', 'events']],
      ['clubs', ['art', 'books']],
    ]);
  });

  it('hides an empty section in the member sidebar, and shows it to an admin', () => {
    const channels = [channel('general')];
    expect(ids(groupChannels(channels, [section('clubs')]))).toEqual([[null, ['general']]]);
    expect(ids(groupChannels(channels, [section('clubs')], { includeEmpty: true }))).toEqual([
      [null, ['general']],
      ['clubs', []],
    ]);
  });

  it('keeps an ungrouped area for an admin to drag a channel back into, even when empty', () => {
    const groups = groupChannels([channel('art', 'clubs')], [section('clubs')], { includeEmpty: true });
    expect(ids(groups)).toEqual([
      [null, []],
      ['clubs', ['art']],
    ]);
  });

  it('never loses a channel whose section no longer exists', () => {
    expect(ids(groupChannels([channel('art', 'deleted')], [section('clubs')]))).toEqual([[null, ['art']]]);
  });

  it('pins first within a group, otherwise keeps the given order', () => {
    const groups = groupChannels(
      [channel('a', 'clubs'), channel('b', 'clubs', true), channel('c', 'clubs')],
      [section('clubs')],
    );
    expect(ids(groups)).toEqual([['clubs', ['b', 'a', 'c']]]);
  });
});
