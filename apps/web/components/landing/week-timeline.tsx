'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Reveal } from './reveal';
import styles from './landing.module.css';

export interface WeekStep {
  day: string;
  title: string;
  body: string;
  points: string[];
  aside: ReactNode;
}

/**
 * "A week in a community on MaybeOS": the tools shown as the days they are
 * used, with a spine that fills as you read down it.
 */
export function WeekTimeline({ steps }: { steps: WeekStep[] }) {
  const list = useRef<HTMLOListElement | null>(null);
  const spine = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = list.current;
    const line = spine.current;
    if (!node || !line) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const reading = window.innerHeight * 0.6;
      const progress = Math.min(1, Math.max(0, (reading - rect.top) / rect.height));
      line.style.setProperty('--progress', progress.toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <ol ref={list} className="relative space-y-14 md:space-y-20">
      <div className="absolute bottom-0 left-[11px] top-2 w-[3px] rounded-full bg-paper-deep md:left-1/2 md:-ml-[1.5px]" aria-hidden="true">
        <div ref={spine} className={`${styles.spine} h-full w-full rounded-full bg-brand-600`} />
      </div>

      {steps.map((step, i) => (
        <li key={step.day} className="relative grid gap-6 pl-10 md:grid-cols-2 md:gap-16 md:pl-0">
          <span
            className="absolute left-0 top-1.5 h-[25px] w-[25px] rounded-full border-[1.5px] border-ink bg-paper md:left-1/2 md:-ml-[12.5px]"
            aria-hidden="true"
          >
            <span className="absolute inset-[5px] rounded-full bg-brand-600" />
          </span>

          <Reveal className={i % 2 === 1 ? 'md:order-2 md:pl-4' : 'md:pr-4 md:text-right'}>
            <p className="font-mono text-xs uppercase tracking-widest text-brand-600">{step.day}</p>
            <h3 className="mt-2 font-display text-xl leading-tight text-ink md:text-2xl">{step.title}</h3>
            <p className="mt-3 text-base text-ink-soft">{step.body}</p>
            <ul className={`mt-4 space-y-1.5 text-sm text-ink ${i % 2 === 1 ? '' : 'md:ml-auto'}`}>
              {step.points.map((point) => (
                <li key={point} className={`flex gap-2 ${i % 2 === 1 ? '' : 'md:flex-row-reverse'}`}>
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={150} className={i % 2 === 1 ? 'md:order-1 md:pr-4' : 'md:pl-4'}>
            {step.aside}
          </Reveal>
        </li>
      ))}
    </ol>
  );
}
