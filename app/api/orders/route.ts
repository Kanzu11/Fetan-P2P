import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { escrowController } from '@/server/escrow-controller';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  let orders = db.getAllOrders();
  if (userId) {
    orders = orders.filter((o) => o.buyerId === userId || o.sellerId === userId);
  }
  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  try {
    const {
      offerId,
      buyerId,
      usdtAmount,
      paymentMethod,
      sellerAccountNumber,
      sellerAccountName,
    } = await req.json();

    if (!offerId || !buyerId || !usdtAmount || !paymentMethod) {
      return NextResponse.json(
        { error: 'Please select an amount and payment method.' },
        { status: 400 }
      );
    }

    const order = await escrowController.lockEscrow({
      offerId,
      buyerId,
      usdtAmount: Number(usdtAmount),
      paymentMethod,
      sellerAccountNumber,
      sellerAccountName,
    });

    return NextResponse.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not create order.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
