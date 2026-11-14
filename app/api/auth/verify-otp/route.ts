import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { verifyAndConsumeOtp } from '@/server/security/otp';
import { setSessionCookie } from '@/server/security/session';
import { sanitizeString } from '@/server/security/sanitize';

export const dynamic = 'force-dynamic';

const verifySchema = z.object({
  email: z.string().email().max(120),
  code: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits.'),
  name: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const ipLimit = await rateLimiter.checkAsync(`verify-otp-ip:${ip}`, 20, 900);
    if (!ipLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        ipLimit.resetSeconds,
        'Too many verification attempts. Please wait 15 minutes.'
      );
    }

    const rawBody = await req.json();
    const parsed = verifySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid email or 6-digit code.' },
        { status: 400 }
      );
    }

    const cleanEmail = parsed.data.email.trim().toLowerCase();
    const emailLimit = await rateLimiter.checkAsync(`verify-otp-email:${cleanEmail}`, 10, 900);
    if (!emailLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        emailLimit.resetSeconds,
        'Too many failed code checks for this email. Please wait.'
      );
    }

    const otpResult = await verifyAndConsumeOtp({
      email: cleanEmail,
      purpose: 'LOGIN',
      code: parsed.data.code,
    });

    if (!otpResult.valid) {
      await db.logAudit({
        action: 'AUTH_OTP_FAILED',
        targetType: 'UserEmail',
        targetId: cleanEmail,
        ip,
        details: { reason: otpResult.error },
      });
      return NextResponse.json(
        { error: otpResult.error || 'Invalid or expired code.' },
        { status: 401 }
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

    let user = await db.getUserByEmail(cleanEmail);
    const fallbackName =
      sanitizeString(parsed.data.name, 60) ||
      cleanEmail
        .split('@')[0]
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

    if (!user) {
      user = await db.createUser({
        email: cleanEmail,
        name: fallbackName,
        nickname: fallbackName.split(' ')[0],
        role: isSuperadminEmail ? 'SUPERADMIN' : 'USER',
        kycStatus: isSuperadminEmail ? 'VERIFIED' : 'UNVERIFIED',
        authProvider: 'email',
        emailVerified: true,
      });
    } else if (isSuperadminEmail && user.role !== 'SUPERADMIN') {
      user = await db.updateUser(user.id, { role: 'SUPERADMIN', kycStatus: 'VERIFIED' });
    }

    if (user.isSuspended) {
      return NextResponse.json(
        {
          error: user.suspendReason
            ? `Account suspended: ${user.suspendReason}`
            : 'Your account has been suspended by Fetan Compliance.',
        },
        { status: 403 }
      );
    }

    await db.logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'AUTH_OTP_LOGIN_SUCCESS',
      targetType: 'User',
      targetId: user.id,
      ip,
    });

    const response = NextResponse.json({
      success: true,
      user,
      message: `Signed in as ${user.name}`,
    });

    return setSessionCookie(response, user.id, user.role);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Verification failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

