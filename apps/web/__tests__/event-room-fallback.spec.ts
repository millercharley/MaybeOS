import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Saying where an event is when MaybeOS has the reservation wrong (SPC-33).
 *
 * Charley: "A member at MaybeItsFate that booked their room pre-MaybeOS
 * cannot create an Event because the room reservation isn't listed… Make
 * sure that a member can post their event even when there's a missing room
 * reservation."
 *
 * Brooke Sullivan Brown held the Attic and the Library on 24 October. Both
 * reservations were in MaybeOS, both filed under the person who typed them
 * into Google rather than the person they were for — so the picker offered
 * her nothing, told her to book rooms she already had, and the co-op's
 * "every event says which room" setting then refused to publish.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (...p: string[]) => strip(readFileSync(join(__dirname, '..', ...p), 'utf8'));

const form = read('components', 'events', 'event-form.tsx');
const picker = read('components', 'events', 'room-picker.tsx');

describe('naming the room', () => {
  it('is offered when nothing can be attached', () => {
    expect(form).toMatch(/\{rooms\.length === 0 && \(/);
    expect(form).toMatch(/name the room, if it is arranged outside MaybeOS/);
  });

  it('is not offered once a reservation is attached', () => {
    // A reservation says which room and more. Two answers that could
    // disagree is one too many.
    const at = form.indexOf('Or name the room');
    const guard = form.slice(Math.max(0, at - 400), at);
    expect(guard).toMatch(/rooms\.length === 0/);
  });

  it('is sent, which it never used to be', () => {
    // `roomId` has been on the create payload since the beginning and the
    // form never set it — the whole room question was reservations only.
    expect(form).toMatch(/roomId: rooms\.length === 0 && roomId \? roomId : null/);
  });

  it('does not claim to reserve anything', () => {
    // It says where the event is. An organiser can see it holds no
    // reservation and sort that out.
    expect(form).toMatch(/It does not reserve the room/);
  });

  it('loads the room list only when it might be needed', () => {
    expect(form).toMatch(/rooms\.length > 0 \|\| roomOptions\.length > 0\) return;/);
  });
});

describe('the empty picker', () => {
  it('no longer tells somebody to book a room they already have', () => {
    /*
      "You have no room bookings near this date. Book the room first and it
      will appear here" was a dead end for exactly the member most likely to
      read it: 26 upcoming reservations were filed under the wrong person.
    */
    expect(picker).not.toMatch(/Book the room first/);
    expect(picker).toMatch(/If the room is already arranged, say which one below/);
  });
});
