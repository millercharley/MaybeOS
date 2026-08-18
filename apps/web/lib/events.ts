import type { EventFormValues } from '@/components/events/event-form';

/**
 * What may be sent to `PATCH /orgs/:orgId/events/:eventId`.
 *
 * The event form is shared between creating and editing, but the two
 * endpoints do not take the same body: `publish` exists on `CreateEventDto`
 * and not on `UpdateEventDto`, and the API validates with a whitelist. So
 * editing an event failed outright with `property publish should not exist`
 * — not a rejected field, a rejected request. Nothing saved.
 *
 * Publishing is a separate endpoint on purpose: going live is a distinct act
 * from correcting a date, and conflating them means an edit could broadcast a
 * half-written event. Callers that want both do both, in that order.
 */
export function toUpdatePayload(
  values: EventFormValues,
): Omit<EventFormValues, 'publish'> {
  const { publish: _publish, ...changes } = values;
  return changes;
}
