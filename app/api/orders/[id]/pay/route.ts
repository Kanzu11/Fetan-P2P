import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/security/session';
import { escrowController } from '@/server/escrow-controller';
import { isAllowedPlatformAssetUrl } from '@/server/security/sanitize';

export const dynamic = 'force-dynamic';

const payOrderSchema = z.object({
  proofReceiptUrl: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    let rawBody: Record<string, unknown> = {};
    try {
      rawBody = await req.json();
    } catch {
      rawBody = {};
    }

    const parsed = payOrderSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payment payload' }, { status: 400 });
    }

    const proof = parsed.data.proofReceiptUrl?.trim();
    if (proof && !isAllowedPlatformAssetUrl(proof)) {
      return NextResponse.json(
        { error: 'Receipt URL must come from platform upload (/api/uploads/...) or verified Cloudinary storage.' },
        { status: 400 }
      );
    }

    const order = await escrowController.confirmPayment(
      context.params.id,
      auth.user.id,
      proof
    );

    return NextResponse.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not confirm payment';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
