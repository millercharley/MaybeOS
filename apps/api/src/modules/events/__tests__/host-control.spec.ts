import { canManageHosts, coHostProblem, NOT_YOURS } from '../host-control';

/**
 * Who may decide who runs an event (EVT-32).
 *
 * Charley: "The admin needs the ability to switch the host and add co-hosts.
 * Make sure the member who created the event also has the ability."
 *
 * The creator is the one that needed writing down. The host starts as
 * whoever made the event and can be handed on, so without it an organiser
 * creating an event on a member's behalf — the case `hostId` exists for —
 * lost any claim on it the moment they set the host.
 */

const event = (over: { hostId?: string | null; createdById?: string | null } = {}) => ({
  hostId: 'u-host',
  createdById: 'u-creator',
  ...over,
});

describe('who may change who runs an event', () => {
  it('an organiser, for any event', () => {
    expect(canManageHosts(event(), 'u-nobody', true)).toBe(true);
  });

  it('the host, because it is theirs', () => {
    expect(canManageHosts(event(), 'u-host', false)).toBe(true);
  });

  it('whoever created it, even after handing it on', () => {
    // An organiser makes an event for a member and sets them as host. They
    // must still be able to fix the date.
    expect(canManageHosts(event({ hostId: 'u-someone-else' }), 'u-creator', false)).toBe(true);
  });

  it('nobody else', () => {
    expect(canManageHosts(event(), 'u-stranger', false)).toBe(false);
  });

  it('not a co-host — that is not what being asked to help means', () => {
    // Co-hosts are not consulted here at all: being asked to help run an
    // evening is not the power to hand it to somebody else, or to remove the
    // person who asked you.
    expect(canManageHosts(event(), 'u-co-host', false)).toBe(false);
  });

  it('is not fooled by an event with no host or creator', () => {
    // Every event imported from a calendar, and every one made before EVT-04.
    expect(canManageHosts({ hostId: null, createdById: null }, 'u-anyone', false)).toBe(false);
    expect(canManageHosts({ hostId: null, createdById: null }, 'u-anyone', true)).toBe(true);
  });

  it('says who can, rather than only saying no', () => {
    expect(NOT_YOURS).toMatch(/organiser, the host, or whoever created/);
  });
});

describe('who may be added as a co-host', () => {
  it('somebody who is neither already', () => {
    expect(coHostProblem(event(), 'u-new', [])).toBeNull();
  });

  it('not the host — the list would read "hosted by Ada, with Ada"', () => {
    expect(coHostProblem(event(), 'u-host', [])).toMatch(/already the host/);
  });

  it('not somebody already on it', () => {
    // The unique index would refuse it anyway; this is the sentence instead
    // of a constraint violation.
    expect(coHostProblem(event(), 'u-two', ['u-one', 'u-two'])).toMatch(/already a co-host/);
  });
});
