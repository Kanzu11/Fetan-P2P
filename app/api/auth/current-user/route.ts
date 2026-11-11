import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';

// Default active user ID session simulation
let activeUserId = 'usr-buyer-dawit';

export async function GET() {
  const user = db.getUser(activeUserId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  return NextResponse.json({
    user,
    availableUsers: db.getAllUsers().map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      kycStatus: u.kycStatus,
      usdtBalance: u.usdtBalance,
      usdtLocked: u.usdtLocked,
    })),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.userId) {
      const targetUser = db.getUser(body.userId);
      if (!targetUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      activeUserId = body.userId;
      return NextResponse.json({ success: true, user: targetUser });
    }
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
