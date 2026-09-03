import {
  formatMinutes,
  recurrenceLabel,
  coverage,
  listNames,
  byDate,
  standingSentence,
  shortDate,
} from '@/lib/service-rota';
import type { DutyOccurrence, ServiceStanding } from '@/lib/api';

/**
 * How the rota reads (SRV-01).
 *
 * Most of the judgement in Serve is in the wording. A rota that tells a member
 * with three weeks left in the month that they are "behind" is a rota people
 * stop opening, and the difference between that and "2h to go" is entirely in
 * this file.
 */
const occurrence = (over: Partial<DutyOccurrence> = {}): DutyOccurrence => ({
  dutyId: 'duty-1',
  title: 'Take the bins out',
  description: null,
  estimatedMinutes: 30,
  capacity: 1,
  requiresApproval: false,
  recurrence: 'WEEKLY',
  date: '2026-09-08',
  occursAt: '2026-09-08T12:00:00.000Z',
  remaining: 1,
  claims: [],
  ...over,
});

describe('formatMinutes', () => {
  it('says minutes under the hour', () => {
    expect(formatMinutes(45)).toBe('45m');
  });

  it('says hours once there is an hour', () => {
    // A co-op says "two hours on Saturday", never "a hundred and twenty
    // minutes on Saturday".
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(90)).toBe('1h 30m');
  });

  it('does not render nothing as an empty string', () => {
    expect(formatMinutes(0)).toBe('0m');
  });
});

describe('shortDate', () => {
  it('formats a local date without shifting it', () => {
    // Formatted in UTC on purpose: the date is already local, and passing it
    // through a timezone again is how "Tue 8th" becomes "Mon 7th".
    expect(shortDate('2026-09-08')).toBe('Tue, Sep 8');
  });
});

describe('recurrenceLabel', () => {
  it('names the weekday of a weekly duty', () => {
    expect(recurrenceLabel('WEEKLY', '2026-09-08')).toBe('Every Tuesday');
  });

  it('names a fortnightly duty as every other', () => {
    expect(recurrenceLabel('BIWEEKLY', '2026-09-08')).toBe('Every other Tuesday');
  });

  it('falls back without a date rather than guessing a weekday', () => {
    expect(recurrenceLabel('WEEKLY')).toBe('Weekly');
  });

  it('calls a one-off a one-off', () => {
    expect(recurrenceLabel('NONE', '2026-09-08')).toBe('One-off');
  });
});

describe('coverage', () => {
  it('tells a member when the turn is theirs', () => {
    const mine = occurrence({
      remaining: 0,
      claims: [{ id: 'c1', userId: 'me', name: 'Maya Chen', avatarUrl: null, status: 'CONFIRMED' }],
    });
    expect(coverage(mine, 'me')).toEqual({ label: "You're on this", tone: 'mine' });
  });

  it('says done rather than "you\'re on this" for a turn already served', () => {
    // "You're on this" reads as something still owed, and it is the one status
    // a member might act on twice.
    const served = occurrence({
      remaining: 0,
      claims: [{ id: 'c1', userId: 'me', name: 'Maya', avatarUrl: null, status: 'DONE' }],
    });
    expect(coverage(served, 'me')).toEqual({ label: 'Done', tone: 'mine' });
  });

  it('distinguishes theirs from theirs-pending-approval', () => {
    // Otherwise a member on a gated duty thinks they have it and does not
    // turn up to be told they never did.
    const waiting = occurrence({
      remaining: 0,
      claims: [{ id: 'c1', userId: 'me', name: 'Maya', avatarUrl: null, status: 'CLAIMED' }],
    });
    expect(coverage(waiting, 'me').tone).toBe('pending');
  });

  it('names who has it when somebody else does', () => {
    const taken = occurrence({
      remaining: 0,
      claims: [{ id: 'c1', userId: 'other', name: 'Alex Thompson', avatarUrl: null, status: 'CONFIRMED' }],
    });
    expect(coverage(taken, 'me')).toEqual({ label: 'Covered by Alex', tone: 'covered' });
  });

  it('says nobody yet for an uncovered single-person turn', () => {
    // Not "0 of 1": a fraction is a status report, and the person reading it
    // is deciding whether to volunteer.
    expect(coverage(occurrence(), 'me')).toEqual({ label: 'Nobody yet', tone: 'open' });
  });

  it('says how many more are needed when a turn takes several', () => {
    const chairs = occurrence({ capacity: 3, remaining: 2 });
    expect(coverage(chairs, 'me')).toEqual({ label: 'Needs 2 more', tone: 'open' });
  });
});

describe('listNames', () => {
  it('joins names the way a person would', () => {
    expect(listNames(['Maya'])).toBe('Maya');
    expect(listNames(['Maya', 'Alex'])).toBe('Maya and Alex');
    expect(listNames(['Maya', 'Alex', 'Sam'])).toBe('Maya, Alex and Sam');
  });
});

describe('byDate', () => {
  it('groups turns by day, in order', () => {
    const groups = byDate([
      occurrence({ date: '2026-09-15' }),
      occurrence({ date: '2026-09-08' }),
      occurrence({ date: '2026-09-08', dutyId: 'duty-2', title: 'Water the plants' }),
    ]);

    expect(groups.map((g) => g.date)).toEqual(['2026-09-08', '2026-09-15']);
    expect(groups[0].occurrences).toHaveLength(2);
  });
});

describe('standingSentence', () => {
  const standing = (over: Partial<ServiceStanding> = {}): ServiceStanding => ({
    period: 'MONTH',
    window: { from: '2026-09-01', to: '2026-09-30' },
    expectedMinutes: 240,
    servedMinutes: 90,
    shortfallMinutes: 150,
    prorated: false,
    ...over,
  });

  it('says what is done and what is left, without calling anybody behind', () => {
    // A member with three weeks of the month still to run is not behind.
    const sentence = standingSentence(standing());
    expect(sentence).toBe('1h 30m of 4h this month. 2h 30m to go.');
    expect(sentence).not.toMatch(/behind|overdue|short/i);
  });

  it('says so when a member is done', () => {
    expect(standingSentence(standing({ servedMinutes: 240, shortfallMinutes: 0 }))).toBe(
      "4h of 4h this month — you're all set.",
    );
  });

  it('reports hours alone when the tier asks for nothing', () => {
    const sentence = standingSentence(
      standing({ expectedMinutes: null, shortfallMinutes: null, servedMinutes: 75 }),
    );
    expect(sentence).toBe('1h 15m served this month.');
    expect(sentence).not.toContain('of');
  });

  it('explains a prorated first window rather than leaving an odd number bare', () => {
    const sentence = standingSentence(
      standing({ expectedMinutes: 112, shortfallMinutes: 112, servedMinutes: 0, prorated: true }),
    );
    expect(sentence).toContain('scaled from the day you joined');
  });
});
