'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Mail, Clock, Eye } from 'lucide-react';
import {
  api,
  type HostBriefing,
  type HostDuty,
  type HostDutyPhase,
  type BriefingAnchor,
  type Room,
} from '@/lib/api';

/**
 * What a host has to do around their booking, and the message telling them
 * (SRV-03).
 *
 * On the Rooms page rather than behind a nav entry of its own: it is a
 * property of booking a room, and an organiser looking for it will look where
 * the rooms are.
 *
 * The whole section is off until a message is written. There is no enable
 * switch, because "no message" and "off" are the same state and a co-op
 * should not have to hold two ideas about one thing.
 */
const PHASES: { phase: HostDutyPhase; title: string; blurb: string; defaults: string }[] = [
  {
    phase: 'BEFORE',
    title: 'Before',
    blurb: 'Opening up: keys, doors, signage, anything they need to find.',
    defaults: 'Sent at 07:00 on the day, with During.',
  },
  {
    phase: 'DURING',
    title: 'During',
    blurb: 'House rules while they have the room.',
    defaults: 'Sent at 07:00 on the day, with Before.',
  },
  {
    phase: 'AFTER',
    title: 'After',
    blurb: 'Closing up: tidying, bins, lights, locking.',
    defaults: 'Sent 1 hour before the booking ends.',
  },
];

const ANCHORS: { value: BriefingAnchor; label: string }[] = [
  { value: 'CLOCK_ON_DAY', label: 'At a set time on the day' },
  { value: 'BEFORE_START', label: 'Before it starts' },
  { value: 'AFTER_START', label: 'After it starts' },
  { value: 'BEFORE_END', label: 'Before it ends' },
  { value: 'AFTER_END', label: 'After it ends' },
];

export function HostDuties({
  orgId,
  token,
  rooms,
}: {
  orgId: string;
  token: string;
  rooms: Room[];
}) {
  const [duties, setDuties] = useState<HostDuty[]>([]);
  const [briefings, setBriefings] = useState<HostBriefing[]>([]);
  const [open, setOpen] = useState<HostDutyPhase | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ subject: string; html: string; sendsAt: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const [d, b] = await Promise.all([
        api.service.hostDuties(orgId, token),
        api.service.hostBriefings(orgId, token),
      ]);
      setDuties(d);
      setBriefings(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load host duties');
    }
  }, [orgId, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await run();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  const briefingFor = (phase: HostDutyPhase) => briefings.find((b) => b.phase === phase) ?? null;
  const dutiesFor = (phase: HostDutyPhase) => duties.filter((d) => d.phase === phase);

  return (
    <div className="card mt-8">
      <div>
        <h2 className="flex items-center gap-2 font-medium text-gray-900">
          <Mail className="h-4 w-4 text-gray-400" />
          What a host has to do
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Anything a member should do before, during and after a room they have booked.
          MaybeOS emails it to them on the day. <strong>Nothing is sent until you write a
          message</strong> — the lists on their own do nothing.
        </p>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {PHASES.map(({ phase, title, blurb, defaults }) => {
          const briefing = briefingFor(phase);
          const list = dutiesFor(phase);

          return (
            <section key={phase} className="rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-gray-900">{title}</h3>
                  <p className="mt-0.5 text-sm text-gray-500">{blurb}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                    <Clock className="h-3 w-3" />
                    {briefing ? scheduleInWords(briefing) : `Not sending. ${defaults}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {briefing && (
                    <button
                      onClick={() =>
                        act(async () =>
                          setPreview(await api.service.previewHostBriefing(orgId, phase, token)),
                        )
                      }
                      className="btn-secondary inline-flex items-center gap-1 text-sm"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Preview
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(open === phase ? null : phase)}
                    className="btn-secondary text-sm"
                  >
                    {briefing ? 'Edit message' : 'Write the message'}
                  </button>
                </div>
              </div>

              {open === phase && (
                <BriefingForm
                  briefing={briefing}
                  busy={busy}
                  phase={phase}
                  onCancel={() => setOpen(null)}
                  onSave={(input) =>
                    act(async () => {
                      await api.service.saveHostBriefing(orgId, phase, input, token);
                      setOpen(null);
                    })
                  }
                  onStop={
                    briefing
                      ? () =>
                          act(async () => {
                            await api.service.removeHostBriefing(orgId, phase, token);
                            setOpen(null);
                          })
                      : undefined
                  }
                />
              )}

              <DutyList
                duties={list}
                rooms={rooms}
                busy={busy}
                onAdd={(input) => act(() => api.service.createHostDuty(orgId, input, token))}
                onRemove={(id) => act(() => api.service.removeHostDuty(orgId, id, token))}
                phase={phase}
              />
            </section>
          );
        })}
      </div>

      {preview && <PreviewPane preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function scheduleInWords(b: HostBriefing): string {
  if (b.anchor === 'CLOCK_ON_DAY') return `Sent at ${b.clockTime} on the day of the booking.`;

  const amount =
    b.offsetMinutes < 60
      ? `${b.offsetMinutes} minutes`
      : `${b.offsetMinutes / 60} ${b.offsetMinutes === 60 ? 'hour' : 'hours'}`;
  const when: Record<string, string> = {
    BEFORE_START: 'before it starts',
    AFTER_START: 'after it starts',
    BEFORE_END: 'before it ends',
    AFTER_END: 'after it ends',
  };
  return `Sent ${amount} ${when[b.anchor]}.`;
}

function DutyList({
  duties,
  rooms,
  busy,
  phase,
  onAdd,
  onRemove,
}: {
  duties: HostDuty[];
  rooms: Room[];
  busy: boolean;
  phase: HostDutyPhase;
  onAdd: (input: { phase: HostDutyPhase; text: string; roomId?: string | null }) => void;
  onRemove: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const [roomId, setRoomId] = useState('');

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {duties.length > 0 && (
        <ul className="mb-3 space-y-1">
          {duties.map((duty) => (
            <li key={duty.id} className="flex items-start justify-between gap-3 text-sm">
              <span>
                {duty.text}
                {duty.room && (
                  <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {duty.room.name} only
                  </span>
                )}
              </span>
              <button
                onClick={() => onRemove(duty.id)}
                disabled={busy}
                className="shrink-0 text-gray-400 hover:text-red-600"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          className="input flex-1"
          maxLength={500}
          placeholder="Add something a host should do…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {/* Only worth offering once there is more than one room to choose. */}
        {rooms.length > 1 && (
          <select className="input w-44" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Every room</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name} only
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => {
            onAdd({ phase, text: text.trim(), roomId: roomId || null });
            setText('');
          }}
          disabled={busy || !text.trim()}
          className="btn-secondary inline-flex items-center gap-1 text-sm"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}

function BriefingForm({
  briefing,
  phase,
  busy,
  onSave,
  onCancel,
  onStop,
}: {
  briefing: HostBriefing | null;
  phase: HostDutyPhase;
  busy: boolean;
  onSave: (input: {
    subject: string;
    body: string;
    anchor: BriefingAnchor;
    clockTime: string;
    offsetMinutes: number;
  }) => void;
  onCancel: () => void;
  onStop?: () => void;
}) {
  // Charley's defaults, and the reason they differ by phase: Before and During
  // are about the day ahead, After is about a moment inside the booking.
  const [subject, setSubject] = useState(briefing?.subject ?? '');
  const [body, setBody] = useState(briefing?.body ?? '');
  const [anchor, setAnchor] = useState<BriefingAnchor>(
    briefing?.anchor ?? (phase === 'AFTER' ? 'BEFORE_END' : 'CLOCK_ON_DAY'),
  );
  const [clockTime, setClockTime] = useState(briefing?.clockTime ?? '07:00');
  const [offset, setOffset] = useState(String(briefing?.offsetMinutes ?? 60));

  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-3">
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Subject</span>
        <input
          type="text"
          className="input mt-1 w-full"
          maxLength={200}
          placeholder="You have the Attic today"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>

      <label className="mt-3 block">
        <span className="text-sm font-medium text-gray-700">Message</span>
        <textarea
          className="input mt-1 w-full"
          rows={3}
          maxLength={5000}
          placeholder="A few things before you open up."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <span className="mt-1 block text-xs text-gray-500">
          The list below is added underneath this, so it does not need repeating here.
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Send</span>
          <select
            className="input mt-1 w-52"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value as BriefingAnchor)}
          >
            {ANCHORS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        {anchor === 'CLOCK_ON_DAY' ? (
          <label className="block">
            <span className="text-sm font-medium text-gray-700">At</span>
            <input
              type="time"
              className="input mt-1"
              value={clockTime}
              onChange={(e) => setClockTime(e.target.value)}
            />
          </label>
        ) : (
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Minutes</span>
            <input
              type="number"
              min={0}
              max={10080}
              step={15}
              className="input mt-1 w-28"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            />
          </label>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Scheduled work runs every 15 minutes, so a message set for 07:00 arrives between
        07:00 and 07:15. Anything due at the same moment as another phase arrives as one
        email rather than two.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() =>
            onSave({
              subject: subject.trim(),
              body: body.trim(),
              anchor,
              clockTime,
              offsetMinutes: parseInt(offset, 10) || 0,
            })
          }
          disabled={busy || !subject.trim() || !body.trim()}
          className="btn-primary"
        >
          {busy ? 'Saving…' : 'Save and start sending'}
        </button>
        <button onClick={onCancel} disabled={busy} className="btn-secondary">
          Cancel
        </button>
        {onStop && (
          <button
            onClick={onStop}
            disabled={busy}
            className="btn-secondary ml-auto text-red-700"
            title="Removes the message, which is how this phase is switched off"
          >
            Stop sending this
          </button>
        )}
      </div>
    </div>
  );
}

function PreviewPane({
  preview,
  onClose,
}: {
  preview: { subject: string; html: string; sendsAt: string };
  onClose: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400">Preview</p>
          <p className="mt-1 font-medium text-gray-900">{preview.subject}</p>
          <p className="mt-0.5 text-xs text-gray-500">{preview.sendsAt}</p>
        </div>
        <button onClick={onClose} className="btn-secondary text-sm">
          Close
        </button>
      </div>
      {/* Built by the same code that sends it — the only honest preview. The
          server escapes everything an admin typed before it gets here. */}
      <div
        className="prose prose-sm mt-3 max-w-none rounded border border-gray-100 bg-gray-50 p-3"
        dangerouslySetInnerHTML={{ __html: preview.html }}
      />
    </div>
  );
}
