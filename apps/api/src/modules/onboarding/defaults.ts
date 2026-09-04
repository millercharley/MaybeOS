import { OnboardingStepKind } from '@prisma/client';

/**
 * What a co-op gets the moment it turns the checklist on (ONB-01).
 *
 * A blank checklist is not a feature — an admin who enables this and is shown
 * an empty list has been given homework, not a tool. These are written to be
 * usable unedited by a co-op that changes nothing, and every one of them is a
 * thing MaybeOS can actually verify, so the list works on day one without
 * anybody configuring detection.
 *
 * They are copied into the co-op's own rows rather than referenced, because
 * the whole point is that the words belong to the co-op. Editing one here does
 * not reach back into a co-op that has already made it theirs.
 */
export const DEFAULT_STEPS: Array<{
  kind: OnboardingStepKind;
  title: string;
  description: string;
  ctaLabel: string;
}> = [
  {
    kind: 'PROFILE',
    title: 'Complete your profile',
    description:
      'Add your name and a line about yourself, so people know who you are when they see you in the directory.',
    ctaLabel: 'Do it now',
  },
  {
    kind: 'HANDBOOK',
    title: 'Read the handbook',
    description:
      'How this community works, in our own words. It takes a few minutes.',
    ctaLabel: 'Open the handbook',
  },
  {
    kind: 'COMMONS_POST',
    title: 'Say hello in the Commons',
    description:
      'Introduce yourself. The first post is the hardest, and nobody minds what it says.',
    ctaLabel: 'Write a post',
  },
  {
    kind: 'EVENT_RSVP',
    title: 'Come to something',
    description:
      'Find something that looks good and say you are coming. That is most of what this is for.',
    ctaLabel: 'Browse events',
  },
  {
    kind: 'SERVICE_CLAIM',
    title: 'Take a turn',
    description:
      'Pick something that needs doing and put your name to it. The co-op runs on turns.',
    ctaLabel: 'See what needs doing',
  },
];

/**
 * Where "Do it now" goes for a built-in step.
 *
 * Resolved from the co-op's slug at read time rather than stored, so a co-op
 * that changes its slug does not end up with five dead buttons — and so these
 * follow the app when a route moves, which `/welcome` becoming `/handbook`
 * already proved is a thing that happens.
 */
export function defaultHref(kind: OnboardingStepKind, slug: string): string | null {
  switch (kind) {
    case 'PROFILE':
      return `/member/${slug}/profile`;
    case 'HANDBOOK':
      return `/portal/${slug}/handbook`;
    case 'COMMONS_POST':
      return `/portal/${slug}/commons`;
    case 'EVENT_RSVP':
      return `/portal/${slug}/events`;
    case 'ROOM_BOOKING':
      return `/portal/${slug}/rooms`;
    case 'SERVICE_CLAIM':
      return `/portal/${slug}/serve`;
    case 'CUSTOM':
      return null;
  }
}
