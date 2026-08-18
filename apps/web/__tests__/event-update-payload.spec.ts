import { toUpdatePayload } from '@/lib/events';

/**
 * An edit must not send a field only creation accepts.
 *
 * The event form is shared between creating and editing, and it submits
 * `publish`. `CreateEventDto` accepts that; `UpdateEventDto` does not, and the
 * API validates against a whitelist — so editing an event was refused
 * wholesale with `property publish should not exist`. Not a dropped field: a
 * rejected request, saving nothing. Charley hit it on the first edit anyone
 * had ever attempted, trying to move MaybeItsFate's event off PRIVATE.
 */
describe('the event update payload', () => {
  const values = {
    title: '$10 Test',
    description: 'A test event',
    startTime: '2026-08-20T18:00',
    endTime: '2026-08-20T19:00',
    visibility: 'MEMBERS_ONLY',
    publish: true,
  } as never;

  it('drops publish, which only creation accepts', () => {
    expect(toUpdatePayload(values)).not.toHaveProperty('publish');
  });

  it('keeps everything the edit was actually for', () => {
    const payload = toUpdatePayload(values) as Record<string, unknown>;

    // Visibility above all: moving an event off PRIVATE is the edit that
    // exposed this, and silently dropping it would look like the same bug.
    expect(payload.visibility).toBe('MEMBERS_ONLY');
    expect(payload.title).toBe('$10 Test');
    expect(payload.startTime).toBe('2026-08-20T18:00');
  });

  it('leaves values without publish untouched', () => {
    const { publish: _p, ...withoutPublish } = values as Record<string, unknown>;
    expect(toUpdatePayload(withoutPublish as never)).toEqual(withoutPublish);
  });
});
