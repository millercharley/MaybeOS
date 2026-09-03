/**
 * Whether to offer publishing a booking as an event, and how to ask (EVT-17).
 *
 * The question is not the same one every time. A member who booked the Attic
 * for their own guests is being asked something different from a member who
 * booked it for anyone who turns up, and "Publish as event" asked flatly is a
 * button most people will not press because it does not say what it does.
 *
 * Pure, because the wording *is* the feature and it should be readable in one
 * place rather than reconstructed from three ternaries in a component.
 */
export type Visibility = 'PUBLIC' | 'MEMBERS_ONLY' | 'PRIVATE';

export interface PublishPrompt {
  /** The heading, as a question. */
  question: string;
  /** What pressing it does, in a sentence. */
  detail: string;
  /** The button. */
  action: string;
}

/**
 * Null for a private booking.
 *
 * Somebody who said "just my guests" has already answered this question, and
 * offering to publish it anyway is asking them to say no to a thing they never
 * asked for — on the screen that just confirmed their booking.
 */
export function publishPrompt(visibility: Visibility | null | undefined): PublishPrompt | null {
  switch (visibility) {
    case 'MEMBERS_ONLY':
      return {
        question: 'Publish this to the event list for members?',
        detail:
          'Members will see it on the events page and can RSVP. It stays off the public site.',
        action: 'Publish to members',
      };
    case 'PUBLIC':
      return {
        question: 'Publish this to the event list for the public?',
        detail:
          'Anyone can see it, including people outside the co-op, and the link can be shared.',
        action: 'Publish publicly',
      };
    default:
      return null;
  }
}

/** What the event list will show, once published. */
export function publishedNotice(visibility: Visibility): string {
  return visibility === 'PUBLIC'
    ? 'Your event is live and anyone can see it. It will be called off automatically if you cancel this booking.'
    : 'Your event is live for members. It will be called off automatically if you cancel this booking.';
}
