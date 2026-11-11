import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, name, provider, role = 'USER' } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = (name && typeof name === 'string' && name.trim())
      ? name.trim()
      : cleanEmail.split('@')[0];

    // Find existing user by email
    const allUsers = db.getAllUsers();
    let user = allUsers.find((u) => u.email.toLowerCase() === cleanEmail);

    if (!user) {
      // Create new user account
      const isSuperadminEmail =
        cleanEmail === (process.env.SUPERADMIN_EMAIL || 'kanzedinakmel0@gmail.com').toLowerCase() ||
        cleanEmail === 'admin@fetan.et';

      const assignedRole = isSuperadminEmail ? 'SUPERADMIN' : role;
      const newUserId = `usr-${Date.now().toString(36)}`;

      user = {
        id: newUserId,
        email: cleanEmail,
        name: cleanName,
        nickname: cleanName.replace(/\s+/g, '_'),
        role: assignedRole,
        kycStatus: isSuperadminEmail ? 'VERIFIED' : 'UNVERIFIED',
        merchantStatus: 'NONE',
        usdtBalance: isSuperadminEmail ? 5000.0 : 100.0, // Welcome demo balance
        usdtLocked: 0,
        completedTrades: 0,
        completionRate: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      db.saveUser(user);
    }

    // Create response and set HTTP-only session cookie
    const response = NextResponse.json({
      success: true,
      user,
      provider: provider || 'email',
    });

    response.cookies.set({
      name: 'fetan_session',
      value: user.id,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Login failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

