import { hostFields, hostKey, hostLabel } from '../past-host';

/**
 * Who ran an imported event, when they are not a member (CAL-03).
 *
 * MaybeItsFate is importing years of its own Google Calendar. Some of those
 * evenings were run by people who have since left, and the importer matched
 * the organiser to a membership and, finding none, recorded nothing — so the
 * co-op's own history arrived with nobody's name on it.
 *
 * Charley, 2026-10-02: "just note the name of this user in the past event. If
 * the person re-joins in the future, reconnect them to their past events."
 */

describe('matching a host', () => {
  it('ignores case and spacing, because an address is all this is for', () => {
    expect(hostKey('  Sam@Example.com ')).toBe('sam@example.com');
  });

  it('treats nothing as nothing', () => {
    expect(hostKey('')).toBeNull();
    expect(hostKey('   ')).toBeNull();
    expect(hostKey(null)).toBeNull();
    expect(hostKey(undefined)).toBeNull();
  });
});

describe('naming a host who is not here', () => {
  it('uses the name Google had', () => {
    expect(hostLabel('Sam Mullooly', 'sam@example.com')).toBe('Sam Mullooly');
  });

  it('falls back to the local part, never the whole address', () => {
    // An event page is read by the whole co-op. Publishing a departed
    // member's address on it is not ours to do.
    expect(hostLabel(null, 'sam.mullooly@example.com')).toBe('sam mullooly');
    expect(hostLabel('  ', 'sam@example.com')).toBe('sam');
  });

  it('never leaks the domain', () => {
    expect(hostLabel(null, 'sam@example.com')).not.toContain('@');
    expect(hostLabel(null, 'sam@example.com')).not.toContain('example.com');
  });

  it('has nothing to say when there is no organiser at all', () => {
    expect(hostLabel(null, null)).toBeNull();
    expect(hostLabel(null, '')).toBeNull();
  });
});

describe('what gets written on the event', () => {
  it('prefers the member, and keeps no copy of their name', () => {
    // A name copied from a calendar invitation three years ago would outlive
    // every rename they ever make.
    expect(hostFields('u-sam', 'sam@example.com', 'Sam Mullooly')).toEqual({
      hostId: 'u-sam',
      hostEmail: null,
      hostName: null,
    });
  });

  it('records the organiser when nobody matched', () => {
    expect(hostFields(null, 'Sam@Example.com', 'Sam Mullooly')).toEqual({
      hostId: null,
      hostEmail: 'sam@example.com',
      hostName: 'Sam Mullooly',
    });
  });

  it('leaves an event with no organiser alone', () => {
    expect(hostFields(null, null, null)).toEqual({
      hostId: null,
      hostEmail: null,
      hostName: null,
    });
  });
});
