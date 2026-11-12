import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/security/session';
import { escrowController } from '@/server/escrow-controller';
import { sanitizeString } from '@/server/security/sanitize';

export const dynamic = 'force-dynamic';

const releaseSchema = z.object({
  note: z.string().max(300).optional(),
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

    const parsed = releaseSchema.safeParse(rawBody);
    const note = parsed.success ? sanitizeString(parsed.data.note, 250) : undefined;

    const order = await escrowController.releaseEscrow(
      context.params.id,
      auth.user.id,
      note || undefined
    );

    return NextResponse.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to complete release';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
