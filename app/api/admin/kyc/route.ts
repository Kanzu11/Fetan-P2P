import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { telegramBot } from '@/server/telegram-bot';
import { requireAdmin } from '@/server/security/session';
import { getClientIp } from '@/server/security/rate-limiter';

export const dynamic = 'force-dynamic';

const kycReviewSchema = z.object({
  kycId: z.string().min(1),
  action: z.enum(['APPROVE', 'REJECT']),
});

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const kycSubmissions = await db.getKycSubmissions();
  return NextResponse.json({ kycSubmissions });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;

    const rawBody = await req.json();
    const normalized = {
      kycId: rawBody?.kycId,
      action:
        typeof rawBody?.action === 'string'
          ? rawBody.action.trim().toUpperCase()
          : rawBody?.action,
    };

    const parsed = kycReviewSchema.safeParse(normalized);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'kycId and action (APPROVE/REJECT) required' },
        { status: 400 }
      );
    }

    const { kycId, action } = parsed.data;
    const isApprove = action === 'APPROVE';
    const reviewerLabel = `${auth.user.name} (${auth.user.email})`;

    const result = await telegramBot.handleKycApproval(kycId, reviewerLabel, isApprove);

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: isApprove ? 'KYC_APPROVED' : 'KYC_REJECTED',
      targetType: 'KycSubmission',
      targetId: kycId,
      ip: getClientIp(req),
      details: { userId: result.userId },
    });

    return NextResponse.json({ success: true, submission: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
