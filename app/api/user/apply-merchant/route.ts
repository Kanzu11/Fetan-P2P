import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { sanitizeString } from '@/server/security/sanitize';
import { telegramBot } from '@/server/telegram-bot';
import { wsGateway } from '@/server/websocket-gateway';
import type { MerchantApplication } from '@/client/types';

export const dynamic = 'force-dynamic';

const applyMerchantSchema = z.object({
  businessName: z.string().min(2, 'Trading desk or business name is required.').max(80),
  telegramHandle: z.string().min(2, 'Valid Telegram handle is required.').max(64),
  tradeExperience: z.string().max(1000).optional(),
  terms: z.string().max(1000).optional(),
  proofDocumentUrl: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const ip = getClientIp(req);
    const limit = await rateLimiter.checkAsync(`merchant-apply:${auth.user.id}:${ip}`, 5, 3600);
    if (!limit.allowed) {
      return rateLimiter.rateLimitResponse(
        limit.resetSeconds,
        'Too many merchant application requests. Please wait before trying again.'
      );
    }

    if (auth.user.kycStatus !== 'VERIFIED') {
      return NextResponse.json(
        { error: 'Please complete KYC verification before applying to become a merchant.' },
        { status: 403 }
      );
    }

    if (auth.user.merchantStatus === 'APPROVED' || auth.user.role === 'MERCHANT') {
      return NextResponse.json(
        { error: 'Your account is already an approved verified merchant.' },
        { status: 400 }
      );
    }

    if (auth.user.merchantStatus === 'PENDING') {
      return NextResponse.json(
        { error: 'Your merchant application is already pending review.' },
        { status: 409 }
      );
    }

    const rawBody = await req.json();
    const parsed = applyMerchantSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid merchant application payload.' },
        { status: 400 }
      );
    }

    const cleanBusinessName = sanitizeString(parsed.data.businessName, 80);
    const rawTg = sanitizeString(parsed.data.telegramHandle, 64);
    const cleanTelegram = rawTg.startsWith('@') ? rawTg : `@${rawTg}`;
    const cleanProofUrl = parsed.data.proofDocumentUrl?.trim();

    if (
      cleanProofUrl &&
      !cleanProofUrl.startsWith('/api/uploads/') &&
      !cleanProofUrl.startsWith('https://')
    ) {
      return NextResponse.json(
        { error: 'Document URL must be a secure upload (/api/uploads/...) or HTTPS URL.' },
        { status: 400 }
      );
    }

    const application: MerchantApplication = {
      id: `mapp-${crypto.randomUUID()}`,
      userId: auth.user.id,
      userEmail: auth.user.email,
      userName: auth.user.name,
      businessName: cleanBusinessName,
      telegramHandle: cleanTelegram,
      kycDocType: auth.user.kycDocType || 'NATIONAL_ID',
      kycDocNumber: auth.user.kycDocNumber || 'VERIFIED_ON_FILE',
      proofDocumentUrl: cleanProofUrl || undefined,
      usdtBalance: auth.user.usdtBalance,
      tradeExperience: sanitizeString(parsed.data.tradeExperience, 800) || undefined,
      terms: sanitizeString(parsed.data.terms, 800) || undefined,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
    };

    const saved = await db.saveMerchantApplication(application);
    const updatedUser = await db.updateUser(auth.user.id, {
      merchantStatus: 'PENDING',
      telegramHandle: cleanTelegram,
    });

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: 'MERCHANT_APPLIED',
      targetType: 'MerchantApplication',
      targetId: saved.id,
      ip,
      details: { businessName: cleanBusinessName, telegramHandle: cleanTelegram },
    });

    await telegramBot.sendMerchantApplicationAlert(saved);
    wsGateway.emitToRoom('admin:dashboard', 'merchant_application_submitted', {
      application: saved,
    });
    wsGateway.emitToUser(auth.user.id, 'user_updated', { user: updatedUser });

    return NextResponse.json({
      success: true,
      application: saved,
      user: updatedUser,
      message: 'Merchant desk application submitted for admin review.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Merchant application failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
