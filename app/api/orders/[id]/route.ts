import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { escrowController } from '@/server/escrow-controller';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const order = db.getOrder(params.id);
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  return NextResponse.json({ order });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { userId, rating, comment } = await req.json();
    if (!userId || (rating !== 'POSITIVE' && rating !== 'NEGATIVE')) {
      return NextResponse.json(
        { error: 'Please select Positive or Negative feedback.' },
        { status: 400 }
      );
    }

    const order = await escrowController.leaveFeedback(params.id, userId, rating, comment);
    return NextResponse.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not save feedback.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
