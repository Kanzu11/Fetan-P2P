import { NextResponse } from 'next/server';
import { escrowController } from '@/server/escrow-controller';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { sellerId, userId, note } = await req.json();
    const actorId = sellerId || userId;
    if (!actorId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const order = await escrowController.releaseEscrow(params.id, actorId, note);
    return NextResponse.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not complete order.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
