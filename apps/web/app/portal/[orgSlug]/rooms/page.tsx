'use client';

import { useState, useEffect } from 'react';
import { DoorOpen, Users, Check } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';

export default function PortalRoomsPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);

  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [booking, setBooking] = useState(false);
  const [bookingResult, setBookingResult] = useState<string | null>(null);

  useEffect(() => {
    if (!org || !token) {
      setLoading(false);
      return;
    }
    api.rooms
      .list(org.id, token)
      .then(setRooms)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [org, token]);

  async function handleBook() {
    if (!org || !token || !selectedRoom || !title || !date || !startTime || !endTime) return;
    setBooking(true);
    setBookingResult(null);
    try {
      await api.rooms.createBooking(
        org.id,
        selectedRoom,
        {
          title,
          startTime: new Date(`${date}T${startTime}`).toISOString(),
          endTime: new Date(`${date}T${endTime}`).toISOString(),
        },
        token,
      );
      setBookingResult('Booking submitted!');
      setTitle('');
      setDate('');
      setStartTime('');
      setEndTime('');
      setSelectedRoom(null);
    } catch (err: unknown) {
      setBookingResult(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setBooking(false);
    }
  }

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

      {selectedRoom && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Book This Room</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Booking Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Team Meeting"
                className="input w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Start</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">End</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="input w-full"
                />
              </div>
            </div>
          </div>
          <button
            onClick={handleBook}
            disabled={booking || !title || !date || !startTime || !endTime}
            className="btn-primary mt-4"
          >
            {booking ? 'Booking...' : 'Submit Booking'}
          </button>
        </div>
      )}
    </div>
  );
}
