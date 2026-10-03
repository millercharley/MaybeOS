import { readFileSync } from 'fs';
import { join } from 'path';
import { GATHERING_KINDS } from '@/components/rooms/booking-details';
import { doorCost } from '@/lib/event-list';

/**
 * Three fixes to the event form (EVT-34).
 *
 * Charley, editing an imported event: the host field was a `<select>` of
 * every member — "this list is an impossible way to switch the host", and at
 * MaybeItsFate it is 437 options in one dropdown. The gathering kinds had no
 * room for dance. And Tickets offered free or sold-in-advance, while most of
 * a co-op's paid events are neither: "many events have a suggested fee but
 * not hard cost and do not sell tickets in advance."
 */

const form = readFileSync(
  join(__dirname, '..', 'components', 'events', 'event-form.tsx'),
  'utf8',
);

describe('choosing the host', () => {
  it('is a search, not a list of everybody', () => {
    expect(form).toMatch(/<MemberPicker/);
    expect(form).not.toMatch(/hosts\.map\(\(h\) => \(/);
  });

  it('says who it is currently set to', () => {
    // A picker with nothing beside it does not tell you what happens if you
    // leave it alone.
    expect(form).toMatch(/\{hostName \?\? 'You'\}/);
  });

  it('can be put back to you', () => {
    expect(form).toMatch(/Make it me instead/);
  });

  it('does not offer the person who is already the host', () => {
    expect(form).toMatch(/exclude=\{hostId \? \[hostId\] : \[\]\}/);
  });
});

describe('what kind of gathering', () => {
  it('includes dance and movement', () => {
    expect(GATHERING_KINDS).toContain('Dance and movement');
  });

  it('keeps the kinds it had', () => {
    for (const kind of [
      'Art or expression',
      'Organizing or meetings',
      'Social',
      'Learning',
      'Rehearsal or practice',
      'Care or support',
    ]) {
      expect(GATHERING_KINDS).toContain(kind);
    }
  });
});

describe('how an event is paid for', () => {
  it('offers paying at the door as its own answer', () => {
    expect(form).toMatch(/Pay or donate at the door/);
  });

  it('is one question with three answers, not a radio pair and a stray checkbox', () => {
    // The old checkbox asked the same thing three fields below, so an event
    // could be marked free and charged for at once.
    expect(form).not.toMatch(/There&apos;s a cost to attend/);
    expect(form).toMatch(/checked=\{!ticketed && !hasCost\}/);
    expect(form).toMatch(/checked=\{!ticketed && hasCost\}/);
  });

  it('does not collect at the door and in advance at the same time', () => {
    expect(form).toMatch(/setTicketed\(true\);\s*\n\s*\/\/ Sold in advance is not also collected at the door\.\s*\n\s*setHasCost\(false\)/);
  });

  it('asks what they suggest, and lets them not say', () => {
    expect(form).toMatch(/Suggested amount/);
    expect(form).toMatch(/\(optional\)/);
    expect(form).toMatch(/pay what you can.{0,40}with no figure/i);
  });

  it('sends nothing when no figure was given', () => {
    expect(form).toMatch(/suggested\.trim\(\) !== ''/);
  });

  it('only sends it for the answer it belongs to', () => {
    expect(form).toMatch(/!ticketed && hasCost && suggested\.trim\(\)/);
  });
});

describe('what a member is told about paying at the door', () => {
  it('says the amount when the host gave one', () => {
    expect(doorCost({ hasCost: true, suggestedCents: 1000 })).toBe(
      '$10 suggested — pay what you can',
    );
  });

  it('does not write $10.00 when $10 will do', () => {
    expect(doorCost({ hasCost: true, suggestedCents: 1550 })).toBe(
      '$15.50 suggested — pay what you can',
    );
  });

  it('says what it is without a figure', () => {
    // "There is a cost to attend — ask the host" was the sentence written
    // when the product did not know the answer.
    expect(doorCost({ hasCost: true })).toBe('Pay or donate at the door');
    expect(doorCost({ hasCost: true, suggestedCents: 0 })).toBe('Pay or donate at the door');
  });

  it('says nothing about a free event', () => {
    expect(doorCost({ hasCost: false })).toBeNull();
    expect(doorCost({})).toBeNull();
  });

  it('says nothing when a ticket is sold through MaybeOS', () => {
    // That is a price, shown as one. Two money sentences on one card is a
    // reader wondering which applies to them.
    expect(doorCost({ hasCost: true, priceCents: 1500, suggestedCents: 1000 })).toBeNull();
  });
});

/**
 * Naming co-hosts while making the event (EVT-36).
 *
 * They were only on the event's own page, so adding one while creating an
 * event meant saving it, going to find it, and adding them there.
 */
describe('co-hosts on the form', () => {
  it('can be searched for and added', () => {
    expect(form).toMatch(/Anyone else running it\?/);
    expect(form).toMatch(/Search for a co-host…/);
  });

  it('can be taken off again', () => {
    expect(form).toMatch(/current\.filter\(\(c\) => c\.id !== co\.id\)/);
  });

  it('does not offer the host or anybody already added', () => {
    expect(form).toMatch(/exclude=\{\[\.\.\.\(hostId \? \[hostId\] : \[\]\), \.\.\.coHosts\.map/);
  });

  it('sends the whole list, so removing somebody is a save', () => {
    expect(form).toMatch(/coHostIds: coHosts\.map\(\(c\) => c\.id\)/);
  });

  it('starts from whoever is already on the event', () => {
    expect(form).toMatch(/\(initial\?\.coHosts \?\? \[\]\)\.map/);
  });

  it('shows the host’s real name, not a placeholder', () => {
    // `hosts` is a page of members and the current host is often not on it,
    // which is how this read the literal words "Current host".
    expect(form).toMatch(/initial\?\.host\?\.name \?\?/);
    expect(form).not.toMatch(/'Current host'/);
  });
});
