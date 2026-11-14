import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const backendUrl = process.env.BACKEND_URL?.trim().replace(/\/+$/, '');
  if (!backendUrl) {
    return NextResponse.next();
  }

  const target = new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, backendUrl);
  return NextResponse.rewrite(target);
}

export const config = {
  matcher: '/api/:path*',
};
