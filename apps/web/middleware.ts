import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const url = request.nextUrl.clone();

  const parts = hostname.split('.');
  if (parts.length >= 3) {
    const subdomain = parts[0];
    if (['app', 'api', 'www'].includes(subdomain)) {
      return NextResponse.next();
    }
    url.pathname = `/portal/${subdomain}${url.pathname === '/' ? '' : url.pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|api|favicon\\.ico|.*\\..*).*)'],
};
