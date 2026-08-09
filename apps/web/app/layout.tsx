import type { Metadata } from 'next';
import { Archivo, Young_Serif, IBM_Plex_Mono } from 'next/font/google';
import '@/styles/globals.css';
import { AuthProvider } from '@/components/layout/auth-provider';

/**
 * Brand typefaces, self-hosted by next/font rather than pulled from the
 * Google CDN at runtime — avoids a render-blocking request and the flash of
 * fallback text on first paint.
 *
 * Young Serif carries display headlines only (the wordmark's face, used like
 * a union-newsletter masthead). Archivo does all UI and body work. IBM Plex
 * Mono marks anything data-like: IDs, slugs, counts, timestamps.
 */
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans-next',
  display: 'swap',
});

const youngSerif = Young_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display-next',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-next',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MaybeOS — Run your co-op, not your software stack',
  description:
    'Open-source tools for member-run organizations. Membership, events, spaces, decisions, and impact in one suite — built by a co-op, for co-ops.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${youngSerif.variable} ${plexMono.variable}`}
    >
      <body className="font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
