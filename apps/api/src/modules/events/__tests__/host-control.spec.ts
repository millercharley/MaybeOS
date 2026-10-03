import { canEditEvent, canManageHosts, coHostProblem, NOT_YOURS } from '../host-control';

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

/**
 * Who may change the event itself (EVT-33).
 *
 * Charley: "Make sure any host, co-host and admin can edit the title, image,
 * and description… change any detail… add ticketing or manage the ticketing,
 * and review who has bought tickets."
 *
 * Wider than `canManageHosts` by exactly one person. A co-host was asked to
 * help run the evening, so they can correct a time, write the description,
 * set what a ticket costs and see who is coming. What they cannot do is
 * decide who runs it.
 */
describe('who may change an event', () => {
  const withHelpers = (coHostIds: string[]) => ({ ...event(), coHostIds });

  it('an organiser', () => {
    expect(canEditEvent(withHelpers([]), 'u-nobody', true)).toBe(true);
  });

  it('the host', () => {
    expect(canEditEvent(withHelpers([]), 'u-host', false)).toBe(true);
  });

  it('whoever created it', () => {
    expect(canEditEvent({ ...withHelpers([]), hostId: 'u-other' }, 'u-creator', false)).toBe(true);
  });

  it('a co-host', () => {
    expect(canEditEvent(withHelpers(['u-helper']), 'u-helper', false)).toBe(true);
  });

  it('nobody else', () => {
    expect(canEditEvent(withHelpers(['u-helper']), 'u-stranger', false)).toBe(false);
  });

  it('is wider than deciding who runs it, by exactly the co-host', () => {
    // The one case where the two answers differ, and the reason there are
    // two functions rather than one.
    const e = withHelpers(['u-helper']);

    expect(canEditEvent(e, 'u-helper', false)).toBe(true);
    expect(canManageHosts(e, 'u-helper', false)).toBe(false);
  });

  it('survives an event with no co-hosts recorded', () => {
    expect(canEditEvent(event(), 'u-host', false)).toBe(true);
    expect(canEditEvent(event(), 'u-stranger', false)).toBe(false);
  });
});
