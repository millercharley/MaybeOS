'use client';

import { use } from 'react';
import { DoorList } from '@/components/events/door-list';

/** An organiser's copy: the door, plus who paid and refunding them. */
export default function AdminEventDoorListPage(props: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(props.params);
  return <DoorList eventId={eventId} backHref="/admin/events" showTickets />;
}
