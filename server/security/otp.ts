import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/database/prisma';

export type OtpPurpose = 'LOGIN' | 'WITHDRAW';

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

function getOtpSecret(): string {
  return process.env.JWT_SECRET?.trim() || 'fetan-otp-dev-secret';
}

export function hashOtpCode(email: string, purpose: OtpPurpose, code: string): string {
  const cleanEmail = email.trim().toLowerCase();
  return crypto
    .createHmac('sha256', getOtpSecret())
    .update(`${cleanEmail}:${purpose}:${code.trim()}`)
    .digest('hex');
}

export async function createOtpChallenge(params: {
  email: string;
  purpose: OtpPurpose;
  metadata?: Record<string, unknown>;
}): Promise<{ challengeId: string; code: string; expiresAt: Date }> {
  const cleanEmail = params.email.trim().toLowerCase();
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashOtpCode(cleanEmail, params.purpose, code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  // Invalidate previous unconsumed challenges for same email & purpose
  await prisma.otpChallenge.updateMany({
    where: {
      email: cleanEmail,
      purpose: params.purpose,
      consumedAt: null,
    },
    data: {
      consumedAt: new Date(),
    },
  });

  const challenge = await prisma.otpChallenge.create({
    data: {
      email: cleanEmail,
      purpose: params.purpose,
      codeHash,
      maxAttempts: OTP_MAX_ATTEMPTS,
      metadata: (params.metadata as Prisma.InputJsonValue) || undefined,
      expiresAt,
    },
  });

  return { challengeId: challenge.id, code, expiresAt };
}

export async function verifyAndConsumeOtp(params: {
  email: string;
  purpose: OtpPurpose;
  code: string;
}): Promise<{ valid: boolean; error?: string; metadata?: Record<string, unknown> | null }> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanCode = params.code.trim();

  if (!/^\d{6}$/.test(cleanCode)) {
    return { valid: false, error: 'Verification code must be 6 digits.' };
  }

  return prisma.$transaction(
    async (tx) => {
      const challenge = await tx.otpChallenge.findFirst({
        where: {
          email: cleanEmail,
          purpose: params.purpose,
          consumedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!challenge) {
        return { valid: false, error: 'No active verification code found. Please request a new code.' };
      }

      if (challenge.expiresAt <= new Date()) {
        await tx.otpChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        });
        return { valid: false, error: 'Verification code expired. Please request a new code.' };
      }

      if (challenge.attempts >= challenge.maxAttempts) {
        await tx.otpChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        });
        return {
          valid: false,
          error: 'Too many invalid attempts. Please request a new verification code.',
        };
      }

      const expectedHash = hashOtpCode(cleanEmail, params.purpose, cleanCode);
      const matches = crypto.timingSafeEqual(
        Buffer.from(challenge.codeHash, 'hex'),
        Buffer.from(expectedHash, 'hex')
      );

      if (!matches) {
        const nextAttempts = challenge.attempts + 1;
        await tx.otpChallenge.update({
          where: { id: challenge.id },
          data: {
            attempts: nextAttempts,
            consumedAt: nextAttempts >= challenge.maxAttempts ? new Date() : null,
          },
        });
        const remaining = Math.max(0, challenge.maxAttempts - nextAttempts);
        return {
          valid: false,
          error:
            remaining > 0
              ? `Invalid verification code. ${remaining} attempt(s) remaining.`
              : 'Invalid verification code. Too many failures — request a new code.',
        };
      }

      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });

      return {
        valid: true,
        metadata: (challenge.metadata as Record<string, unknown> | null) || null,
      };
    },
    { maxWait: 15000, timeout: 60000 }
  );
}

