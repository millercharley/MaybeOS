'use client';

import { use } from 'react';
import { DoorList } from '@/components/events/door-list';

/** An organiser's copy: everything about the event, the door, and who paid. */
export default function AdminEventDoorListPage(props: {
  params: Promise<{ eventId: string; orgSlug: string }>;
}) {
  const { eventId, orgSlug } = use(props.params);
  return (
    <DoorList
      eventId={eventId}
      backHref={`/admin/${orgSlug}/events`}
      showTickets
      overviewFor={orgSlug}
    />
  );
}
