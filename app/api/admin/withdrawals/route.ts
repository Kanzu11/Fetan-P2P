import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/server/database/prisma';
import { db } from '@/server/database/store';
import { requireAdmin, requireSuperadmin } from '@/server/security/session';
import { getClientIp } from '@/server/security/rate-limiter';
import { sanitizeString, validateTxHash } from '@/server/security/sanitize';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';
import { appendLedgerEntry } from '@/server/payouts/ledger';

export const dynamic = 'force-dynamic';

const withdrawalReviewSchema = z.object({
  txId: z.string().min(1).optional(),
  action: z.enum([
    'APPROVE',
    'REJECT',
    'PAUSE_PAYOUTS',
    'RESUME_PAYOUTS',
    'RESOLVE_RECONCILIATION',
  ]),
  txHash: z.string().max(160).optional(),
  note: z.string().max(300).optional(),
  resolution: z.enum(['COMPLETED', 'FAILED']).optional(),
});

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const [allTx, allUsers, allWithdrawals, payoutControl] = await Promise.all([
    db.getWalletTransactions(),
    db.getAllUsers(),
    prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.payoutControl.findUnique({ where: { id: 'BEP20' } }),
  ]);

  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const withdrawalByWalletTxId = new Map(
    allWithdrawals
      .filter((w) => Boolean(w.walletTxId))
      .map((w) => [w.walletTxId as string, w])
  );

  const withdrawals = allTx
    .filter((tx) => tx.type === 'WITHDRAW')
    .map((tx) => {
      const owner = userMap.get(tx.userId);
      const w = withdrawalByWalletTxId.get(tx.id);
      return {
        ...tx,
        userName: owner?.name || tx.userId,
        userEmail: owner?.email || '',
        telegramHandle: owner?.telegramHandle,
        withdrawalId: w?.id,
        withdrawalStatus: w?.status,
        riskReason: w?.riskReason,
        attempts: w?.attempts ?? 0,
        confirmations: w?.confirmations ?? 0,
        gasUsed: w?.gasUsed,
        nonce: w?.nonce,
        version: w?.version,
      };
    });

  const lastHeartbeatAt = payoutControl?.lastHeartbeatAt || null;
  const workerHealthy =
    lastHeartbeatAt !== null && Date.now() - lastHeartbeatAt.getTime() <= 120_000;

  return NextResponse.json({
    withdrawals,
    payoutControl: {
      paused: payoutControl?.paused ?? false,
      pauseReason: payoutControl?.pauseReason ?? null,
      dailyCapUsdt: payoutControl ? Number(payoutControl.dailyCapUsdt) : 2000,
      lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
      workerHealthy,
    },
  });
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

    const { txId, action, txHash, note, resolution } = parsed.data;
    const cleanNote = sanitizeString(note, 250);
    const ip = getClientIp(req);

    // Superadmin emergency kill-switch controls
    if (action === 'PAUSE_PAYOUTS' || action === 'RESUME_PAYOUTS') {
      const superCheck = await requireSuperadmin(req);
      if (!superCheck.ok) return superCheck.response;

      const paused = action === 'PAUSE_PAYOUTS';
      const control = await prisma.payoutControl.upsert({
        where: { id: 'BEP20' },
        create: {
          id: 'BEP20',
          paused,
          pauseReason: paused ? cleanNote || `Paused by ${auth.user.name}` : null,
        },
        update: {
          paused,
          pauseReason: paused ? cleanNote || `Paused by ${auth.user.name}` : null,
        },
      });

      await db.logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: paused ? 'PAYOUT_WORKER_PAUSED' : 'PAYOUT_WORKER_RESUMED',
        targetType: 'PayoutControl',
        targetId: 'BEP20',
        ip,
        details: { paused, reason: control.pauseReason },
      });

      return NextResponse.json({ success: true, payoutControl: control });
    }

    if (!txId) {
      return NextResponse.json({ error: 'txId is required for this action.' }, { status: 400 });
    }

    const existing = await db.getWalletTransaction(txId);
    if (!existing || existing.type !== 'WITHDRAW') {
      return NextResponse.json({ error: 'Withdrawal request not found.' }, { status: 404 });
    }

    const linkedWithdrawal = await prisma.withdrawal.findFirst({
      where: { OR: [{ walletTxId: txId }, { id: txId }] },
    });

    // Resolve ambiguous on-chain reconciliation rows (superadmin only)
    if (action === 'RESOLVE_RECONCILIATION') {
      const superCheck = await requireSuperadmin(req);
      if (!superCheck.ok) return superCheck.response;

      if (!linkedWithdrawal || linkedWithdrawal.status !== 'NEEDS_RECONCILIATION') {
        return NextResponse.json(
          { error: 'Withdrawal is not in NEEDS_RECONCILIATION state.' },
          { status: 409 }
        );
      }
      if (!resolution) {
        return NextResponse.json(
          { error: 'resolution (COMPLETED or FAILED) is required.' },
          { status: 400 }
        );
      }

      const cleanTxHash = (txHash || '').trim();
      if (resolution === 'COMPLETED') {
        const hashCheck = validateTxHash(cleanTxHash, existing.network);
        if (!hashCheck.valid) {
          return NextResponse.json(
            { error: hashCheck.error || 'Valid verified on-chain txHash is required.' },
            { status: 400 }
          );
        }
        const dup = await db.findWalletTransactionByTxHash(cleanTxHash);
        if (dup && dup.id !== existing.id) {
          return NextResponse.json(
            { error: 'This transaction hash is already linked to another transaction.' },
            { status: 409 }
          );
        }
      }

      const reconResult = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${existing.userId} FOR UPDATE`;
        const currentUser = await tx.user.findUniqueOrThrow({ where: { id: existing.userId } });
        const currentW = await tx.withdrawal.findUniqueOrThrow({ where: { id: linkedWithdrawal.id } });
        if (currentW.status !== 'NEEDS_RECONCILIATION') {
          throw new Error('Withdrawal reconciliation already completed.');
        }

        if (resolution === 'COMPLETED') {
          const updatedW = await tx.withdrawal.updateMany({
            where: { id: currentW.id, version: currentW.version },
            data: {
              status: 'COMPLETED',
              txHash: cleanTxHash,
              approvedBy: auth.user.id,
              completedAt: new Date(),
              lastError: cleanNote || 'Resolved as COMPLETED by Superadmin',
            },
          });
          if (updatedW.count !== 1) throw new Error('Concurrent modification detected; retry.');

          const updatedWTx = await tx.walletTransaction.update({
            where: { id: existing.id },
            data: {
              status: 'COMPLETED',
              txHash: cleanTxHash,
              reviewedBy: auth.user.id,
              note: cleanNote || `Reconciled as COMPLETED by ${auth.user.name}`,
            },
          });
          return { updatedWTx, userBalance: Number(currentUser.usdtBalance), userLocked: Number(currentUser.usdtLocked) };
        }

        const updatedW = await tx.withdrawal.updateMany({
          where: { id: currentW.id, version: currentW.version },
          data: {
            status: 'FAILED',
            approvedBy: auth.user.id,
            lastError: cleanNote || 'Reconciled as FAILED & refunded by Superadmin',
          },
        });
        if (updatedW.count !== 1) throw new Error('Concurrent modification detected; retry.');

        const newBal = currentUser.usdtBalance.plus(currentW.amountUsdt).toDecimalPlaces(6);
        await tx.user.update({ where: { id: currentUser.id }, data: { usdtBalance: newBal } });
        await appendLedgerEntry(tx, {
          userId: currentUser.id,
          type: 'WITHDRAWAL_REFUND',
          amount: currentW.amountUsdt,
          balanceAfter: newBal,
          referenceId: currentW.id,
        });
        const updatedWTx = await tx.walletTransaction.update({
          where: { id: existing.id },
          data: {
            status: 'REJECTED',
            reviewedBy: auth.user.id,
            note: cleanNote || `Reconciled FAILED & refunded by ${auth.user.name}`,
          },
        });
        return { updatedWTx, userBalance: Number(newBal), userLocked: Number(currentUser.usdtLocked) };
      });

      await db.logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: `WITHDRAWAL_RECONCILED_${resolution}`,
        targetType: 'Withdrawal',
        targetId: linkedWithdrawal.id,
        ip,
        details: { txHash: cleanTxHash || null, note: cleanNote },
      });

      return NextResponse.json({
        success: true,
        transaction: reconResult.updatedWTx,
        user: { id: existing.userId, usdtBalance: reconResult.userBalance },
      });
    }

    if (existing.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Withdrawal is already ${existing.status}.` },
        { status: 409 }
      );
    }

    // Never allow admin approve/reject once the signing worker has claimed or broadcast a tx
    if (
      linkedWithdrawal &&
      (linkedWithdrawal.status === 'SIMULATING' ||
        linkedWithdrawal.status === 'PROCESSING' ||
        linkedWithdrawal.status === 'NEEDS_RECONCILIATION' ||
        linkedWithdrawal.nonce !== null)
    ) {
      return NextResponse.json(
        {
          error: `Withdrawal is currently handled by the signing worker (${linkedWithdrawal.status}) and cannot be manually ${action.toLowerCase()}ed.`,
        },
        { status: 409 }
      );
    }

    const isAutoBep20Approve =
      action === 'APPROVE' &&
      existing.network === 'BEP20' &&
      linkedWithdrawal?.status === 'MANUAL_REVIEW' &&
      !(txHash && txHash.trim());

    const cleanTxHash = txHash ? txHash.trim() : '';
    if (action === 'APPROVE' && !isAutoBep20Approve) {
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

    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${existing.userId} FOR UPDATE`;
        const lockedUser = await tx.user.findUniqueOrThrow({ where: { id: existing.userId } });
        const latestWTx = await tx.walletTransaction.findUnique({ where: { id: txId } });
        if (!latestWTx || latestWTx.status !== 'PENDING') {
          throw new Error('Withdrawal has already been processed.');
        }

        const latestW = linkedWithdrawal
          ? await tx.withdrawal.findUnique({ where: { id: linkedWithdrawal.id } })
          : null;

        if (isAutoBep20Approve && latestW) {
          if (latestW.status !== 'MANUAL_REVIEW') {
            throw new Error(`BEP-20 withdrawal is already ${latestW.status}.`);
          }
          // Optimistic version check prevents two admins double-approving simultaneously
          const moved = await tx.withdrawal.updateMany({
            where: { id: latestW.id, version: latestW.version, status: 'MANUAL_REVIEW' },
            data: {
              status: 'PENDING',
              approvedBy: auth.user.id,
              riskReason: `${latestW.riskReason || 'Manual review'} • Approved by ${auth.user.name}`,
            },
          });
          if (moved.count !== 1) {
            throw new Error('Concurrent review modification detected; please refresh.');
          }

          const updatedWTx = await tx.walletTransaction.update({
            where: { id: latestWTx.id },
            data: {
              reviewedBy: auth.user.id,
              note: cleanNote || `Approved by ${auth.user.name} — Queued for automatic BEP-20 worker payout`,
            },
          });

          return {
            savedTx: {
              ...existing,
              reviewedBy: updatedWTx.reviewedBy || undefined,
              note: updatedWTx.note || undefined,
            },
            updatedUserBalance: Number(lockedUser.usdtBalance),
            updatedUserLocked: Number(lockedUser.usdtLocked),
            updatedUserTelegramChatId: lockedUser.telegramChatId,
            queuedForWorker: true,
          };
        }

        if (action === 'APPROVE') {
          if (latestW) {
            if (latestW.status !== 'MANUAL_REVIEW') {
              throw new Error(`Withdrawal is already ${latestW.status}.`);
            }
            const moved = await tx.withdrawal.updateMany({
              where: { id: latestW.id, version: latestW.version },
              data: {
                status: 'COMPLETED',
                txHash: cleanTxHash,
                approvedBy: auth.user.id,
                completedAt: new Date(),
              },
            });
            if (moved.count !== 1) {
              throw new Error('Concurrent review modification detected; please refresh.');
            }
          }

          const updatedWTx = await tx.walletTransaction.update({
            where: { id: latestWTx.id },
            data: {
              status: 'COMPLETED',
              txHash: cleanTxHash,
              reviewedBy: auth.user.id,
              note: cleanNote || `Approved and dispatched by ${auth.user.name}`,
            },
          });

          return {
            savedTx: {
              ...existing,
              status: 'COMPLETED' as const,
              txHash: updatedWTx.txHash || undefined,
              reviewedBy: updatedWTx.reviewedBy || undefined,
              note: updatedWTx.note || undefined,
            },
            updatedUserBalance: Number(lockedUser.usdtBalance),
            updatedUserLocked: Number(lockedUser.usdtLocked),
            updatedUserTelegramChatId: lockedUser.telegramChatId,
            queuedForWorker: false,
          };
        }

        // REJECT -> refund user balance & record immutable WITHDRAWAL_REFUND ledger entry
        if (latestW) {
          if (
            (latestW.status !== 'MANUAL_REVIEW' && latestW.status !== 'PENDING') ||
            latestW.nonce !== null
          ) {
            throw new Error(`Withdrawal cannot be rejected in state ${latestW.status}.`);
          }
          const moved = await tx.withdrawal.updateMany({
            where: { id: latestW.id, version: latestW.version, nonce: null },
            data: {
              status: 'REJECTED',
              approvedBy: auth.user.id,
              lastError: cleanNote || `Rejected by ${auth.user.name}`,
            },
          });
          if (moved.count !== 1) {
            throw new Error('Concurrent withdrawal state change; retry.');
          }
        }

        const refundAmount = latestW ? latestW.amountUsdt : new Prisma.Decimal(existing.amount);
        const newBal = lockedUser.usdtBalance.plus(refundAmount).toDecimalPlaces(6);
        await tx.user.update({ where: { id: lockedUser.id }, data: { usdtBalance: newBal } });
        await appendLedgerEntry(tx, {
          userId: lockedUser.id,
          type: 'WITHDRAWAL_REFUND',
          amount: refundAmount,
          balanceAfter: newBal,
          referenceId: latestW ? latestW.id : latestWTx.id,
        });

        const updatedWTx = await tx.walletTransaction.update({
          where: { id: latestWTx.id },
          data: {
            status: 'REJECTED',
            reviewedBy: auth.user.id,
            note: cleanNote || `Rejected and refunded to wallet by ${auth.user.name}`,
          },
        });

        return {
          savedTx: {
            ...existing,
            status: 'REJECTED' as const,
            reviewedBy: updatedWTx.reviewedBy || undefined,
            note: updatedWTx.note || undefined,
          },
          updatedUserBalance: Number(newBal),
          updatedUserLocked: Number(lockedUser.usdtLocked),
          updatedUserTelegramChatId: lockedUser.telegramChatId,
          queuedForWorker: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 15_000 }
    );

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: result.queuedForWorker
        ? 'WITHDRAWAL_APPROVED_FOR_WORKER'
        : action === 'APPROVE'
        ? 'WITHDRAWAL_APPROVED'
        : 'WITHDRAWAL_REJECTED_REFUNDED',
      targetType: linkedWithdrawal ? 'Withdrawal' : 'WalletTransaction',
      targetId: linkedWithdrawal ? linkedWithdrawal.id : txId,
      ip,
      details: {
        userId: existing.userId,
        amount: existing.amount,
        network: existing.network,
        txHash: action === 'APPROVE' && !result.queuedForWorker ? cleanTxHash : undefined,
        queuedForWorker: result.queuedForWorker,
      },
    });

    wsGateway.emitToUser(existing.userId, 'balance_updated', {
      usdtBalance: result.updatedUserBalance,
      usdtLocked: result.updatedUserLocked,
      message: result.queuedForWorker
        ? `Withdrawal of ${existing.amount} USDT (BEP20) approved — automatic on-chain payout queued.`
        : action === 'APPROVE'
        ? `Withdrawal of ${existing.amount} USDT (${existing.network}) sent!`
        : `Withdrawal of ${existing.amount} USDT rejected and refunded to available balance.`,
    });
    wsGateway.emitToRoom('admin:dashboard', 'withdrawal_updated', { tx: result.savedTx });

    if (result.updatedUserTelegramChatId && !result.queuedForWorker) {
      await telegramBot.sendTelegramMessage(
        result.updatedUserTelegramChatId,
        action === 'APPROVE'
          ? `✅ *Withdrawal Sent*\n\nAmount: *${existing.amount} USDT* (${existing.network})\nTxHash: \`${cleanTxHash}\``
          : `↩️ *Withdrawal Rejected & Refunded*\n\nAmount: *${existing.amount} USDT* has been returned to your available wallet balance.\nReason: ${cleanNote || 'Rejected by review'}`
      );
    }

    const updatedUser = await db.getUser(existing.userId);
    return NextResponse.json({
      success: true,
      queuedForWorker: result.queuedForWorker,
      transaction: result.savedTx,
      user: updatedUser,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
