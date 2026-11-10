import { NextResponse } from 'next/server';
import { escrowController } from '@/server/escrow-controller';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { userId, reason } = await req.json();
    if (!userId || !reason) {
      return NextResponse.json({ error: 'userId and reason are required' }, { status: 400 });
    }

    const order = await escrowController.disputeTrade(params.id, userId, reason);
    return NextResponse.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
