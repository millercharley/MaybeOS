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
): Omit<EventFormValues, 'publish' | 'host' | 'coHosts'> {
  /*
    `host` and `coHosts` are read by the form and never sent (EVT-36): they
    are how it knows who is already running the event, and the API rejects
    any field it was not told about — "property host should not exist", which
    is how the calendar import's cursor stopped a run (CAL-08). The co-host
    list travels as `coHostIds`.
  */
  const {
    publish: _publish,
    host: _host,
    coHosts: _coHosts,
    // Read by the form, never sent (SPC-27). The rooms travel as
    // `bookingIds`, and `id` is the event's own.
    id: _id,
    rooms: _rooms,
    ...changes
  } = values;
  return changes;
}
