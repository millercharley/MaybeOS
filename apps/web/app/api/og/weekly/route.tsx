import { timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import {
  CARD_PADDING_Y,
  CHIP,
  POSTER_HEIGHT,
  POSTER_WIDTH,
  ROW_GAP,
  posterPalette,
  splitForPoster,
  CTA_LIMIT,
  DEFAULT_CTA,
  logoBox,
  windowLabel,
  type PosterEvent,
} from '@/lib/weekly-poster';

export const runtime = 'nodejs';

/**
 * The co-op's weekly poster (SOC-05).
 *
 * Rendered here rather than in the API for one reason: Next already ships
 * satori for OG images, so this costs no new dependency anywhere — and the
 * API function is 68 MB and on the compute card Charley marked "better to
 * make our code more efficient". The scheduler asks this route for a PNG and
 * publishes it; the hop is cheaper than the bundle.
 *
 * Fonts are read off disk rather than fetched. OPS-45 vendored Archivo and
 * Young Serif as ordinary npm packages so a build could not fail on Google's
 * CDN, and the same files answer here — satori needs real font data, and a
 * renderer that reached across the network every Thursday would fail on the
 * one Thursday the network was unhappy.
 */

const FONTS = join(process.cwd(), '..', '..', 'node_modules', '@fontsource');
const font = (file: string) => readFileSync(join(FONTS, file));

interface Body {
  orgName: string;
  brandColor?: string | null;
  logoUrl?: string | null;
  from: string;
  to: string;
  /** The co-op's timezone. Every time on the poster is formatted into it. */
  timezone?: string;
  /** What the co-op wants people to do, in their own words. */
  cta?: string | null;
  events: { title: string; startsAt: string; room?: string | null; free?: boolean }[];
}

/**
 * The logo as bytes, and the shape it should be drawn at.
 *
 * Fetched and measured here rather than handed to satori as a URL: satori
 * would fetch it again, and it cannot tell us the aspect ratio, which is what
 * decides whether this co-op's logo is a wordmark carrying the name or an
 * emblem sitting beside it. `null` on any failure — a poster with no logo is
 * a poster; a poster that threw is nothing.
 */
async function logo(url: string | null | undefined) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    const { width, height, format } = await sharp(bytes).metadata();
    if (!width || !height) return null;

    return {
      src: `data:image/${format ?? 'png'};base64,${bytes.toString('base64')}`,
      box: logoBox(width / height),
    };
  } catch {
    return null;
  }
}

/**
 * Only the scheduler may ask for a poster.
 *
 * Rendering an image is expensive and this route takes its text from the
 * request body, so unguarded it is both an open compute endpoint on
 * maybeos.org and a way to put arbitrary words on a page that looks like a
 * co-op's. Neither is acceptable on a public host.
 *
 * **Fail closed.** With `POSTER_RENDER_SECRET` unset the route refuses
 * everybody, including the scheduler — which is the right way round while
 * SOC-05 is still being built: an unfinished feature that refuses is a
 * feature that is not yet on, and an unfinished feature that renders for
 * anyone who finds it is a bill and a liability.
 */
function allowed(request: Request): boolean {
  const expected = process.env.POSTER_RENDER_SECRET;
  if (!expected) return false;

  const offered = request.headers.get('x-poster-secret') ?? '';
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  // Compared at equal length, so the comparison itself says nothing about
  // how much of a guess was right.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!allowed(request)) {
    // 404 rather than 401: an endpoint nobody but the scheduler should know
    // about has nothing to gain by confirming it exists.
    return new Response('Not found', { status: 404 });
  }

  const body = (await request.json()) as Body;
  const mark = await logo(body.logoUrl);

  const events: PosterEvent[] = body.events.map((e) => ({
    title: e.title,
    startsAt: new Date(e.startsAt),
    room: e.room ?? null,
    free: Boolean(e.free),
  }));

  const tz = body.timezone || 'America/New_York';
  const { shown, overflow } = splitForPoster(events);
  const c = posterPalette(body.brandColor);

  // Trimmed here as well as validated at the settings form: this route is
  // also reachable by the scheduler, and a poster is not the place to find
  // out that a cap was only ever enforced in a browser.
  const cta = (body.cta ?? '').trim().slice(0, CTA_LIMIT) || DEFAULT_CTA;

  const time = (d: Date) =>
    d
      .toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
      .replace(':00', '')
      .toLowerCase();

  const png = new ImageResponse(
    (
      <div
        style={{
          width: POSTER_WIDTH,
          height: POSTER_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          background: c.background,
          fontFamily: 'Archivo',
          color: c.ink,
        }}
      >
        {/* The band: who this is, and what span it covers. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '44px 64px 28px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {mark ? (
              <img
                src={mark.src}
                width={mark.box.width}
                height={mark.box.height}
                // `contain`, never `cover`: a logo is somebody's mark and is
                // shown whole or not at all.
                style={{ objectFit: 'contain' }}
              />
            ) : null}
            {/* A wordmark already says the name; setting it again in Archivo
                beside it says it twice, in two typefaces. */}
            {mark?.box.isWordmark ? null : (
              <div
                style={{
                  display: 'flex',
                  fontSize: 30,
                  fontWeight: 600,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                }}
              >
                {body.orgName}
              </div>
            )}
          </div>

          <div
            style={{
              fontFamily: 'YoungSerif',
              fontSize: 84,
              lineHeight: 1,
              marginTop: 22,
            }}
          >
            {'What\u2019s on'}
          </div>

          <div style={{ display: 'flex', fontSize: 28, marginTop: 12, opacity: 0.75 }}>
            {windowLabel(new Date(body.from), new Date(body.to), tz)}
          </div>
        </div>

        {/* The events, chronological, one card each. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            padding: '0 64px',
            gap: ROW_GAP,
          }}
        >
          {shown.map((e, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                background: c.card,
                borderRadius: 16,
                padding: `${CARD_PADDING_Y}px 20px`,
                gap: 22,
              }}
            >
              {/* The date chip, in the co-op's own colour. */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 78,
                  height: CHIP,
                  borderRadius: 12,
                  background: c.accent,
                  color: c.accentInk,
                }}
              >
                <div style={{ display: 'flex', fontSize: 20, fontWeight: 600, letterSpacing: 1 }}>
                  {e.startsAt.toLocaleDateString('en-US', { timeZone: tz, month: 'short' }).toUpperCase()}
                </div>
                <div style={{ display: 'flex', fontSize: 36, fontWeight: 700, lineHeight: 1.1 }}>
                  {e.startsAt.toLocaleDateString('en-US', { timeZone: tz, day: 'numeric' })}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: 32,
                    fontWeight: 600,
                    lineHeight: 1.15,
                    // One line. A two-line title steals the row below it, and
                    // the full title is in the caption regardless.
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {e.title}
                </div>
                {/* One string, not several children: satori wants an
                    explicit display on anything with more than one child, and
                    a single line of text has no business being a flex row. */}
                <div style={{ display: 'flex', fontSize: 25, marginTop: 6, opacity: 0.7 }}>
                  {[
                    e.startsAt.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' }),
                    time(e.startsAt),
                    e.room,
                    e.free ? 'Free' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
          ))}

        </div>

        {/*
          What the co-op wants people to do, and — when the week did not fit —
          where the rest of it went. Two lines, so the call to action is never
          elbowed out by the overflow notice.
        */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 150,
            padding: '0 64px',
            gap: 8,
          }}
        >
          {overflow.length > 0 ? (
            <div style={{ display: 'flex', fontSize: 23, opacity: 0.65 }}>
              {`and ${overflow.length} more \u00b7 every one of them in the caption`}
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              // `textAlign` alone does not centre a flex container's text.
              justifyContent: 'center',
              fontSize: 29,
              fontWeight: 600,
              lineHeight: 1.25,
              textAlign: 'center',
              /*
                Wrapped, not trusted to fit.

                The 80-character cap keeps ordinary text to two comfortable
                lines, but a cap on characters cannot bound a width: eighty
                capital Ws are twice the poster wide and ran off both edges
                when this was a single nowrap line. So the width is bounded,
                words break when a word is longer than the line, and anything
                still too tall is clipped rather than pushed into the last
                event.
              */
              width: '100%',
              maxHeight: 76,
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          >
            {cta}
          </div>
        </div>
      </div>
    ),
    {
      width: POSTER_WIDTH,
      height: POSTER_HEIGHT,
      fonts: [
        { name: 'Archivo', data: font('archivo/files/archivo-latin-400-normal.woff'), weight: 400 },
        { name: 'Archivo', data: font('archivo/files/archivo-latin-600-normal.woff'), weight: 600 },
        { name: 'Archivo', data: font('archivo/files/archivo-latin-700-normal.woff'), weight: 700 },
        {
          name: 'YoungSerif',
          data: font('young-serif/files/young-serif-latin-400-normal.woff'),
          weight: 400,
        },
      ],
    },
  );

  /*
    JPEG, not the PNG satori gives us.

    Instagram's content publishing API takes JPEG and nothing else, and it
    fetches the file itself from a public address — so the conversion has to
    happen before the bytes are stored, not when they are read. Done here
    rather than in the API for the same reason the drawing is: `sharp` is
    already a dependency of this app and adding it to a 68 MB function
    bundle to re-encode one image a week would be the wrong trade.

    A poster is flat colour and text, so quality 88 is indistinguishable from
    the PNG at a fraction of the bytes — and Instagram has a size ceiling.
  */
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer()))
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return new Response(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(jpeg.length),
      'Cache-Control': 'no-store',
    },
  });
}
