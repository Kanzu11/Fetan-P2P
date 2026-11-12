import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { telegramBot } from '@/server/telegram-bot';
import { requireAdmin } from '@/server/security/session';
import { getClientIp } from '@/server/security/rate-limiter';

export const dynamic = 'force-dynamic';

const merchantReviewSchema = z.object({
  applicationId: z.string().min(1),
  action: z.enum(['APPROVE', 'REJECT']),
});

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const applications = await db.getMerchantApplications();
  return NextResponse.json({ applications });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;

    const rawBody = await req.json();
    const normalized = {
      applicationId: rawBody?.applicationId,
      action:
        typeof rawBody?.action === 'string'
          ? rawBody.action.trim().toUpperCase()
          : rawBody?.action,
    };

    const parsed = merchantReviewSchema.safeParse(normalized);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'applicationId and action (APPROVE/REJECT) required' },
        { status: 400 }
      );
    }

    const { applicationId, action } = parsed.data;
    const isApprove = action === 'APPROVE';
    const reviewerLabel = `${auth.user.name} (${auth.user.email})`;

    const result = await telegramBot.handleMerchantApproval(
      applicationId,
      reviewerLabel,
      isApprove
    );

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: isApprove ? 'MERCHANT_APPROVED' : 'MERCHANT_REJECTED',
      targetType: 'MerchantApplication',
      targetId: applicationId,
      ip: getClientIp(req),
      details: { userId: result.userId },
    });

    return NextResponse.json({ success: true, application: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
