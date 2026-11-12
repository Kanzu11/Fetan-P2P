import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { createOtpChallenge } from '@/server/security/otp';
import { requireAuth } from '@/server/security/session';
import { emailService } from '@/server/email-service';

export const dynamic = 'force-dynamic';

const requestOtpSchema = z.object({
  email: z.string().email().max(120).optional(),
  purpose: z.enum(['LOGIN', 'WITHDRAW']).default('LOGIN'),
  amountUsdt: z.number().positive().optional(),
  network: z.enum(['TRC20', 'BEP20', 'TON']).optional(),
  destinationAddress: z.string().max(120).optional(),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const ipLimit = await rateLimiter.checkAsync(`otp-ip:${ip}`, 12, 900);
    if (!ipLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        ipLimit.resetSeconds,
        'Too many verification code requests from this IP. Please wait 15 minutes.'
      );
    }

    const rawBody = await req.json();
    const parsed = requestOtpSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid OTP request payload.' },
        { status: 400 }
      );
    }

    const { purpose, amountUsdt, network, destinationAddress } = parsed.data;
    let targetEmail = parsed.data.email?.trim().toLowerCase() || '';

    if (purpose === 'WITHDRAW') {
      const auth = await requireAuth(req);
      if (!auth.ok) return auth.response;
      targetEmail = auth.user.email.trim().toLowerCase();
    } else if (!targetEmail) {
      return NextResponse.json({ error: 'Valid email address is required.' }, { status: 400 });
    }

    const emailLimit = await rateLimiter.checkAsync(`otp-email:${purpose}:${targetEmail}`, 5, 900);
    if (!emailLimit.allowed) {
      return rateLimiter.rateLimitResponse(
        emailLimit.resetSeconds,
        'Too many verification codes sent to this email. Please wait before trying again.'
      );
    }

    if (!emailService.isConfigured()) {
      return NextResponse.json(
        { error: 'SMTP email service is not configured on the server.' },
        { status: 503 }
      );
    }

    const { code } = await createOtpChallenge({
      email: targetEmail,
      purpose,
      metadata:
        purpose === 'WITHDRAW'
          ? { amountUsdt, network, destinationAddress }
          : undefined,
    });

    await emailService.sendOtpEmail({
      to: targetEmail,
      code,
      purpose,
      amountUsdt,
      network,
      destinationAddress,
    });

    return NextResponse.json({
      success: true,
      email: targetEmail,
      purpose,
      message: 'A 6-digit verification code has been sent to your email.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not dispatch verification code.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

