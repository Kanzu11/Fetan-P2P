import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { createOtpChallenge } from '@/server/security/otp';
import { emailService } from '@/server/email-service';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';

export const dynamic = 'force-dynamic';

const forgotSchema = z.object({
  email: z.string().email('Please enter a valid email address.').max(120),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const ipLimit = await rateLimiter.checkAsync(`forgot-ip:${ip}`, 10, 900);
    if (!ipLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        ipLimit.resetSeconds,
        'Too many password reset requests from this IP. Please try again later.'
      );
    }

    const body = await req.json();
    const parsed = forgotSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Valid email is required.' },
        { status: 400 }
      );
    }

    const cleanEmail = parsed.data.email.trim().toLowerCase();
    const emailLimit = await rateLimiter.checkAsync(`forgot-email:${cleanEmail}`, 5, 900);
    if (!emailLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        emailLimit.resetSeconds,
        'Too many reset code requests for this email. Please wait 15 minutes.'
      );
    }

    if (!emailService.isConfigured()) {
      return NextResponse.json(
        { error: 'Email service is not configured on the server.' },
        { status: 503 }
      );
    }

    const existing = await db.getUserByEmail(cleanEmail);
    if (existing && !existing.isSuspended) {
      const { code } = await createOtpChallenge({
        email: cleanEmail,
        purpose: 'RESET_PASSWORD',
        metadata: { userId: existing.id },
      });

      try {
        await emailService.sendOtpEmail({
          to: cleanEmail,
          code,
          purpose: 'RESET_PASSWORD',
        });
      } catch (mailErr) {
        console.error('Forgot password email send failed:', mailErr);
        return NextResponse.json(
          {
            error:
              mailErr instanceof Error
                ? `Could not deliver reset email: ${mailErr.message}`
                : 'Email delivery service timed out or could not reach recipient.',
          },
          { status: 502 }
        );
      }

      await db.logAudit({
        actorId: existing.id,
        actorRole: existing.role,
        action: 'PASSWORD_RESET_OTP_REQUESTED',
        targetType: 'User',
        targetId: existing.id,
        ip,
        details: { email: cleanEmail },
      });
    }

    return NextResponse.json({
      success: true,
      email: cleanEmail,
      expiresInMinutes: 10,
      message:
        'If an account exists for that email, a 6-digit password reset code has been sent.',
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return NextResponse.json(
      { error: 'Failed to process password reset request.' },
      { status: 500 }
    );
  }
}
