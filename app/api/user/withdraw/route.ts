import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { validateCryptoAddress, sanitizeAmount } from '@/server/security/sanitize';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';
import { WalletTransaction } from '@/client/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);

    // Rate limit: 5 withdrawal attempts per 30 minutes per IP
    const limitCheck = rateLimiter.check(`withdraw:${ip}`, 5, 1800);
    if (!limitCheck.allowed) {
      return rateLimiter.rateLimitResponse(
        limitCheck.resetSeconds,
        'Withdrawal rate limit reached. For security, withdrawals are limited to 5 per 30 minutes.'
      );
    }

    const body = await req.json();
    const { userId, destinationAddress, network = 'TRC20', amount } = body;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'User ID is required.' }, { status: 400 });
    }

    // 1. Validate Amount
    const amountCheck = sanitizeAmount(amount, 5, 500_000);
    if (!amountCheck.valid) {
      return NextResponse.json(
        { error: amountCheck.error || 'Minimum withdrawal is 5 USDT.' },
        { status: 400 }
      );
    }
    const withdrawAmount = amountCheck.amount;

    // 2. Validate Network & Destination Address
    const supportedNetworks = ['TRC20', 'BEP20', 'TON'];
    const cleanNetwork = String(network).toUpperCase() as 'TRC20' | 'BEP20' | 'TON';
    if (!supportedNetworks.includes(cleanNetwork)) {
      return NextResponse.json(
        { error: 'Unsupported network. Supported networks are TRC20, BEP20, and TON.' },
        { status: 400 }
      );
    }

    const addrCheck = validateCryptoAddress(destinationAddress, cleanNetwork);
    if (!addrCheck.valid) {
      return NextResponse.json({ error: addrCheck.error }, { status: 400 });
    }

    // 3. User verification and atomic balance deduction
    const tx = await db.withUserLock(userId, async (user) => {
      // Security Check: KYC must be verified to withdraw
      if (user.kycStatus !== 'VERIFIED') {
        throw new Error(
          'Account KYC verification is required before initiating external crypto withdrawals. Please submit your ID under KYC verification.'
        );
      }

      if (user.usdtBalance < withdrawAmount) {
        throw new Error(
          `Insufficient available balance. You have ${user.usdtBalance.toFixed(2)} USDT available, but attempted to withdraw ${withdrawAmount} USDT.`
        );
      }

      // Deduct available balance
      const newBalance = Math.round((user.usdtBalance - withdrawAmount) * 100) / 100;
      db.updateUser(user.id, {
        usdtBalance: newBalance,
      });

      const txRecord: WalletTransaction = {
        id: `tx-wd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        userId: user.id,
        type: 'WITHDRAW',
        amount: withdrawAmount,
        network: cleanNetwork,
        address: destinationAddress.trim(),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        note: `Withdrawal of ${withdrawAmount} USDT to ${destinationAddress.trim()} via ${cleanNetwork}`,
      };

      db.saveWalletTransaction(txRecord);
      return { txRecord, newBalance, user };
    });

    // 4. Notify Superadmin and User
    try {
      wsGateway.emitToRoom('admin:dashboard', 'new_withdrawal', tx.txRecord);
      wsGateway.emitToUser(userId, 'balance_updated', {
        usdtBalance: tx.newBalance,
        transaction: tx.txRecord,
      });

      // Telegram alert to superadmin
      const adminAlert =
        `🚨 <b>New Withdrawal Request</b>\n` +
        `• <b>User:</b> ${tx.user.name} (${tx.user.telegramHandle || tx.user.email})\n` +
        `• <b>Amount:</b> ${withdrawAmount} USDT\n` +
        `• <b>Network:</b> ${cleanNetwork}\n` +
        `• <b>To Address:</b> <code>${destinationAddress.trim()}</code>\n` +
        `• <b>Status:</b> PENDING ONSITE DISPATCH`;
      await telegramBot.broadcastAdminAlert(adminAlert);

      // Telegram alert to user if linked
      if (tx.user.telegramChatId) {
        const userMsg =
          `📤 <b>Withdrawal Submitted</b>\n` +
          `You have requested a withdrawal of <b>${withdrawAmount} USDT</b> on the <b>${cleanNetwork}</b> network.\n` +
          `• <b>Destination:</b> <code>${destinationAddress.trim()}</code>\n` +
          `Your remaining available balance is <b>${tx.newBalance} USDT</b>.`;
        await telegramBot.sendMessage(tx.user.telegramChatId, userMsg);
      }
    } catch (notifyErr) {
      console.warn('Notification delivery error:', notifyErr);
    }

    return NextResponse.json({
      success: true,
      transaction: tx.txRecord,
      newBalance: tx.newBalance,
      message: `Withdrawal of ${withdrawAmount} USDT initiated. Transaction ID: ${tx.txRecord.id}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Withdrawal processing failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

