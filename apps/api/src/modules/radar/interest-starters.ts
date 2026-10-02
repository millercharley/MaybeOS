/**
 * The interests a co-op starts with (RDR-01).
 *
 * Charley's call: MaybeOS ships a starter list and the co-op edits it. A blank
 * list would be the most accurate thing MaybeOS could offer and the least
 * useful — an admin facing an empty box before Radar can do anything is an
 * admin who turns it on next month.
 *
 * **The first six are the gathering kinds EVT-20 already hard-coded into the
 * event and booking forms.** They are here, first and in the same words, so
 * that every event tagged before Radar existed still means something to it.
 * Change these and you are changing what those events say they are.
 *
 * The rest are the ordinary business of a community space. They are a guess —
 * a good one, and still a guess — which is exactly why an admin can rename,
 * reorder, deactivate and add to them.
 */
export interface StarterInterest {
  name: string;
  emoji: string;
}

export const STARTER_INTERESTS: readonly StarterInterest[] = [
  // The six from EVT-20. Do not reword without rewording the forms.
  { name: 'Art or expression', emoji: '🎨' },
  { name: 'Organizing or meetings', emoji: '🗳️' },
  { name: 'Social', emoji: '🫂' },
  { name: 'Learning', emoji: '📚' },
  { name: 'Rehearsal or practice', emoji: '🎭' },
  { name: 'Care or support', emoji: '🤝' },
  // The rest, offered because most co-ops run them under some name.
  { name: 'Music', emoji: '🎵' },
  { name: 'Food and cooking', emoji: '🍲' },
  { name: 'Games', emoji: '🎲' },
  { name: 'Outdoors', emoji: '🌳' },
  { name: 'Film and performance', emoji: '🎬' },
  { name: 'Making and repair', emoji: '🔧' },
  { name: 'Books and writing', emoji: '✍️' },
  { name: 'Wellbeing and movement', emoji: '🧘' },
  { name: 'Family and kids', emoji: '🧸' },
  { name: 'Volunteering', emoji: '🧹' },
] as const;
