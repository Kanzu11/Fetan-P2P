import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { verifyPassword } from '@/server/security/password';
import { setSessionCookie, signSessionToken } from '@/server/security/session';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';

export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address.').max(120),
  password: z.string().min(1, 'Password is required.').max(128),
});

/**
 * Email + password login endpoint.
 */
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const ipLimit = await rateLimiter.checkAsync(`login-ip:${ip}`, 20, 900);
    if (!ipLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        ipLimit.resetSeconds,
        'Too many sign-in attempts from this IP. Please try again later.'
      );
    }

    const body = await req.json();
    if (body && typeof body === 'object' && 'email' in body && !('password' in body)) {
      return NextResponse.json(
        {
          error:
            'Unverified direct email login is disabled. Provide your password or request a 6-digit verification code via /api/auth/request-otp.',
        },
        { status: 410 }
      );
    }
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Email and password are required.' },
        { status: 400 }
      );
    }

    const cleanEmail = parsed.data.email.trim().toLowerCase();
    const emailLimit = await rateLimiter.checkAsync(`login-email:${cleanEmail}`, 10, 900);
    if (!emailLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        emailLimit.resetSeconds,
        'Too many sign-in attempts for this account. Please wait 15 minutes or reset your password.'
      );
    }

    const authRecord = await db.getUserAuthByEmail(cleanEmail);
    if (!authRecord) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    if (!authRecord.passwordHash) {
      return NextResponse.json(
        {
          error:
            'No password is set on this account yet. Use Forgot Password to create a password, or sign in with Email Code / Google.',
          code: 'PASSWORD_NOT_SET',
        },
        { status: 400 }
      );
    }

    const passwordValid = await verifyPassword(parsed.data.password, authRecord.passwordHash);
    if (!passwordValid) {
      await db.logAudit({
        actorId: authRecord.user.id,
        actorRole: authRecord.user.role,
        action: 'LOGIN_PASSWORD_FAILED',
        targetType: 'User',
        targetId: authRecord.user.id,
        ip,
        details: { email: cleanEmail },
      });
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    if (!authRecord.emailVerified) {
      return NextResponse.json(
        {
          error:
            'Please verify your email with the 6-digit OTP code from signup before signing in with your password.',
          requiresVerification: true,
          email: cleanEmail,
        },
        { status: 403 }
      );
    }

    if (authRecord.user.isSuspended) {
      return NextResponse.json(
        {
          error:
            authRecord.user.suspendReason ||
            'Your account has been suspended. Please contact support.',
        },
        { status: 403 }
      );
    }

    const superAdminEmail = (
      process.env.SUPERADMIN_EMAIL ||
      process.env.ADMIN_EMAIL ||
      ''
    )
      .trim()
      .toLowerCase();
    const isSuperadminEmail = Boolean(superAdminEmail && cleanEmail === superAdminEmail);

    let user = await db.touchUserLogin(authRecord.user.id);
    if (isSuperadminEmail && user.role !== 'SUPERADMIN') {
      user = await db.updateUser(user.id, { role: 'SUPERADMIN', kycStatus: 'VERIFIED' });
    }

    await db.logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'LOGIN_PASSWORD_SUCCESS',
      targetType: 'User',
      targetId: user.id,
      ip,
      details: { email: cleanEmail },
    });

    const token = signSessionToken(user.id, user.role);
    const response = NextResponse.json({
      success: true,
      token,
      user,
      message: 'Signed in successfully.',
    });
    setSessionCookie(response, user.id, user.role);
    return response;
  } catch (err) {
    console.error('Password login error:', err);
    return NextResponse.json(
      { error: 'Failed to sign in. Please try again.' },
      { status: 500 }
    );
  }
}
