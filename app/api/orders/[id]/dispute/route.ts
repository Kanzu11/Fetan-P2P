import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/security/session';
import { escrowController } from '@/server/escrow-controller';
import { sanitizeString } from '@/server/security/sanitize';

export const dynamic = 'force-dynamic';

const disputeSchema = z.object({
  reason: z.string().min(4, 'Please describe the reason for the appeal.').max(400),
});

export async function POST(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const rawBody = await req.json();
    const parsed = disputeSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Appeal reason required.' },
        { status: 400 }
      );
    }

    const cleanReason = sanitizeString(parsed.data.reason, 350);
    if (cleanReason.length < 4) {
      return NextResponse.json({ error: 'Appeal reason must be descriptive.' }, { status: 400 });
    }

    const order = await escrowController.disputeTrade(
      context.params.id,
      auth.user.id,
      cleanReason
    );

    return NextResponse.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to open dispute';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
