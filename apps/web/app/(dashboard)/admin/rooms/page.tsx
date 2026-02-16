'use client';

import { Plus, Users, CheckCircle, XCircle, Clock, Shield, Wifi, Monitor, Coffee } from 'lucide-react';

interface Room {
  id: string;
  name: string;
  capacity: number;
  amenities: string[];
  approvalRequired: boolean;
  upcomingBookings: number;
}

interface Booking {
  id: string;
  room: string;
  requestedBy: string;
  date: string;
  time: string;
  purpose: string;
  status: 'PENDING';
}

const rooms: Room[] = [
  {
    id: '1',
    name: 'Main Hall',
    capacity: 100,
    amenities: ['Projector', 'Sound System', 'Stage', 'Wi-Fi'],
    approvalRequired: true,
    upcomingBookings: 3,
  },
  {
    id: '2',
    name: 'Conference Room A',
    capacity: 12,
    amenities: ['TV Screen', 'Whiteboard', 'Wi-Fi', 'Video Conferencing'],
    approvalRequired: false,
    upcomingBookings: 5,
  },
  {
    id: '3',
    name: 'Studio A',
    capacity: 30,
    amenities: ['Projector', 'Wi-Fi', 'Coffee Machine'],
    approvalRequired: true,
    upcomingBookings: 2,
  },
  {
    id: '4',
    name: 'Quiet Room',
    capacity: 6,
    amenities: ['Wi-Fi', 'Standing Desks'],
    approvalRequired: false,
    upcomingBookings: 1,
  },
];

const pendingBookings: Booking[] = [
  {
    id: 'b1',
    room: 'Main Hall',
    requestedBy: 'Sarah Chen',
    date: 'Feb 22, 2026',
    time: '10:00 AM - 2:00 PM',
    purpose: 'Community Workshop',
    status: 'PENDING',
  },
  {
    id: 'b2',
    room: 'Studio A',
    requestedBy: 'Marcus Johnson',
    date: 'Feb 24, 2026',
    time: '3:00 PM - 5:00 PM',
    purpose: 'Art Exhibition Setup',
    status: 'PENDING',
  },
  {
    id: 'b3',
    room: 'Main Hall',
    requestedBy: 'Priya Patel',
    date: 'Mar 1, 2026',
    time: '6:00 PM - 10:00 PM',
    purpose: 'Fundraiser Event',
    status: 'PENDING',
  },
];

const amenityIcon: Record<string, typeof Wifi> = {
  'Wi-Fi': Wifi,
  'Projector': Monitor,
  'TV Screen': Monitor,
  'Coffee Machine': Coffee,
};

export default function RoomsPage() {
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
        {rooms.map((room) => (
          <div key={room.id} className="card">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{room.name}</h3>
                <div className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                  <Users className="h-4 w-4" />
                  <span>Capacity: {room.capacity}</span>
                </div>
              </div>
              {room.approvalRequired && (
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
                {room.upcomingBookings} upcoming booking{room.upcomingBookings !== 1 ? 's' : ''}
              </span>
              <button className="text-sm font-medium text-brand-600 hover:text-brand-700">
                Manage
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pending Bookings */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Pending Bookings</h2>
        <div className="card overflow-hidden !p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Room
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Requested By
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Date & Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Purpose
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {pendingBookings.map((booking) => (
                <tr key={booking.id} className="hover:bg-gray-50 transition-colors">
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                    {booking.room}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {booking.requestedBy}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    <div>{booking.date}</div>
                    <div className="text-xs text-gray-400">{booking.time}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{booking.purpose}</td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                      <Clock className="h-3 w-3" />
                      Pending
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="inline-flex items-center gap-1 rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100">
                        <CheckCircle className="h-3.5 w-3.5" />
                        Approve
                      </button>
                      <button className="inline-flex items-center gap-1 rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
                        <XCircle className="h-3.5 w-3.5" />
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
