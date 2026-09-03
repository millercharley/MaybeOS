import { eventDescription, eventSummary } from '../event-content';

/**
 * What a booking says on the room's Google Calendar (SPC-21).
 *
 * It said "Attic" against a three-hour block, because the booking screen sent
 * the room's own name as the title. The calendar is where a co-op actually
 * looks, and often the only place someone not in MaybeOS looks at all.
 */
describe('eventSummary', () => {
  const room = { name: 'Attic', address: '1425 Story Ave' };

  it('leads with who booked it', () => {
    // A calendar full of "Attic" tells you the Attic is busy, which the block
    // already said.
    expect(
      eventSummary({ title: 'Working Craft Mtg', memberName: 'Stephanie Collins' }, room),
    ).toBe('Stephanie Collins · Working Craft Mtg · Attic');
  });

  it('does not repeat the room when the title is the room', () => {
    // Every booking made before SPC-21 has the room's name as its title.
    expect(eventSummary({ title: 'Attic', memberName: 'Charles Miller' }, room)).toBe(
      'Charles Miller · Attic',
    );
  });

  it('ignores case when deciding that', () => {
    expect(eventSummary({ title: 'attic', memberName: 'Charles Miller' }, room)).toBe(
      'Charles Miller · Attic',
    );
  });

  it('still says something without a name', () => {
    expect(eventSummary({ title: 'Rehearsal' }, room)).toBe('Rehearsal · Attic');
  });

  it('falls back to the room when there is no title at all', () => {
    expect(eventSummary({ title: '' }, room)).toBe('Attic');
  });
});

describe('eventDescription', () => {
  const room = { name: 'Attic', address: '1425 Story Ave' };

  const full = {
    title: 'Working Craft Mtg',
    description: 'Getting ready for an upcoming event. Team meeting, mixer, and craft day.',
    memberName: 'Stephanie Collins',
    visibility: 'PRIVATE' as const,
    expectedAttendance: 15,
    hasCost: false,
    categories: ['Art or expression', 'Organising'],
  };

  it('carries everything the booking was asked', () => {
    const text = eventDescription(full, room, {
      bookings: 'https://maybeos.org/member/mif/bookings',
    });

    expect(text).toContain('Attic, 1425 Story Ave');
    expect(text).toContain('Stephanie Collins');
    expect(text).toContain('Working Craft Mtg');
    expect(text).toContain('Team meeting, mixer, and craft day.');
    expect(text).toContain('Private to their guests');
    expect(text).toContain('About 15 people');
    expect(text).toContain('Art or expression, Organising');
    expect(text).toContain('https://maybeos.org/member/mif/bookings');
  });

  it('says nothing about cost when there is none', () => {
    // "Cost to attend: No" on every entry is noise that trains people to stop
    // reading the description.
    expect(eventDescription(full, room)).not.toContain('Cost');
  });

  it('says so when there is a cost', () => {
    expect(eventDescription({ ...full, hasCost: true }, room)).toContain('Cost to attend');
  });

  it('reads properly for one person', () => {
    expect(eventDescription({ ...full, expectedAttendance: 1 }, room)).toContain(
      'About 1 person',
    );
  });

  it('marks a booking still waiting on an organiser', () => {
    // The calendar shows it because the slot is held; an organiser reading it
    // needs to know it is not agreed yet.
    expect(eventDescription({ ...full, needsApproval: true }, room)).toContain(
      'Waiting on an organiser',
    );
  });

  it('renders a booking made before any of this was asked', () => {
    // Title is the room's name, everything else absent. Must still be a thing
    // a person can read rather than a wall of empty labels.
    const text = eventDescription({ title: 'Attic' }, { name: 'Attic' });

    expect(text).toContain('Room\nAttic');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
    expect(text.trim()).toContain('Booked through MaybeOS.');
  });

  it('leaves out the title when it is only the room name again', () => {
    const text = eventDescription({ title: 'Attic', memberName: 'Maya' }, room);

    expect(text).not.toContain('What\nAttic');
  });

  it('does not publish the member\'s email address', () => {
    // It goes on the event as an attendee, where Google scopes it. Pasting it
    // into the description would put it in the body of a calendar a co-op may
    // well embed on its own website.
    const text = eventDescription(
      { ...full, memberEmail: 'stephanie@example.org' },
      room,
      { bookings: 'https://maybeos.org/member/mif/bookings' },
    );

    expect(text).not.toContain('stephanie@example.org');
  });
});
