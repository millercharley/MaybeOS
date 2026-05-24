'use client';

import { Plus, Users, Shield, Wifi, Monitor, Coffee } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

const amenityIcon: Record<string, typeof Wifi> = {
  'Wi-Fi': Wifi,
  'Projector': Monitor,
  'TV Screen': Monitor,
  'Coffee Machine': Coffee,
};

export default function RoomsPage() {
  const { data: rooms, loading, error } = useApi(
    (token, orgId) => api.rooms.list(orgId, token),
    [],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        Failed to load rooms: {error}
      </div>
    );
  }

  const roomList = rooms ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Rooms & Booking</h1>
        <button className="btn-primary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Room
        </button>
      </div>

      {/* Rooms Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {roomList.map((room) => (
          <div key={room.id} className="card">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{room.name}</h3>
                <div className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                  <Users className="h-4 w-4" />
                  <span>Capacity: {room.capacity ?? 'N/A'}</span>
                </div>
              </div>
              {room.requiresApproval && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  <Shield className="h-3 w-3" />
                  Approval Required
                </span>
              )}
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {room.amenities.map((amenity) => {
                const Icon = amenityIcon[amenity];
                return (
                  <span
                    key={amenity}
                    className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600"
                  >
                    {Icon && <Icon className="h-3 w-3" />}
                    {amenity}
                  </span>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 pt-3">
              <span className="text-sm text-gray-500">
                {room.memberOnly ? 'Members only' : 'Open to all'}
              </span>
              <button className="text-sm font-medium text-brand-600 hover:text-brand-700">
                Manage
              </button>
            </div>
          </div>
        ))}

        {roomList.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-gray-500">
            No rooms found. Create one to get started.
          </div>
        )}
      </div>

      {/* Pending Bookings - placeholder until a dedicated pending bookings endpoint is available */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Pending Bookings</h2>
        {/* TODO: Pending bookings require a dedicated API endpoint (e.g. listing bookings across all rooms filtered by status).
            Currently, individual room bookings can be fetched via api.rooms.listBookings(orgId, roomId, token)
            but there is no aggregate pending bookings endpoint. */}
        <div className="card">
          <div className="py-8 text-center text-sm text-gray-500">
            Pending bookings view coming soon. Use the individual room &quot;Manage&quot; button to view bookings per room.
          </div>
        </div>
      </div>
    </div>
  );
}
