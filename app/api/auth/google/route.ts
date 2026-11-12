import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { setSessionCookie } from '@/server/security/session';
import { sanitizeString } from '@/server/security/sanitize';

export const dynamic = 'force-dynamic';

const googleSchema = z.object({
  idToken: z.string().min(20),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const limit = await rateLimiter.checkAsync(`google-login:${ip}`, 15, 900);
    if (!limit.allowed) {
      return rateLimiter.rateLimitResponse(limit.resetSeconds);
    }

    const googleClientId =
      process.env.GOOGLE_CLIENT_ID?.trim() ||
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();

    if (!googleClientId) {
      return NextResponse.json(
        {
          error:
            'Google OAuth is not configured yet (GOOGLE_CLIENT_ID / NEXT_PUBLIC_GOOGLE_CLIENT_ID missing in .env). Use Email Code sign-in.',
        },
        { status: 501 }
      );
    }

    const body = await req.json();
    const parsed = googleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Valid Google ID token is required.' }, { status: 400 });
    }

    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(parsed.data.idToken)}`
    );
    if (!verifyRes.ok) {
      return NextResponse.json({ error: 'Invalid or expired Google ID token.' }, { status: 401 });
    }

    const payload = (await verifyRes.json()) as {
      aud?: string;
      email?: string;
      email_verified?: string | boolean;
      name?: string;
      exp?: string;
    };

    if (payload.aud !== googleClientId) {
      return NextResponse.json({ error: 'Google token audience mismatch.' }, { status: 401 });
    }

    const verifiedFlag = payload.email_verified === true || payload.email_verified === 'true';
    if (!payload.email || !verifiedFlag) {
      return NextResponse.json({ error: 'Google account email is not verified.' }, { status: 401 });
    }

    const expSeconds = Number(payload.exp || 0);
    if (!Number.isFinite(expSeconds) || expSeconds * 1000 <= Date.now()) {
      return NextResponse.json({ error: 'Google ID token expired.' }, { status: 401 });
    }

    const cleanEmail = payload.email.trim().toLowerCase();
    const superAdminEmail = (
      process.env.SUPERADMIN_EMAIL ||
      process.env.ADMIN_EMAIL ||
      ''
    )
      .trim()
      .toLowerCase();
    const isSuperadminEmail = Boolean(superAdminEmail && cleanEmail === superAdminEmail);

    let user = await db.getUserByEmail(cleanEmail);
    const cleanName = sanitizeString(payload.name, 60) || cleanEmail.split('@')[0];

    if (!user) {
      user = await db.createUser({
        email: cleanEmail,
        name: cleanName,
        nickname: cleanName.split(' ')[0],
        role: isSuperadminEmail ? 'SUPERADMIN' : 'USER',
        kycStatus: isSuperadminEmail ? 'VERIFIED' : 'UNVERIFIED',
        authProvider: 'google',
        emailVerified: true,
      });
    } else if (isSuperadminEmail && user.role !== 'SUPERADMIN') {
      user = await db.updateUser(user.id, { role: 'SUPERADMIN', kycStatus: 'VERIFIED' });
    }

    await db.logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'AUTH_GOOGLE_LOGIN_SUCCESS',
      targetType: 'User',
      targetId: user.id,
      ip,
    });

    const response = NextResponse.json({
      success: true,
      user,
      message: `Signed in with Google as ${user.name}`,
    });
    return setSessionCookie(response, user.id, user.role);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Google authentication failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

