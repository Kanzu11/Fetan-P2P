import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      userId,
      action,
      paymentDetails,
      telegramHandle,
      telegramChatId,
      telegramNotifications,
      phone,
      withdrawAmount,
      destinationAddress,
    } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (action === 'WITHDRAW_USDT') {
      const amt = Number(withdrawAmount);
      if (isNaN(amt) || amt <= 0) {
        return NextResponse.json({ error: 'Invalid withdrawal amount' }, { status: 400 });
      }
      if (!destinationAddress || destinationAddress.trim().length < 10) {
        return NextResponse.json({ error: 'Valid destination wallet address is required' }, { status: 400 });
      }

      const updatedUser = await db.withUserLock(userId, async (user) => {
        if (user.usdtBalance < amt) {
          throw new Error(`Insufficient unlocked balance (Available: ${user.usdtBalance.toFixed(2)} USDT)`);
        }
        const nextBal = Number((user.usdtBalance - amt).toFixed(6));
        return db.updateUser(user.id, { usdtBalance: nextBal });
      });

      wsGateway.emitToUser(userId, 'balance_updated', {
        usdtBalance: updatedUser.usdtBalance,
        usdtLocked: updatedUser.usdtLocked,
      });

      return NextResponse.json({ success: true, user: updatedUser });
    }

    const user = db.getUser(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (action === 'GENERATE_TG_CODE') {
      const code = `FETAN-${user.name.split(' ')[0].toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const updatedUser = db.updateUser(userId, { telegramLinkCode: code });
      return NextResponse.json({ success: true, user: updatedUser, code });
    }

    const cleanHandle =
      telegramHandle !== undefined
        ? telegramHandle.trim()
          ? `@${telegramHandle.trim().replace(/^@/, '')}`
          : ''
        : user.telegramHandle;

    const updatedUser = db.updateUser(userId, {
      paymentDetails: paymentDetails ? { ...user.paymentDetails, ...paymentDetails } : user.paymentDetails,
      telegramHandle: cleanHandle,
      telegramChatId: telegramChatId !== undefined ? String(telegramChatId).trim() || undefined : user.telegramChatId,
      telegramNotifications:
        telegramNotifications !== undefined ? Boolean(telegramNotifications) : user.telegramNotifications,
      phone: phone !== undefined ? phone : user.phone,
    });

    void telegramBot.syncWithTelegramCloud('UPSERT_USER', { user: updatedUser });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
