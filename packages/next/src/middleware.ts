import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { parseSessionCookie, roleHome, SESSION_COOKIE } from './auth.js';

export function actualPlayMiddleware(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;
  const session = parseSessionCookie(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith('/login')) {
    if (!session) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = roleHome(session.role);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith('/admin')) {
    if (!session) return redirectLogin(request);
  }

  if (pathname.startsWith('/dm')) {
    if (!session || !['admin', 'dm'].includes(session.role)) return redirectLogin(request);
  }

  if (pathname.startsWith('/player')) {
    if (!session || session.role !== 'player') return redirectLogin(request);
  }

  if (pathname.startsWith('/audience-control')) {
    if (!session || !['admin', 'dm', 'audience'].includes(session.role)) return redirectLogin(request);
  }

  return NextResponse.next();
}

function redirectLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const actualPlayMiddlewareMatcher = [
  '/admin/:path*',
  '/dm/:path*',
  '/player/:path*',
  '/audience-control/:path*',
  '/login',
];
