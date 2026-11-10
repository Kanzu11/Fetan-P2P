import { NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { telegramBot } from '@/server/telegram-bot';

export async function GET() {
  const applications = db.getMerchantApplications();
  return NextResponse.json({ applications });
}

export async function POST(req: Request) {
  try {
    const { applicationId, action, reviewedBy } = await req.json();

    if (!applicationId || !action) {
      return NextResponse.json({ error: 'applicationId and action (APPROVE/REJECT) required' }, { status: 400 });
    }

    const isApprove = action.toUpperCase() === 'APPROVE';
    const result = await telegramBot.handleMerchantApproval(
      applicationId,
      reviewedBy || 'Admin Web Console',
      isApprove
    );

    return NextResponse.json({ success: true, application: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
