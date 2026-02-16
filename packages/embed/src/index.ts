/**
 * MaybeOS Calendar Embed Widget
 *
 * Drop-in script that renders a public events calendar for any MaybeOS organization.
 *
 * Usage (script tag):
 *   <div id="maybeos-calendar"></div>
 *   <script
 *     src="https://your-maybeos.app/embed/calendar.js"
 *     data-org="your-org-slug"
 *     data-theme="light"
 *   ></script>
 *
 * Usage (React component):
 *   import { MaybeOSCalendar } from '@maybeos/embed';
 *   <MaybeOSCalendar orgSlug="your-org-slug" apiUrl="https://api.maybeos.app" />
 */

interface CalendarEvent {
  id: string;
  title: string;
  slug: string;
  startTime: string;
  endTime: string;
  description?: string;
  category?: string;
  location?: { name: string; city?: string };
}

interface EmbedConfig {
  orgSlug: string;
  apiUrl: string;
  containerId: string;
  theme: 'light' | 'dark';
}

class MaybeOSCalendarWidget {
  private config: EmbedConfig;
  private events: CalendarEvent[] = [];
  private currentMonth: Date;

  constructor(config: Partial<EmbedConfig>) {
    this.config = {
      orgSlug: config.orgSlug || '',
      apiUrl: config.apiUrl || 'http://localhost:3001',
      containerId: config.containerId || 'maybeos-calendar',
      theme: config.theme || 'light',
    };
    this.currentMonth = new Date();
  }

  async init() {
    await this.fetchEvents();
    this.render();
  }

  private async fetchEvents() {
    try {
      const res = await fetch(
        `${this.config.apiUrl}/api/orgs/${this.config.orgSlug}/events/feed.json`,
      );
      if (res.ok) {
        this.events = await res.json();
      }
    } catch (err) {
      console.error('[MaybeOS Embed] Failed to fetch events:', err);
    }
  }

  private render() {
    const container = document.getElementById(this.config.containerId);
    if (!container) {
      console.error(`[MaybeOS Embed] Container #${this.config.containerId} not found`);
      return;
    }

    const isDark = this.config.theme === 'dark';
    const bg = isDark ? '#1f2937' : '#ffffff';
    const text = isDark ? '#f9fafb' : '#111827';
    const border = isDark ? '#374151' : '#e5e7eb';
    const accent = '#6366f1';

    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    const monthName = this.currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const eventsThisMonth = this.events.filter((e) => {
      const d = new Date(e.startTime);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    let html = `
      <div style="font-family: system-ui, -apple-system, sans-serif; background: ${bg}; color: ${text}; border: 1px solid ${border}; border-radius: 12px; padding: 20px; max-width: 480px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <button id="mos-prev" style="background: none; border: 1px solid ${border}; border-radius: 6px; padding: 4px 12px; cursor: pointer; color: ${text};">&lt;</button>
          <h2 style="margin: 0; font-size: 18px; font-weight: 600;">${monthName}</h2>
          <button id="mos-next" style="background: none; border: 1px solid ${border}; border-radius: 6px; padding: 4px 12px; cursor: pointer; color: ${text};">&gt;</button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; font-size: 12px; margin-bottom: 4px;">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div style="padding: 4px; font-weight: 600; color: ${isDark ? '#9ca3af' : '#6b7280'};">${d}</div>`).join('')}
        </div>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; font-size: 14px;">
    `;

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      html += `<div style="padding: 8px;"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayEvents = eventsThisMonth.filter(
        (e) => new Date(e.startTime).getDate() === day,
      );
      const hasDot = dayEvents.length > 0;
      html += `
        <div style="padding: 6px; border-radius: 6px; position: relative; ${hasDot ? `background: ${accent}11;` : ''}">
          ${day}
          ${hasDot ? `<div style="width: 6px; height: 6px; background: ${accent}; border-radius: 50%; margin: 2px auto 0;"></div>` : ''}
        </div>
      `;
    }

    html += `</div>`;

    // Upcoming events list
    const upcoming = eventsThisMonth
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 5);

    if (upcoming.length > 0) {
      html += `<div style="margin-top: 16px; border-top: 1px solid ${border}; padding-top: 16px;">`;
      html += `<h3 style="margin: 0 0 12px; font-size: 14px; font-weight: 600;">Upcoming Events</h3>`;
      for (const evt of upcoming) {
        const date = new Date(evt.startTime);
        const timeStr = date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
        html += `
          <div style="padding: 8px 0; border-bottom: 1px solid ${border}; display: flex; gap: 12px; align-items: flex-start;">
            <div style="min-width: 40px; text-align: center; background: ${accent}11; border-radius: 6px; padding: 4px;">
              <div style="font-size: 18px; font-weight: 700; color: ${accent};">${date.getDate()}</div>
              <div style="font-size: 10px; text-transform: uppercase; color: ${isDark ? '#9ca3af' : '#6b7280'};">${date.toLocaleString('default', { month: 'short' })}</div>
            </div>
            <div>
              <div style="font-weight: 500; font-size: 14px;">${evt.title}</div>
              <div style="font-size: 12px; color: ${isDark ? '#9ca3af' : '#6b7280'};">${timeStr}</div>
              ${evt.location ? `<div style="font-size: 12px; color: ${isDark ? '#9ca3af' : '#6b7280'};">${evt.location.name}</div>` : ''}
            </div>
          </div>
        `;
      }
      html += `</div>`;
    }

    html += `
        <div style="margin-top: 12px; text-align: center; font-size: 11px; color: ${isDark ? '#6b7280' : '#9ca3af'};">
          Powered by <a href="https://maybeos.app" style="color: ${accent}; text-decoration: none;">MaybeOS</a>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Attach navigation handlers
    document.getElementById('mos-prev')?.addEventListener('click', () => {
      this.currentMonth = new Date(year, month - 1, 1);
      this.render();
    });
    document.getElementById('mos-next')?.addEventListener('click', () => {
      this.currentMonth = new Date(year, month + 1, 1);
      this.render();
    });
  }
}

// Auto-initialize from script tag attributes
if (typeof document !== 'undefined') {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script) {
    const orgSlug = script.getAttribute('data-org') || '';
    const theme = (script.getAttribute('data-theme') as 'light' | 'dark') || 'light';
    const apiUrl = script.getAttribute('data-api') || 'http://localhost:3001';

    if (orgSlug) {
      const widget = new MaybeOSCalendarWidget({ orgSlug, theme, apiUrl });
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => widget.init());
      } else {
        widget.init();
      }
    }
  }
}

export { MaybeOSCalendarWidget };
export type { EmbedConfig, CalendarEvent };
