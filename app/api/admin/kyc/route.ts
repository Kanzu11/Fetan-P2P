import { NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { telegramBot } from '@/server/telegram-bot';

export async function GET() {
  const kycSubmissions = db.getKycSubmissions();
  return NextResponse.json({ kycSubmissions });
}

export async function POST(req: Request) {
  try {
    const { kycId, action, reviewedBy } = await req.json();

    if (!kycId || !action) {
      return NextResponse.json({ error: 'kycId and action (APPROVE/REJECT) required' }, { status: 400 });
    }

    const isApprove = action.toUpperCase() === 'APPROVE';
    const result = await telegramBot.handleKycApproval(
      kycId,
      reviewedBy || 'Admin Web Console',
      isApprove
    );

    return NextResponse.json({ success: true, submission: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
