import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { sanitizeString } from '@/server/security/sanitize';
import { telegramBot } from '@/server/telegram-bot';
import { wsGateway } from '@/server/websocket-gateway';
import type { KycSubmission } from '@/client/types';

export const dynamic = 'force-dynamic';

function isAllowedDocUrl(url: string): boolean {
  return url.startsWith('/api/uploads/') || url.startsWith('https://');
}

const kycSchema = z.object({
  docType: z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE']),
  docNumber: z.string().min(4, 'Document ID number must be at least 4 characters.').max(60),
  docPhotoUrl: z.string().min(5).max(500).optional(),
  source: z
    .enum(['WEB', 'MINI_APP', 'TELEGRAM_MINIAPP', 'TELEGRAM_BOT'])
    .default('WEB')
    .transform((v): 'WEB' | 'MINI_APP' | 'TELEGRAM_BOT' =>
      v === 'TELEGRAM_MINIAPP' ? 'MINI_APP' : v
    ),
});

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const ip = getClientIp(req);
    const limit = await rateLimiter.checkAsync(`kyc:${auth.user.id}:${ip}`, 5, 3600);
    if (!limit.allowed) {
      return rateLimiter.rateLimitResponse(
        limit.resetSeconds,
        'Too many KYC submissions. Please wait before submitting again.'
      );
    }

    if (auth.user.kycStatus === 'VERIFIED') {
      return NextResponse.json(
        { error: 'Your identity is already KYC verified.' },
        { status: 400 }
      );
    }

    if (auth.user.kycStatus === 'PENDING') {
      return NextResponse.json(
        { error: 'A KYC submission is already pending admin review.' },
        { status: 409 }
      );
    }

    const rawBody = await req.json();
    const parsed = kycSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid KYC submission data.' },
        { status: 400 }
      );
    }

    const cleanDocNumber = sanitizeString(parsed.data.docNumber, 60);
    if (cleanDocNumber.length < 4) {
      return NextResponse.json(
        { error: 'Valid document ID number is required.' },
        { status: 400 }
      );
    }

    const cleanPhotoUrl = parsed.data.docPhotoUrl?.trim();
    if (cleanPhotoUrl && !isAllowedDocUrl(cleanPhotoUrl)) {
      return NextResponse.json(
        { error: 'Uploaded ID image URL must come from secure platform upload (/api/uploads/...) or HTTPS.' },
        { status: 400 }
      );
    }

    const submission: KycSubmission = {
      id: `kyc-${crypto.randomUUID()}`,
      userId: auth.user.id,
      userEmail: auth.user.email,
      userName: auth.user.name,
      telegramHandle: auth.user.telegramHandle,
      source: parsed.data.source,
      kycDocType: parsed.data.docType,
      kycDocNumber: cleanDocNumber,
      docPhotoUrl: cleanPhotoUrl,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
    };

    const saved = await db.saveKycSubmission(submission);
    const updatedUser = await db.updateUser(auth.user.id, {
      kycStatus: 'PENDING',
      kycDocType: parsed.data.docType,
      kycDocNumber: cleanDocNumber,
      kycSubmittedAt: submission.submittedAt,
    });

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: 'KYC_SUBMITTED',
      targetType: 'KycSubmission',
      targetId: saved.id,
      ip,
      details: { docType: parsed.data.docType, source: parsed.data.source },
    });

    await telegramBot.sendKycSubmissionAlert(saved);
    wsGateway.emitToRoom('admin:dashboard', 'kyc_submitted', { submission: saved });
    wsGateway.emitToUser(auth.user.id, 'user_updated', { user: updatedUser });

    return NextResponse.json({
      success: true,
      submission: saved,
      user: updatedUser,
      message: 'KYC verification submitted and sent to admins for review.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'KYC submission failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
