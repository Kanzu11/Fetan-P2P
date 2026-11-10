import { NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { wsGateway } from '@/server/websocket-gateway';

export async function POST(req: Request) {
  try {
    const { userId, amountUsdt } = await req.json();

    if (!userId || !amountUsdt || amountUsdt <= 0) {
      return NextResponse.json({ error: 'Valid userId and positive amountUsdt required' }, { status: 400 });
    }

    const user = db.getUser(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Row-level lock mutation
    const updated = await db.withUserLock(userId, async (u) => {
      const newBal = Number((u.usdtBalance + Number(amountUsdt)).toFixed(6));
      return db.updateUser(userId, { usdtBalance: newBal });
    });

    // Emit real-time balance update
    wsGateway.emitToUser(userId, 'balance_updated', {
      usdtBalance: updated.usdtBalance,
      usdtLocked: updated.usdtLocked,
      addedAmount: Number(amountUsdt),
      message: `Deposit confirmed: +${amountUsdt} USDT (TRC-20)`
    });

    return NextResponse.json({
      success: true,
      user: updated,
      message: `Successfully deposited ${amountUsdt} USDT via internal custody listener`
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
