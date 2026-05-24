import { NextRequest, NextResponse } from 'next/server';

const APP_ROUTES = ['/login', '/register', '/magic-link', '/admin', '/member', '/calendar'];

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const url = request.nextUrl.clone();
  const path = url.pathname;

  if (APP_ROUTES.some((route) => path === route || path.startsWith(route + '/'))) {
    return NextResponse.next();
  }

  const parts = hostname.split('.');
  if (parts.length >= 3) {
    const subdomain = parts[0];
    if (['app', 'api', 'www'].includes(subdomain)) {
      return NextResponse.next();
    }
    url.pathname = `/portal/${subdomain}${path === '/' ? '' : path}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|api|favicon\\.ico|.*\\..*).*)'],
};
