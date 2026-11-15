import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/security/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  const rawGoogleId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
  const googleClientId =
    rawGoogleId
      .split(',')[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, '') || null;

  return NextResponse.json({
    user: user || null,
    googleClientId,
  });
}

export async function POST() {
  return NextResponse.json(
    { error: 'Direct user switching is disabled. Please sign in with verified Email OTP or Google.' },
    { status: 410 }
  );
}
