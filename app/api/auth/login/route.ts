import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { sanitizeString } from '@/server/security/sanitize';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);

    // Rate limit: 10 login attempts per 10 minutes per IP
    const limitCheck = rateLimiter.check(`login:${ip}`, 10, 600);
    if (!limitCheck.allowed) {
      return rateLimiter.rateLimitResponse(
        limitCheck.resetSeconds,
        'Too many login attempts from this network. Please wait a few minutes before trying again.'
      );
    }

    const body = await req.json();
    const { email, name, provider, role = 'USER' } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = (name && typeof name === 'string' && name.trim())
      ? sanitizeString(name.trim(), 60)
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
        usdtBalance: 0.0, // Production default: real wallet starting at 0
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

