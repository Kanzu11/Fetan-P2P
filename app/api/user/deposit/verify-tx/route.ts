import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { validateTxHash } from '@/server/security/sanitize';
import { generateUserDepositAddresses, isDepositConfigured } from '@/server/crypto-address-service';
import { verifyOnChainUsdtDeposit } from '@/server/blockchain/verify-deposit';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';

export const dynamic = 'force-dynamic';

const verifyDepositSchema = z.object({
  network: z.enum(['TRC20', 'BEP20', 'TON']),
  txHash: z.string().min(10, 'Valid transaction hash is required.').max(140),
  amountUsdt: z.number().positive().optional(),
});

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const ip = getClientIp(req);
    const limit = await rateLimiter.checkAsync(`verify-tx:${auth.user.id}:${ip}`, 10, 900);
    if (!limit.allowed) {
      return rateLimiter.rateLimitResponse(
        limit.resetSeconds,
        'Too many deposit verification attempts. Please wait before trying again.'
      );
    }

    const rawBody = await req.json();
    const parsed = verifyDepositSchema.safeParse({
      ...rawBody,
      amountUsdt:
        rawBody?.amountUsdt !== undefined
          ? Number(rawBody.amountUsdt)
          : rawBody?.amount !== undefined
          ? Number(rawBody.amount)
          : undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid deposit verification payload.' },
        { status: 400 }
      );
    }

    const { network, txHash } = parsed.data;
    const cleanTxHash = txHash.trim();

    const hashCheck = validateTxHash(cleanTxHash, network);
    if (!hashCheck.valid) {
      return NextResponse.json(
        { error: hashCheck.error || 'Invalid transaction hash format for selected network.' },
        { status: 400 }
      );
    }

    const alreadyClaimed = await db.findWalletTransactionByTxHash(cleanTxHash);
    if (alreadyClaimed) {
      return NextResponse.json(
        { error: 'This transaction hash has already been verified and credited.' },
        { status: 409 }
      );
    }

    if (!isDepositConfigured()) {
      return NextResponse.json(
        {
          error:
            'Custody deposit nodes are not configured yet (DEPOSIT_XPUB / DEPOSIT_TON_ADDRESS). Contact support.',
        },
        { status: 503 }
      );
    }

    const userAddresses = generateUserDepositAddresses(auth.user.id);
    const verified = await verifyOnChainUsdtDeposit({
      network,
      txHash: cleanTxHash,
      userAddresses,
    });

    const result = await db.withUserLock(auth.user.id, async (lockedUser) => {
      const recheck = await db.findWalletTransactionByTxHash(cleanTxHash);
      if (recheck) {
        throw new Error('This transaction hash has already been verified and credited.');
      }

      const newBalance = Number((lockedUser.usdtBalance + verified.amountUsdt).toFixed(6));
      const updatedUser = await db.updateUser(lockedUser.id, { usdtBalance: newBalance });

      const tx = await db.saveWalletTransaction({
        id: `dep-${crypto.randomUUID()}`,
        userId: lockedUser.id,
        type: 'DEPOSIT',
        amount: verified.amountUsdt,
        network,
        txHash: cleanTxHash,
        address: verified.toAddress,
        status: 'COMPLETED',
        createdAt: new Date().toISOString(),
        note: `Verified on-chain (${network}, ${verified.confirmations} confs): ${verified.explorerUrl}`,
      });

      return { updatedUser, tx };
    });

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: 'DEPOSIT_VERIFIED',
      targetType: 'WalletTransaction',
      targetId: result.tx.id,
      ip,
      details: {
        network,
        txHash: cleanTxHash,
        amountUsdt: verified.amountUsdt,
        toAddress: verified.toAddress,
        confirmations: verified.confirmations,
      },
    });

    wsGateway.emitToUser(auth.user.id, 'balance_updated', {
      usdtBalance: result.updatedUser.usdtBalance,
      usdtLocked: result.updatedUser.usdtLocked,
      addedAmount: verified.amountUsdt,
      message: `On-chain deposit verified: +${verified.amountUsdt.toFixed(2)} USDT (${network})`,
    });
    wsGateway.emitToRoom('admin:dashboard', 'deposit_verified', { tx: result.tx });

    await telegramBot.broadcastAdminAlert(
      `💰 *On-Chain Deposit Credited*\nUser: *${auth.user.name}* (${auth.user.email})\nAmount: *+${verified.amountUsdt.toFixed(2)} USDT* (${network})\nTx: \`${cleanTxHash}\``
    );

    return NextResponse.json({
      success: true,
      user: result.updatedUser,
      transaction: result.tx,
      verifiedAmountUsdt: verified.amountUsdt,
      explorerUrl: verified.explorerUrl,
      message: `Verified and credited +${verified.amountUsdt.toFixed(2)} USDT (${network}).`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'On-chain verification failed';
    const isConflict = message.includes('already been verified');
    return NextResponse.json(
      { error: message },
      { status: isConflict ? 409 : 400 }
    );
  }
}
