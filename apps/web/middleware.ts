import { NextRequest, NextResponse } from 'next/server';
import { tenantFromHost, tenantAreaPath } from '@/lib/tenant-host';

/**
 * Tenant subdomains: `sunrise.maybeos.org/*` serves `/portal/sunrise/*`.
 *
 * The host-to-co-op decision lives in `lib/tenant-host.ts` so it can be tested
 * without the edge runtime — see SCL-01 for what the old rule got wrong.
 */
/**
 * The two areas that are scoped to one co-op and now say so in the address.
 * On a tenant subdomain they take the tenant from the hostname instead.
 */
const AREA_ROUTES = ['/admin', '/member'];

const APP_ROUTES = [
  '/login',
  '/register',
  '/magic-link',
  '/admin',
  '/member',
  '/calendar',
  '/portal',
  '/invite',
  // The Radar unsubscribe link (RDR-01). Same category as `/invite` and
  // `/magic-link`: a page opened from an email, belonging to the app rather
  // than to a co-op. Without it, a tenant host would rewrite
  // `sunrise.maybeos.org/radar/unsubscribe` to a portal section that does not
  // exist, and the member would get a 404 instead of a way to stop the email.
  '/radar',
];

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const path = url.pathname;

  const tenant = tenantFromHost(request.headers.get('host') || '');

  // `maybeitsfate.maybeos.org/admin/members` → `/admin/maybeitsfate/members`.
  //
  // This is what putting the co-op in the path bought. `/admin` and `/member`
  // used to sit in APP_ROUTES, excluded from tenant routing entirely, because
  // there was nowhere in the address to *put* the tenant — the org lived in
  // localStorage. Now the slug is a path segment, so a subdomain can rewrite
  // to it exactly the way the portal already does.
  if (tenant) {
    const areaPath = tenantAreaPath(path, tenant, AREA_ROUTES);
    if (areaPath) {
      url.pathname = areaPath;
      return NextResponse.rewrite(url);
    }
  }

  if (APP_ROUTES.some((route) => path === route || path.startsWith(route + '/'))) {
    return NextResponse.next();
  }

  if (!tenant) return NextResponse.next();

  url.pathname = `/portal/${tenant}${path === '/' ? '' : path}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next|api|favicon\\.ico|.*\\..*).*)'],
};
