import { NextRequest, NextResponse } from 'next/server';
import { tenantFromHost } from '@/lib/tenant-host';

/**
 * Tenant subdomains: `sunrise.maybeos.org/*` serves `/portal/sunrise/*`.
 *
 * The host-to-co-op decision lives in `lib/tenant-host.ts` so it can be tested
 * without the edge runtime — see SCL-01 for what the old rule got wrong.
 */
const APP_ROUTES = [
  '/login',
  '/register',
  '/magic-link',
  '/admin',
  '/member',
  '/calendar',
  '/portal',
  '/invite',
];

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const path = url.pathname;

  if (APP_ROUTES.some((route) => path === route || path.startsWith(route + '/'))) {
    return NextResponse.next();
  }

  const tenant = tenantFromHost(request.headers.get('host') || '');
  if (!tenant) return NextResponse.next();

  url.pathname = `/portal/${tenant}${path === '/' ? '' : path}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next|api|favicon\\.ico|.*\\..*).*)'],
};
