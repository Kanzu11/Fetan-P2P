import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { escrowController } from '@/server/escrow-controller';
import { sanitizeString } from '@/server/security/sanitize';
import { isAdminRole } from '@/client/types';

export const dynamic = 'force-dynamic';

const feedbackSchema = z.object({
  rating: z.enum(['POSITIVE', 'NEGATIVE']),
  comment: z.string().max(400).optional(),
});

export async function GET(
  req: Request,
  context: { params: { id: string } }
) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  await escrowController.sweepExpiredOrders().catch(() => {});

  const order = await db.getOrder(context.params.id);
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const isParticipant = order.buyerId === auth.user.id || order.sellerId === auth.user.id;
  if (!isParticipant && !isAdminRole(auth.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ order });
}

export async function POST(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const order = await db.getOrder(context.params.id);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.buyerId !== auth.user.id && order.sellerId !== auth.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rawBody = await req.json();
    const parsed = feedbackSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid feedback payload' },
        { status: 400 }
      );
    }

    const updated = await escrowController.leaveFeedback(
      order.id,
      auth.user.id,
      parsed.data.rating,
      sanitizeString(parsed.data.comment, 300) || undefined
    );

    return NextResponse.json({ success: true, order: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Feedback submission failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
