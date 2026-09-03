'use client';

import { useState, useEffect } from 'react';
import { DoorOpen, Users, Check } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { RoomBooking } from '@/components/rooms/room-booking';
import { api } from '@/lib/api';

export default function PortalRoomsPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);

  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [bookingResult, setBookingResult] = useState<string | null>(null);

  const orgId = org?.id;
  const selected = rooms.find((r) => r.id === selectedRoom) ?? null;

  useEffect(() => {
    if (!org || !token) {
      setLoading(false);
      return;
    }
    api.rooms
      .list(org.id, token)
      .then(setRooms)
      // Was `catch(() => {})`: the page showed "no rooms" whether the co-op
      // had none or the request had failed, which are different problems.
      .catch((err) =>
        setBookingResult(err instanceof Error ? err.message : 'Could not load the rooms'),
      )
      .finally(() => setLoading(false));
  }, [org, token]);


  if (!token) {
    return (
      <div className="py-12 text-center">
        <DoorOpen className="mx-auto h-10 w-10 text-gray-300" />
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Rooms & Booking</h1>
        <p className="mt-2 text-sm text-gray-500">Sign in to view and book rooms.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Rooms & Booking</h1>

      {bookingResult && (
        <div
          className={`rounded-lg p-3 text-sm ${bookingResult.includes('submitted') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
        >
          {bookingResult}
        </div>
      )}

      {rooms.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">No rooms available yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => setSelectedRoom(selectedRoom === room.id ? null : room.id)}
              className={`rounded-xl border p-5 text-left transition-colors ${
                selectedRoom === room.id
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-gray-200 bg-white hover:border-brand-300'
              }`}
            >
              {/* The photo, always with the room (SPC-16). A member choosing
                  between "Attic" and "Meeting Room A" is choosing between two
                  physical spaces, and the names alone do not describe them. */}
              {room.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={room.imageUrl}
                  alt=""
                  className="mb-3 h-32 w-full rounded-lg object-cover"
                />
              )}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{room.name}</h3>
                  {room.description && (
                    <p className="mt-1 text-xs text-gray-500">{room.description}</p>
                  )}
                </div>
                {selectedRoom === room.id && <Check className="h-5 w-5 text-brand-600" />}
              </div>
              <div className="mt-3 flex gap-3 text-xs text-gray-400">
                {room.capacity && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    Up to {room.capacity}
                  </span>
                )}
                {room.requiresApproval && (
                  <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-yellow-700">
                    Requires approval
                  </span>
                )}
                {/*
                  What it costs, before choosing it rather than at the Stripe
                  page (SPC-06). Finding out a room is paid only once you have
                  filled in the form is how people abandon a booking.
                */}
                {room.chargeForBooking && room.hourlyRate ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
                    ${(room.hourlyRate / 100).toFixed(2)}/hour
                  </span>
                ) : (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700">
                    Free
                  </span>
                )}
              </div>
              {room.amenities?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {room.amenities.map((a: string) => (
                    <span key={a} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {a}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/*
        The date-and-two-times form this replaced could only refuse after the
        fact: a member picked a start and an end, submitted, and was told the
        room was shut or taken — which says their choice was wrong once they
        have made it, and nothing about which choice would have worked
        (SPC-15).
      */}
      {selected && token && orgId && (
        <RoomBooking
          room={selected}
          orgId={orgId}
          token={token}
          onBooked={() => setBookingResult('Booked.')}
        />
      )}

    </div>
  );
}
