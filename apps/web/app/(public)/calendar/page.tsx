'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

type CalendarEvent = {
  id: string;
  title: string;
  date: number;
  color: string;
  time: string;
};

const marchEvents: CalendarEvent[] = [
  { id: '1', title: 'Community Potluck', date: 1, color: 'bg-orange-500', time: '6:00 PM' },
  { id: '2', title: 'Board Meeting', date: 3, color: 'bg-purple-500', time: '7:00 PM' },
  { id: '3', title: 'Yoga in the Park', date: 5, color: 'bg-green-500', time: '9:00 AM' },
  { id: '4', title: 'New Member Orientation', date: 7, color: 'bg-blue-500', time: '5:00 PM' },
  { id: '5', title: 'Co-op Economics Workshop', date: 8, color: 'bg-yellow-500', time: '2:00 PM' },
  { id: '6', title: 'Monthly Social', date: 14, color: 'bg-pink-500', time: '7:00 PM' },
  { id: '7', title: 'Open Mic Night', date: 21, color: 'bg-indigo-500', time: '8:00 PM' },
  { id: '8', title: 'Garden Workday', date: 22, color: 'bg-emerald-500', time: '10:00 AM' },
];

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(2); // March (0-indexed)
  const [currentYear, setCurrentYear] = useState(2025);
  const [selectedDate, setSelectedDate] = useState<number | null>(null);

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  // Build calendar grid cells
  const calendarCells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) {
    calendarCells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push(d);
  }

  const eventsForMonth = currentMonth === 2 && currentYear === 2025 ? marchEvents : [];

  const getEventsForDate = (date: number) => {
    return eventsForMonth.filter((e) => e.date === date);
  };

  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];

  const goToPreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
    setSelectedDate(null);
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
    setSelectedDate(null);
  };

  return (
    <div className="mx-auto max-w-container px-4 py-12 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Event Calendar</h1>
          <p className="mt-1 text-sm text-gray-500">
            Browse upcoming community events by date.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousMonth}
            className="rounded-lg border border-gray-300 bg-white p-2 text-gray-600 hover:bg-gray-50 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[160px] text-center text-lg font-semibold text-gray-900">
            {MONTH_NAMES[currentMonth]} {currentYear}
          </span>
          <button
            onClick={goToNextMonth}
            className="rounded-lg border border-gray-300 bg-white p-2 text-gray-600 hover:bg-gray-50 transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {DAYS_OF_WEEK.map((day) => (
            <div
              key={day}
              className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar days */}
        <div className="grid grid-cols-7">
          {calendarCells.map((date, index) => {
            const dayEvents = date ? getEventsForDate(date) : [];
            const isSelected = date === selectedDate;

            return (
              <button
                key={index}
                onClick={() => date && setSelectedDate(date)}
                disabled={!date}
                className={`relative min-h-[80px] border-b border-r border-gray-100 p-2 text-left transition-colors ${
                  date ? 'hover:bg-brand-50 cursor-pointer' : 'bg-gray-50/50'
                } ${isSelected ? 'bg-brand-50 ring-2 ring-inset ring-brand-600' : ''}`}
              >
                {date && (
                  <>
                    <span
                      className={`text-sm font-medium ${
                        isSelected ? 'text-brand-700' : 'text-gray-900'
                      }`}
                    >
                      {date}
                    </span>
                    {/* Event dots/pills */}
                    <div className="mt-1 space-y-1">
                      {dayEvents.slice(0, 2).map((event) => (
                        <div
                          key={event.id}
                          className={`${event.color} truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white`}
                        >
                          {event.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <span className="text-[10px] font-medium text-gray-500">
                          +{dayEvents.length - 2} more
                        </span>
                      )}
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Date Events */}
      {selectedDate && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Events on {MONTH_NAMES[currentMonth]} {selectedDate}, {currentYear}
          </h2>

          {selectedEvents.length > 0 ? (
            <div className="mt-4 space-y-3">
              {selectedEvents.map((event) => (
                <div
                  key={event.id}
                  className="card flex items-center gap-4 rounded-lg border border-gray-200"
                >
                  <div className={`h-10 w-10 rounded-lg ${event.color} flex items-center justify-center`}>
                    <Calendar className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{event.title}</p>
                    <p className="text-sm text-gray-500">{event.time}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500">No events scheduled for this date.</p>
          )}
        </div>
      )}

      {/* Embed Note */}
      <div className="mt-8 rounded-lg bg-gray-50 border border-gray-200 p-4">
        <p className="text-xs text-gray-500 text-center">
          This calendar is designed to be embeddable via iframe on external websites.
        </p>
      </div>
    </div>
  );
}
