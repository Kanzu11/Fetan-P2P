import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { createOtpChallenge } from '@/server/security/otp';
import { hashPassword, validatePasswordStrength } from '@/server/security/password';
import { emailService } from '@/server/email-service';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { sanitizeString } from '@/server/security/sanitize';

export const dynamic = 'force-dynamic';

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(80),
  email: z.string().email('Please enter a valid email address.').max(120),
  password: z.string().min(1, 'Password is required.'),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const ipLimit = await rateLimiter.checkAsync(`signup-ip:${ip}`, 10, 900);
    if (!ipLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        ipLimit.resetSeconds,
        'Too many signup attempts from this IP. Please try again later.'
      );
    }

    const body = await req.json();
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid signup input.' },
        { status: 400 }
      );
    }

    const cleanEmail = parsed.data.email.trim().toLowerCase();
    const emailLimit = await rateLimiter.checkAsync(`signup-email:${cleanEmail}`, 5, 900);
    if (!emailLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        emailLimit.resetSeconds,
        'Too many verification requests for this email. Please check your inbox or wait 15 minutes.'
      );
    }

    const strength = validatePasswordStrength(parsed.data.password);
    if (!strength.valid) {
      return NextResponse.json({ error: strength.error }, { status: 400 });
    }

    const existing = await db.getUserAuthByEmail(cleanEmail);
    if (existing && existing.emailVerified) {
      return NextResponse.json(
        {
          error:
            'An account with this email already exists. Please sign in with your password or reset it.',
        },
        { status: 409 }
      );
    }

    if (!emailService.isConfigured()) {
      return NextResponse.json(
        { error: 'Email verification service is not configured on the server.' },
        { status: 503 }
      );
    }

    const cleanName = sanitizeString(parsed.data.name, 80);
    const passwordHash = await hashPassword(parsed.data.password);

    const { code } = await createOtpChallenge({
      email: cleanEmail,
      purpose: 'SIGNUP',
      metadata: {
        name: cleanName,
        passwordHash,
      },
    });

    await emailService.sendOtpEmail({
      to: cleanEmail,
      code,
      purpose: 'SIGNUP',
    });

    await db.logAudit({
      actorId: existing?.user.id,
      actorRole: existing?.user.role,
      action: 'SIGNUP_OTP_REQUESTED',
      targetType: 'User',
      targetId: existing?.user.id,
      ip,
      details: { email: cleanEmail },
    });

    return NextResponse.json({
      success: true,
      requiresVerification: true,
      email: cleanEmail,
      expiresInMinutes: 10,
      message:
        'Verification code sent to your email. Enter the 6-digit code to activate your account.',
    });
  } catch (err) {
    console.error('Signup OTP error:', err);
    return NextResponse.json(
      { error: 'Failed to create signup verification challenge. Please try again.' },
      { status: 500 }
    );
  }
}
