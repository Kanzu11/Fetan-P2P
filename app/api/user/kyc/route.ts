import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';
import { KycSubmission, KycDocType } from '@/client/types';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { sanitizeString } from '@/server/security/sanitize';

const VALID_DOC_TYPES: KycDocType[] = ['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE'];

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);

    // Rate limit: 5 KYC attempts per hour per IP
    const limitCheck = rateLimiter.check(`kyc:${ip}`, 5, 3600);
    if (!limitCheck.allowed) {
      return rateLimiter.rateLimitResponse(
        limitCheck.resetSeconds,
        'KYC submission rate limit reached. Please wait before submitting additional applications.'
      );
    }

    const { userId, docType, docNumber, docPhotoUrl, source } = await req.json();

    if (!userId || !docType || !docNumber) {
      return NextResponse.json({ error: 'userId, docType, and docNumber are required' }, { status: 400 });
    }

    if (!docPhotoUrl || typeof docPhotoUrl !== 'string' || !docPhotoUrl.startsWith('http')) {
      return NextResponse.json({ error: 'A clear photo of your government ID or Fayda slip is required.' }, { status: 400 });
    }

    if (!VALID_DOC_TYPES.includes(docType as KycDocType)) {
      return NextResponse.json({ error: 'Invalid document type. Allowed: NATIONAL_ID, PASSPORT, DRIVERS_LICENSE' }, { status: 400 });
    }

    const cleanDocNumber = sanitizeString(docNumber, 50);
    if (cleanDocNumber.length < 4) {
      return NextResponse.json({ error: 'Document number must be at least 4 characters long' }, { status: 400 });
    }

    const user = db.getUser(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    db.updateUser(userId, {
      kycStatus: 'PENDING',
      kycDocType: docType as KycDocType,
      kycDocNumber: cleanDocNumber,
      kycSubmittedAt: new Date().toISOString(),
    });

    const submission: KycSubmission = {
      id: `kyc-${Date.now()}`,
      userId,
      userEmail: user.email,
      userName: user.name,
      telegramHandle: user.telegramHandle,
      source: source || 'WEB',
      kycDocType: docType as KycDocType,
      kycDocNumber: cleanDocNumber,
      docPhotoUrl,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
    };

    db.saveKycSubmission(submission);

    wsGateway.emitToRoom('admin:dashboard', 'new_kyc_submission', submission);
    void telegramBot.sendKycSubmissionAlert(submission);

    return NextResponse.json({
      success: true,
      submission,
      message: 'ID submitted. Superadmin (@kanzedin) notified via Telegram and email.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
