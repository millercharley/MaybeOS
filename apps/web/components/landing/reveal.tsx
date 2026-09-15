'use client';

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import styles from './landing.module.css';

/**
 * Fades and lifts its children in the first time they scroll into view.
 *
 * Once only: content that re-hides when you scroll back up is motion for its
 * own sake. Rendered visible when IntersectionObserver is missing, so an old
 * browser gets a page rather than a blank space.
 */
export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
  style,
}: {
  children: ReactNode;
  delay?: number;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      data-visible={visible}
      className={`${styles.reveal} ${className}`}
      style={{ ...style, ['--delay' as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
