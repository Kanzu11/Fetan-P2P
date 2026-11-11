import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { validateTxHash, sanitizeAmount } from '@/server/security/sanitize';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';
import { WalletTransaction } from '@/client/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);

    // Rate limit: 10 deposit submissions per 15 minutes per IP
    const limitCheck = rateLimiter.check(`deposit-verify:${ip}`, 10, 900);
    if (!limitCheck.allowed) {
      return rateLimiter.rateLimitResponse(
        limitCheck.resetSeconds,
        'Deposit submission rate limit reached. Please wait before submitting another transaction hash.'
      );
    }

    const body = await req.json();
    const { userId, txHash, network = 'TRC20', amount } = body;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'User ID is required.' }, { status: 400 });
    }

    // 1. Validate TxHash format
    const hashCheck = validateTxHash(txHash, network);
    if (!hashCheck.valid) {
      return NextResponse.json({ error: hashCheck.error }, { status: 400 });
    }
    const cleanHash = txHash.trim();

    // 2. Anti-Replay / Double-Spend Protection
    const existingTx = db.findWalletTransactionByTxHash(cleanHash);
    if (existingTx) {
      return NextResponse.json(
        {
          error: `Transaction hash ${cleanHash.slice(0, 10)}... has already been submitted or credited on ${existingTx.createdAt}.`,
        },
        { status: 400 }
      );
    }

    // 3. Validate Amount
    const amountCheck = sanitizeAmount(amount, 1, 1_000_000);
    if (!amountCheck.valid) {
      return NextResponse.json(
        { error: amountCheck.error || 'Please enter a valid deposit amount (min 1 USDT).' },
        { status: 400 }
      );
    }
    const depositAmount = amountCheck.amount;

    // 4. Validate Network
    const cleanNetwork = String(network).toUpperCase() as 'TRC20' | 'BEP20' | 'TON';
    if (!['TRC20', 'BEP20', 'TON'].includes(cleanNetwork)) {
      return NextResponse.json({ error: 'Unsupported network.' }, { status: 400 });
    }

    // 5. Atomic user balance credit and ledger logging
    const tx = await db.withUserLock(userId, async (user) => {
      const newBalance = Math.round((user.usdtBalance + depositAmount) * 100) / 100;
      db.updateUser(user.id, {
        usdtBalance: newBalance,
      });

      const txRecord: WalletTransaction = {
        id: `tx-dp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        userId: user.id,
        type: 'DEPOSIT',
        amount: depositAmount,
        network: cleanNetwork,
        txHash: cleanHash,
        status: 'COMPLETED',
        createdAt: new Date().toISOString(),
        note: `On-chain deposit credited: ${depositAmount} USDT via ${cleanNetwork} (TxID: ${cleanHash.slice(0, 14)}...)`,
      };

      db.saveWalletTransaction(txRecord);
      return { txRecord, newBalance, user };
    });

    // 6. Blockchain Explorer links for audit
    const explorerUrl =
      cleanNetwork === 'TRC20'
        ? `https://tronscan.org/#/transaction/${cleanHash}`
        : cleanNetwork === 'BEP20'
        ? `https://bscscan.com/tx/${cleanHash}`
        : `https://tonviewer.com/transaction/${cleanHash}`;

    // 7. Notify Superadmin and User
    try {
      wsGateway.emitToRoom('admin:dashboard', 'new_deposit', tx.txRecord);
      wsGateway.emitToUser(userId, 'balance_updated', {
        usdtBalance: tx.newBalance,
        transaction: tx.txRecord,
      });

      const adminAlert =
        `💰 <b>On-Chain Deposit Credited</b>\n` +
        `• <b>User:</b> ${tx.user.name} (${tx.user.telegramHandle || tx.user.email})\n` +
        `• <b>Amount:</b> +${depositAmount} USDT\n` +
        `• <b>Network:</b> ${cleanNetwork}\n` +
        `• <b>TxHash:</b> <code>${cleanHash}</code>\n` +
        `• <b>Explorer:</b> <a href="${explorerUrl}">View Blockchain Record</a>\n` +
        `• <b>New Total Balance:</b> ${tx.newBalance} USDT`;
      await telegramBot.broadcastAdminAlert(adminAlert);

      if (tx.user.telegramChatId) {
        const userMsg =
          `📥 <b>Deposit Credited</b>\n` +
          `Your deposit of <b>+${depositAmount} USDT</b> on <b>${cleanNetwork}</b> has been credited to your Fetan wallet!\n` +
          `• <b>TxID:</b> <code>${cleanHash.slice(0, 16)}...</code>\n` +
          `• <b>Available Balance:</b> <b>${tx.newBalance} USDT</b>`;
        await telegramBot.sendMessage(tx.user.telegramChatId, userMsg);
      }
    } catch (err) {
      console.warn('Deposit alert error:', err);
    }

    return NextResponse.json({
      success: true,
      transaction: tx.txRecord,
      newBalance: tx.newBalance,
      explorerUrl,
      message: `Deposit of ${depositAmount} USDT verified and credited successfully!`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Deposit verification failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

