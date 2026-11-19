import type { Metadata } from 'next';
import localFont from 'next/font/local';
import '@/styles/globals.css';
import { AuthProvider } from '@/components/layout/auth-provider';

/**
 * Brand typefaces, self-hosted — and now from files in the repository's own
 * dependencies rather than fetched while the site is being built (OPS-45).
 *
 * Young Serif carries display headlines only (the wordmark's face, used like
 * a union-newsletter masthead). Archivo does all UI and body work. IBM Plex
 * Mono marks anything data-like: IDs, slugs, counts, timestamps.
 *
 * **Why these are `localFont` and not `next/font/google`.**
 *
 * `next/font/google` self-hosts the result, which is why the old note here
 * said "self-hosted" and was half right: the *serving* was local, but the
 * *fetching* happened during `next build`, from Google's CDN, on every
 * build. So a network blip in GitHub Actions failed the build outright —
 * which it did on 11 November, and passed on a re-run with no change. A
 * build that fails on somebody else's CDN is a build that cannot be trusted
 * to tell you anything about your own code, and "re-run it" is the habit
 * that hides a real failure the day one happens.
 *
 * `@fontsource/*` ships the same Google-licensed woff2 files as an ordinary
 * npm dependency, pinned in the lockfile. Nothing is fetched at build time,
 * the bytes are identical, and an outage at Google cannot fail a deploy.
 *
 * The paths reach the workspace root's `node_modules` because npm hoists
 * them there rather than into `apps/web`. `localFont` needs a literal
 * string — it is a build-time transform, not a runtime call — so this
 * cannot be computed, and a test pins the files' existence instead.
 */
const archivo = localFont({
  src: [
    { path: '../../../node_modules/@fontsource/archivo/files/archivo-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../../node_modules/@fontsource/archivo/files/archivo-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../../node_modules/@fontsource/archivo/files/archivo-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../../../node_modules/@fontsource/archivo/files/archivo-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-sans-next',
  display: 'swap',
});

const youngSerif = localFont({
  src: [
    { path: '../../../node_modules/@fontsource/young-serif/files/young-serif-latin-400-normal.woff2', weight: '400', style: 'normal' },
  ],
  variable: '--font-display-next',
  display: 'swap',
});

const plexMono = localFont({
  src: [
    { path: '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-mono-next',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MaybeOS — One place for your whole community',
  description:
    'Open-source software for member-run communities: members and dues, events and tickets, rooms, conversations and votes, door codes and impact reporting, working together in one place.',
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
