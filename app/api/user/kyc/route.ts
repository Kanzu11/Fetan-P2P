import { NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';
import { KycSubmission, KycDocType } from '@/lib/types';

const VALID_DOC_TYPES: KycDocType[] = ['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE'];

export async function POST(req: Request) {
  try {
    const { userId, docType, docNumber, docPhotoUrl, source } = await req.json();

    if (!userId || !docType || !docNumber) {
      return NextResponse.json({ error: 'userId, docType, and docNumber are required' }, { status: 400 });
    }

    if (!VALID_DOC_TYPES.includes(docType as KycDocType)) {
      return NextResponse.json({ error: 'Invalid document type. Allowed: NATIONAL_ID, PASSPORT, DRIVERS_LICENSE' }, { status: 400 });
    }

    const cleanDocNumber = String(docNumber).trim().slice(0, 50);
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
      docPhotoUrl:
        docPhotoUrl || 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=600&auto=format&fit=crop',
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
