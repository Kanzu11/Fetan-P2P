import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';

let activeUserId = 'usr-buyer-dawit';

export async function GET(req: Request) {
  // Check cookie session first
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/fetan_session=([^;]+)/);
  const sessionUserId = match ? decodeURIComponent(match[1]) : null;

  const targetId = sessionUserId || activeUserId;
  let user = db.getUser(targetId);

  if (!user && sessionUserId) {
    user = db.getUser(activeUserId);
  }

  const availableUsers = db.getAllUsers().map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    kycStatus: u.kycStatus,
    merchantStatus: u.merchantStatus,
    usdtBalance: u.usdtBalance,
    usdtLocked: u.usdtLocked,
  }));

  return NextResponse.json({
    user: user || null,
    availableUsers,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === 'LOGOUT') {
      const response = NextResponse.json({ success: true, user: null });
      response.cookies.delete('fetan_session');
      return response;
    }

    if (body.userId) {
      const targetUser = db.getUser(body.userId);
      if (!targetUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      activeUserId = body.userId;

      const response = NextResponse.json({ success: true, user: targetUser });
      response.cookies.set({
        name: 'fetan_session',
        value: targetUser.id,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });

      return response;
    }

    return NextResponse.json({ error: 'Missing userId or action' }, { status: 400 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
