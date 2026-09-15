'use client';

import { useEffect, useState } from 'react';
import styles from './landing.module.css';

/**
 * The headline's last word, cycling through what a community keeps track of.
 *
 * Screen readers get one fixed sentence instead of a word that changes under
 * them every two seconds. With reduced motion the words still change, but
 * without sliding.
 */
export function RotatingWord({ words, interval = 2400 }: { words: string[]; interval?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
    return () => window.clearInterval(id);
  }, [words.length, interval]);

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), '');

  return (
    <span className={styles.wordWindow} aria-hidden="true">
      {/* Holds the width of the longest word, so the line does not jump. */}
      <span className="invisible" style={{ gridArea: '1 / 1' }}>
        {longest}
      </span>
      {words.map((word, i) => {
        const state = i === index ? styles.wordShown : i === (index - 1 + words.length) % words.length ? styles.wordAfter : styles.wordBefore;
        return (
          <span key={word} className={`${styles.word} ${state} text-brand-600`}>
            {word}
          </span>
        );
      })}
    </span>
  );
}
