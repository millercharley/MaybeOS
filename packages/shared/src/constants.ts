// ─── Domain Event Names ──────────────────────────────────────

export const DomainEvents = {
  // Org
  ORG_CREATED: 'org.created',
  ORG_UPDATED: 'org.updated',

  // Members
  MEMBER_JOINED: 'member.joined',
  MEMBER_LEFT: 'member.left',
  MEMBER_ROLE_CHANGED: 'member.role_changed',

  // Subscriptions
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_CANCELED: 'subscription.canceled',
  SUBSCRIPTION_PAST_DUE: 'subscription.past_due',
  SUBSCRIPTION_RENEWED: 'subscription.renewed',

  // Events
  EVENT_PUBLISHED: 'event.published',
  EVENT_CANCELED: 'event.canceled',
  RSVP_CREATED: 'rsvp.created',
  RSVP_CANCELED: 'rsvp.canceled',

  // Bookings
  BOOKING_CREATED: 'booking.created',
  BOOKING_APPROVED: 'booking.approved',
  BOOKING_REJECTED: 'booking.rejected',
  BOOKING_CANCELED: 'booking.canceled',

  // Commons
  POST_CREATED: 'post.created',
  PROPOSAL_OPENED: 'proposal.opened',
  PROPOSAL_CLOSED: 'proposal.closed',
  VOTE_CAST: 'vote.cast',

  // Impact
  SURVEY_PUBLISHED: 'survey.published',
  SURVEY_SUBMITTED: 'survey.submitted',
} as const;

// ─── Subscription Plans ──────────────────────────────────────

export const BILLING_INTERVALS = ['month', 'year'] as const;

export const GRACE_PERIOD_DAYS = 7;

export const MAX_RETRY_ATTEMPTS = 3;

// ─── Booking Defaults ────────────────────────────────────────

export const DEFAULT_BUFFER_MINUTES = 15;
export const MAX_BOOKING_HOURS = 8;
export const MIN_BOOKING_MINUTES = 30;

// ─── Survey Categories ──────────────────────────────────────

export const IMPACT_CATEGORIES = [
  'belonging',
  'loneliness',
  'network_size',
  'participation',
  'civic_engagement',
] as const;
