import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAdmin } from '@/server/security/session';
import { getClientIp } from '@/server/security/rate-limiter';
import { sanitizeString, validateTxHash } from '@/server/security/sanitize';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';

export const dynamic = 'force-dynamic';

const withdrawalReviewSchema = z.object({
  txId: z.string().min(1),
  action: z.enum(['APPROVE', 'REJECT']),
  txHash: z.string().max(160).optional(),
  note: z.string().max(300).optional(),
});

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const [allTx, allUsers] = await Promise.all([
    db.getWalletTransactions(),
    db.getAllUsers(),
  ]);

  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const withdrawals = allTx
    .filter((tx) => tx.type === 'WITHDRAW')
    .map((tx) => {
      const owner = userMap.get(tx.userId);
      return {
        ...tx,
        userName: owner?.name || tx.userId,
        userEmail: owner?.email || '',
        telegramHandle: owner?.telegramHandle,
      };
    });

  return NextResponse.json({ withdrawals });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;

    const rawBody = await req.json();
    const parsed = withdrawalReviewSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid withdrawal review payload' },
        { status: 400 }
      );
    }

    const { txId, action, txHash, note } = parsed.data;
    const existing = await db.getWalletTransaction(txId);
    if (!existing || existing.type !== 'WITHDRAW') {
      return NextResponse.json({ error: 'Withdrawal request not found.' }, { status: 404 });
    }

    if (existing.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Withdrawal is already ${existing.status}.` },
        { status: 409 }
      );
    }

    const cleanTxHash = txHash ? txHash.trim() : '';
    if (action === 'APPROVE') {
      const hashCheck = validateTxHash(cleanTxHash, existing.network);
      if (!hashCheck.valid) {
        return NextResponse.json(
          { error: hashCheck.error || 'Valid payout TxID hash is required to approve withdrawal.' },
          { status: 400 }
        );
      }

      const duplicate = await db.findWalletTransactionByTxHash(cleanTxHash);
      if (duplicate && duplicate.id !== existing.id) {
        return NextResponse.json(
          { error: 'This transaction hash is already linked to another transaction.' },
          { status: 409 }
        );
      }
    }

    const cleanNote = sanitizeString(note, 250);
    const result = await db.withUserLock(existing.userId, async (lockedUser) => {
      const latestTx = await db.getWalletTransaction(txId);
      if (!latestTx || latestTx.status !== 'PENDING') {
        throw new Error('Withdrawal has already been processed.');
      }

      let updatedUser = lockedUser;
      if (action === 'REJECT') {
        const refundedBal = Number((lockedUser.usdtBalance + latestTx.amount).toFixed(6));
        updatedUser = await db.updateUser(lockedUser.id, { usdtBalance: refundedBal });
      }

      const savedTx = await db.saveWalletTransaction({
        ...latestTx,
        status: action === 'APPROVE' ? 'COMPLETED' : 'REJECTED',
        txHash: action === 'APPROVE' ? cleanTxHash : latestTx.txHash,
        reviewedBy: auth.user.id,
        note:
          cleanNote ||
          (action === 'APPROVE'
            ? `Approved and dispatched by ${auth.user.name}`
            : `Rejected and refunded to wallet by ${auth.user.name}`),
      });

      return { savedTx, updatedUser };
    });

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: action === 'APPROVE' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED_REFUNDED',
      targetType: 'WalletTransaction',
      targetId: txId,
      ip: getClientIp(req),
      details: {
        userId: existing.userId,
        amount: existing.amount,
        network: existing.network,
        txHash: action === 'APPROVE' ? cleanTxHash : undefined,
      },
    });

    wsGateway.emitToUser(existing.userId, 'balance_updated', {
      usdtBalance: result.updatedUser.usdtBalance,
      usdtLocked: result.updatedUser.usdtLocked,
      message:
        action === 'APPROVE'
          ? `Withdrawal of ${existing.amount} USDT (${existing.network}) sent!`
          : `Withdrawal of ${existing.amount} USDT rejected and refunded to available balance.`,
    });
    wsGateway.emitToRoom('admin:dashboard', 'withdrawal_updated', { tx: result.savedTx });

    if (result.updatedUser.telegramChatId) {
      await telegramBot.sendTelegramMessage(
        result.updatedUser.telegramChatId,
        action === 'APPROVE'
          ? `✅ *Withdrawal Sent*\n\nAmount: *${existing.amount} USDT* (${existing.network})\nTxHash: \`${cleanTxHash}\``
          : `↩️ *Withdrawal Rejected & Refunded*\n\nAmount: *${existing.amount} USDT* has been returned to your available wallet balance.\nReason: ${cleanNote || 'Rejected by review'}`
      );
    }

    return NextResponse.json({
      success: true,
      transaction: result.savedTx,
      user: result.updatedUser,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

