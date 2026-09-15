'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Hash, Instagram, KeyRound, Users } from 'lucide-react';
import styles from './landing.module.css';

/**
 * The hero's picture: a handful of real MaybeOS moments, happening.
 *
 * Built from HTML rather than screenshots so it stays sharp, stays on brand
 * when the app's styling changes, and can move. Every card is something the
 * product actually does; the names are made up.
 */

const delay = (ms: number) => ({ ['--delay' as string]: `${ms}ms` }) as CSSProperties;
const tilt = (deg: number, floatSeconds: number, ms: number) =>
  ({ ['--tilt' as string]: `${deg}deg`, ['--float' as string]: `${floatSeconds}s`, ['--delay' as string]: `${ms}ms` }) as CSSProperties;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

/** Counts up once, after a pause, to where it was always going. */
function useCount(to: number, startAfter: number, reduced: boolean) {
  const [value, setValue] = useState(reduced ? to : 0);
  useEffect(() => {
    if (reduced) {
      setValue(to);
      return;
    }
    let frame = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 1200);
        setValue(Math.round(to * (1 - Math.pow(1 - t, 3))));
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, startAfter);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [to, startAfter, reduced]);
  return value;
}

/** Types the door code one letter at a time. */
function useTyped(text: string, startAfter: number, reduced: boolean) {
  const [shown, setShown] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) {
      setShown(text.length);
      return;
    }
    let i = 0;
    let interval = 0;
    const timer = window.setTimeout(() => {
      interval = window.setInterval(() => {
        i += 1;
        setShown(i);
        if (i >= text.length) window.clearInterval(interval);
      }, 180);
    }, startAfter);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [text, startAfter, reduced]);
  return text.slice(0, shown);
}

const FACES = [
  { initials: 'RM', bg: 'bg-mustard-tint' },
  { initials: 'JT', bg: 'bg-moss-tint' },
  { initials: 'AK', bg: 'bg-brand-100' },
  { initials: 'DL', bg: 'bg-paper-deep' },
];

export function HeroScene() {
  const reduced = useReducedMotion();
  const going = useCount(18, 1300, reduced);
  const code = useTyped('KXQTR', 2200, reduced);

  return (
    <div className="relative mx-auto w-full max-w-[48rem] xl:h-[34rem] xl:max-w-[34rem]" aria-hidden="true">
      <div className="grid gap-4 sm:grid-cols-2 xl:block">
        {/* An event, filling up */}
        <div
          className={`${styles.floaty} rounded-lg border-[1.5px] border-ink bg-white p-4 shadow-hard-lg xl:absolute xl:left-0 xl:top-6 xl:w-[19rem]`}
          style={tilt(-2, 7, 150)}
        >
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">Thu · 7:00 pm</span>
            <span className="rounded-full bg-moss-tint px-2 py-0.5 text-[11px] font-semibold text-moss">Public</span>
          </div>
          <p className="mt-2 font-display text-lg leading-tight text-ink">Figure drawing night</p>
          <p className="text-xs text-ink-soft">Studio B · $12 at the door</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex -space-x-2">
              {FACES.map((face, i) => (
                <span
                  key={face.initials}
                  className={`${styles.pop} flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-ink text-[10px] font-semibold text-ink ${face.bg}`}
                  style={delay(900 + i * 160)}
                >
                  {face.initials}
                </span>
              ))}
            </div>
            <span className="font-mono text-sm font-semibold text-ink">{going} going</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className={`${styles.pop} inline-flex items-center gap-1 rounded-full border border-ink/20 bg-paper px-2 py-0.5 text-[11px] text-ink-soft`} style={delay(2600)}>
              <Hash className="h-3 w-3" /> Posted to #events
            </span>
            <span className={`${styles.pop} inline-flex items-center gap-1 rounded-full border border-ink/20 bg-paper px-2 py-0.5 text-[11px] text-ink-soft`} style={delay(3200)}>
              <Instagram className="h-3 w-3" /> Shared, credited to @rosa.draws
            </span>
          </div>
        </div>

        {/* Somebody joining */}
        <div
          className={`${styles.floaty} hidden rounded-lg border-[1.5px] border-ink bg-white p-4 shadow-hard sm:block xl:absolute xl:right-0 xl:top-0 xl:w-[15.5rem]`}
          style={tilt(2.5, 8, 450)}
        >
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            <Hash className="h-3.5 w-3.5" /> general
          </div>
          <p className="mt-2 text-sm font-semibold text-ink">Someone new is here 👋</p>
          <p className="text-xs text-ink-soft">Say hi to Priya. She joined as a Supporter today.</p>
          <div className="mt-3 flex gap-1.5">
            {['👋 6', '🎉 3', '❤️ 2'].map((r, i) => (
              <span key={r} className={`${styles.pop} rounded-full border border-ink/15 bg-paper px-2 py-0.5 text-[11px]`} style={delay(1500 + i * 220)}>
                {r}
              </span>
            ))}
          </div>
        </div>

        {/* The door code */}
        <div
          className={`${styles.floaty} rounded-lg border-[1.5px] border-ink bg-ink p-4 text-paper shadow-hard-accent xl:absolute xl:bottom-24 xl:right-4 xl:w-[14.5rem]`}
          style={tilt(-1.5, 6.5, 750)}
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-paper/60">
            <KeyRound className="h-3.5 w-3.5" /> Door access pin code
          </div>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.3em]">
            {code}
            {code.length < 5 && <span className={styles.caret}>▍</span>}
          </p>
          <p className="mt-1 text-[11px] text-paper/60">Emailed on joining. Revoked if they cancel.</p>
        </div>

        {/* Dues, their way */}
        <div
          className={`${styles.floaty} hidden rounded-lg border-[1.5px] border-ink bg-mustard-tint p-4 shadow-hard sm:block xl:absolute xl:bottom-4 xl:left-10 xl:w-[16rem]`}
          style={tilt(1.5, 7.5, 1050)}
        >
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Users className="h-3.5 w-3.5" /> Supporter
            </span>
            <span className={`${styles.live} h-2 w-2 rounded-full bg-moss`} />
          </div>
          <p className="mt-1 font-display text-lg text-ink">Pay what you can</p>
          <p className="text-xs text-ink-soft">From $10 a month, straight to your co-op’s Stripe.</p>
          <p className={`${styles.pop} mt-2 inline-flex items-center gap-1 text-xs font-semibold text-moss`} style={delay(2000)}>
            <Check className="h-3.5 w-3.5" /> Priya joined
          </p>
        </div>
      </div>
    </div>
  );
}
