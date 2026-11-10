import { NextResponse } from 'next/server';
import { escrowController } from '@/server/escrow-controller';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { buyerId, proofReceiptUrl } = await req.json();
    if (!buyerId) {
      return NextResponse.json({ error: 'buyerId is required' }, { status: 400 });
    }

    const order = await escrowController.confirmPayment(params.id, buyerId, proofReceiptUrl);
    return NextResponse.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
