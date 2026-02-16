// ─── Domain Event Payloads ───────────────────────────────────

export interface DomainEvent<T = unknown> {
  type: string;
  orgId: string;
  timestamp: string;
  actorId?: string;
  payload: T;
}

export interface MemberJoinedPayload {
  userId: string;
  tierId: string;
  tierName: string;
}

export interface SubscriptionChangedPayload {
  userId: string;
  stripeSubscriptionId: string;
  status: string;
  tierId: string;
}

export interface EventPublishedPayload {
  eventId: string;
  title: string;
  startTime: string;
  visibility: string;
}

export interface BookingCreatedPayload {
  bookingId: string;
  roomId: string;
  roomName: string;
  userId: string;
  startTime: string;
  endTime: string;
}

export interface SurveySubmittedPayload {
  surveyId: string;
  responseId: string;
  userId?: string;
}
