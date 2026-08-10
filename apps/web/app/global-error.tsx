'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Last-resort boundary: catches errors thrown by the root layout itself, which
 * app/error.tsx cannot, because it renders *inside* that layout.
 *
 * It replaces the entire document, so it must supply its own <html> and <body>
 * and cannot rely on anything the root layout provides — including the
 * next/font CSS variables the design system's classes are built on. Everything
 * here is therefore inline and self-contained, so this page still renders
 * legibly even when the stylesheet or font pipeline is itself the failure.
 * Values are copied from styles/globals.css rather than referenced.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1rem',
          background: '#f3eee1',
          color: '#211c16',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          lineHeight: 1.5,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '32rem',
            background: '#fffdf8',
            border: '1.5px solid #211c16',
            borderRadius: '14px',
            boxShadow: '3px 3px 0 #211c16',
            padding: '2rem',
          }}
        >
          <p
            style={{
              margin: '0 0 0.75rem',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#8b8072',
            }}
          >
            Something broke
          </p>

          <h1 style={{ margin: '0 0 0.75rem', fontSize: '1.5rem', lineHeight: 1.2 }}>
            MaybeOS couldn&apos;t start
          </h1>

          <p style={{ margin: '0 0 1.5rem', color: '#4a423a' }}>
            The failure has been reported. Reloading usually clears it.
          </p>

          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '0.625rem 1.25rem',
              background: '#c81e2c',
              color: '#fffdf8',
              border: '1.5px solid #211c16',
              borderRadius: '8px',
              boxShadow: '2px 2px 0 #211c16',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Reload MaybeOS
          </a>

          {error.digest && (
            <p
              style={{
                margin: '1.5rem 0 0',
                paddingTop: '1rem',
                borderTop: '1px solid #d9cfbb',
                fontSize: '0.75rem',
                color: '#8b8072',
              }}
            >
              Reference{' '}
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {error.digest}
              </span>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
