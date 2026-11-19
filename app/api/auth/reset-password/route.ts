import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { verifyAndConsumeOtp } from '@/server/security/otp';
import { hashPassword, validatePasswordStrength } from '@/server/security/password';
import { setSessionCookie } from '@/server/security/session';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';

export const dynamic = 'force-dynamic';

const resetSchema = z.object({
  email: z.string().email('Please enter a valid email address.').max(120),
  code: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits.'),
  newPassword: z.string().min(1, 'New password is required.'),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const ipLimit = await rateLimiter.checkAsync(`reset-ip:${ip}`, 15, 900);
    if (!ipLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        ipLimit.resetSeconds,
        'Too many password reset attempts. Please try again later.'
      );
    }

    const body = await req.json();
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid password reset input.' },
        { status: 400 }
      );
    }

    const cleanEmail = parsed.data.email.trim().toLowerCase();
    const emailLimit = await rateLimiter.checkAsync(`reset-email:${cleanEmail}`, 8, 900);
    if (!emailLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        emailLimit.resetSeconds,
        'Too many password reset attempts for this email. Please wait 15 minutes.'
      );
    }

    const strength = validatePasswordStrength(parsed.data.newPassword);
    if (!strength.valid) {
      return NextResponse.json({ error: strength.error }, { status: 400 });
    }

    const otpResult = await verifyAndConsumeOtp({
      email: cleanEmail,
      purpose: 'RESET_PASSWORD',
      code: parsed.data.code,
    });

    if (!otpResult.valid) {
      return NextResponse.json(
        { error: otpResult.error || 'Invalid or expired reset code.' },
        { status: 400 }
      );
    }

    const existing = await db.getUserByEmail(cleanEmail);
    if (!existing) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    }

    if (existing.isSuspended) {
      return NextResponse.json(
        { error: existing.suspendReason || 'Your account has been suspended.' },
        { status: 403 }
      );
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    const user = await db.updateUserPassword(existing.id, passwordHash, true);

    await db.logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'PASSWORD_RESET_COMPLETED',
      targetType: 'User',
      targetId: user.id,
      ip,
      details: { email: cleanEmail },
    });

    const response = NextResponse.json({
      success: true,
      user,
      message: 'Password updated successfully. You are now signed in.',
    });
    setSessionCookie(response, user.id, user.role, passwordHash);
    return response;
  } catch (err) {
    console.error('Reset password error:', err);
    return NextResponse.json(
      { error: 'Failed to reset password. Please try again.' },
      { status: 500 }
    );
  }
}
