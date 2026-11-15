import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  // Execute the SMTP email relay locally on Vercel (where outbound ports 465/587 are open)
  if (req.nextUrl.pathname.startsWith('/api/internal/email-relay')) {
    return NextResponse.next();
  }

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
