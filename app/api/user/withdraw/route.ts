import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { parseUnits } from 'ethers';
import { z } from 'zod';
import { prisma } from '@/server/database/prisma';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { getClientIp } from '@/server/security/rate-limiter';
import { verifyAndConsumeOtp } from '@/server/security/otp';
import { sanitizeAmount } from '@/server/security/sanitize';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';
import { isAdminRole } from '@/client/types';
import { WITHDRAWAL_FEES_USDT } from '@/client/config';
import { USDT_BEP20_DECIMALS } from '@/server/payouts/constants';
import { appendLedgerEntry } from '@/server/payouts/ledger';
import { evaluateWithdrawalRisk } from '@/server/payouts/risk-engine';
import {
  enforceWithdrawalRateLimit,
  WithdrawalRateLimitError,
} from '@/server/payouts/redis-rate-limit';
import {
  computeWithdrawalRequestHash,
  findExistingIdempotentWithdrawal,
  parseIdempotencyKeyHeader,
} from '@/server/payouts/idempotency';
import { validatePayoutDestination } from '@/server/payouts/address-guard';

export const dynamic = 'force-dynamic';

// Coalesces concurrent same-instance double-clicks sharing an Idempotency-Key so
// parallel identical requests await the leader's commit instead of racing into OTP consumption.
const inFlightWithdrawals = new Map<string, Promise<void>>();

// Attack vector mitigated:
// - Rejects JSON numbers (`1e21`, IEEE-754 precision loss like `10.000000000000002`) by requiring a decimal string.
// - `.strict()` blocks mass-assignment attacks (e.g., injecting `"status":"COMPLETED"`, `"feeUsdt":0`).
const withdrawSchema = z
  .object({
    amountUsdt: z
      .string()
      .trim()
      .regex(/^\d{1,9}(\.\d{1,6})?$/, 'Withdrawal amount must be a valid decimal string.'),
    network: z.enum(['TRC20', 'BEP20', 'TON']),
    destinationAddress: z.string().trim().min(8, 'Valid destination address required.').max(120),
    otpCode: z.string().regex(/^\d{6}$/, '6-digit email verification code is required.'),
  })
  .strict();

class HttpRouteError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Attack vector mitigated: oversized JSON payload DoS before Zod runs.
 */
async function readJsonBodyCapped(req: Request, maxBytes = 4096): Promise<unknown> {
  const rawText = await req.text();
  if (Buffer.byteLength(rawText, 'utf8') > maxBytes) {
    throw new HttpRouteError(413, 'Request body exceeds maximum allowed size.');
  }
  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new HttpRouteError(400, 'Malformed JSON payload.');
  }
}

function buildReplayResponse(
  existing: NonNullable<Awaited<ReturnType<typeof findExistingIdempotentWithdrawal>>>,
  userSnapshot: { usdtBalance: number | Prisma.Decimal; usdtLocked: number | Prisma.Decimal } | null
) {
  return NextResponse.json({
    success: true,
    replayed: true,
    withdrawal: {
      id: existing.id,
      status: existing.status,
      network: existing.network,
      destination: existing.destination,
      amountUsdt: Number(existing.amountUsdt),
      feeUsdt: Number(existing.feeUsdt),
      netPayoutUsdt: Number(existing.netAmountUsdt),
      riskReason: existing.riskReason,
      txHash: existing.txHash,
      createdAt: existing.createdAt.toISOString(),
    },
    user: userSnapshot
      ? {
          usdtBalance: Number(userSnapshot.usdtBalance),
          usdtLocked: Number(userSnapshot.usdtLocked),
        }
      : undefined,
    feeUsdt: Number(existing.feeUsdt),
    netPayoutUsdt: Number(existing.netAmountUsdt),
    message: 'Idempotent replay: returning previously queued withdrawal.',
  });
}

export async function POST(req: Request) {
  try {
    // 1. Authenticate caller via signed session JWT
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    // 2. Require valid UUIDv4 Idempotency-Key header (blocks double-click & replay exploits)
    const idempotency = parseIdempotencyKeyHeader(req.headers);
    if (!idempotency.ok) {
      return NextResponse.json({ error: idempotency.error }, { status: 400 });
    }
    const idempotencyKey = idempotency.key;

    // 3. Enforce Redis-backed distributed rate limits, failing closed on store failure
    const ip = getClientIp(req);
    await enforceWithdrawalRateLimit(auth.user.id, ip);

    // 4. Reject unverified users (KYC gate)
    if (auth.user.kycStatus !== 'VERIFIED' && !isAdminRole(auth.user.role)) {
      return NextResponse.json(
        { error: 'KYC verification must be approved before requesting withdrawals.' },
        { status: 403 }
      );
    }

    // 5. Parse capped JSON payload and validate strictly against Zod schema
    const rawBody = await readJsonBodyCapped(req, 4096);
    const parsed = withdrawSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid withdrawal request.' },
        { status: 400 }
      );
    }

    // Precision & bounds verification using Decimal alongside strict sanitizer bounds
    const amountCheck = sanitizeAmount(parsed.data.amountUsdt, 5, 100_000, 6);
    const amountUsdt = amountCheck.valid ? amountCheck.amount : 0;
    if (!amountCheck.valid || amountUsdt < 5 || amountUsdt > 100_000) {
      return NextResponse.json(
        { error: amountCheck.error || 'Withdrawal amount must be between 5 and 100,000 USDT.' },
        { status: 400 }
      );
    }

    const { network, otpCode } = parsed.data;
    const amountDec = new Prisma.Decimal(parsed.data.amountUsdt).toDecimalPlaces(6);

    // 6. Enforce EIP-55 checksum and block platform/token/zero/burn/self addresses
    const destCheck = validatePayoutDestination(
      parsed.data.destinationAddress,
      network,
      auth.user.id
    );
    if (!destCheck.valid || !destCheck.canonicalAddress) {
      return NextResponse.json(
        { error: destCheck.error || `Invalid ${network} destination wallet address.` },
        { status: 400 }
      );
    }
    const cleanAddress = destCheck.canonicalAddress;

    const networkFeeUsdt = WITHDRAWAL_FEES_USDT[network];
    const feeDec = new Prisma.Decimal(networkFeeUsdt).toDecimalPlaces(6);
    const netPayoutDec = amountDec.minus(feeDec).toDecimalPlaces(6);
    const netPayoutUsdt = Number(netPayoutDec.toFixed(6));

    if (netPayoutDec.lte(0) || netPayoutUsdt <= 0) {
      return NextResponse.json(
        {
          error: `Withdrawal amount must exceed the ${network} network fee (${networkFeeUsdt.toFixed(2)} USDT, paid by sender).`,
        },
        { status: 400 }
      );
    }

    const requestHash = computeWithdrawalRequestHash({
      userId: auth.user.id,
      network,
      amountUsdt: amountDec,
      destination: cleanAddress,
    });

    // 7. Fast idempotency check + same-instance concurrency coalescing BEFORE consuming OTP
    const preExisting = await findExistingIdempotentWithdrawal(idempotencyKey);
    if (preExisting) {
      if (preExisting.userId !== auth.user.id || preExisting.requestHash !== requestHash) {
        return NextResponse.json(
          { error: 'Idempotency-Key cannot be reused with a different withdrawal payload.' },
          { status: 422 }
        );
      }
      const userSnapshot = await prisma.user.findUnique({
        where: { id: auth.user.id },
        select: { usdtBalance: true, usdtLocked: true },
      });
      return buildReplayResponse(preExisting, userSnapshot);
    }

    const activeLeader = inFlightWithdrawals.get(idempotencyKey);
    if (activeLeader) {
      await activeLeader.catch(() => undefined);
      const completed = await findExistingIdempotentWithdrawal(idempotencyKey);
      if (completed) {
        if (completed.userId !== auth.user.id || completed.requestHash !== requestHash) {
          return NextResponse.json(
            { error: 'Idempotency-Key cannot be reused with a different withdrawal payload.' },
            { status: 422 }
          );
        }
        const userSnapshot = await prisma.user.findUnique({
          where: { id: auth.user.id },
          select: { usdtBalance: true, usdtLocked: true },
        });
        return buildReplayResponse(completed, userSnapshot);
      }
    }

    let resolveLeader!: () => void;
    const leaderPromise = new Promise<void>((resolve) => {
      resolveLeader = resolve;
    });
    inFlightWithdrawals.set(idempotencyKey, leaderPromise);

    try {
      // 8. Consume 6-digit email OTP and verify bound withdrawal tuple
      const otpCheck = await verifyAndConsumeOtp({
        email: auth.user.email,
        purpose: 'WITHDRAW',
        code: otpCode,
      });

      if (!otpCheck.valid) {
        // Cross-instance double-click guard: check briefly if another server instance just committed
        for (const waitMs of [250, 500, 1000]) {
          const lateReplay = await findExistingIdempotentWithdrawal(idempotencyKey);
          if (lateReplay) {
            if (lateReplay.userId !== auth.user.id || lateReplay.requestHash !== requestHash) {
              return NextResponse.json(
                { error: 'Idempotency-Key cannot be reused with a different withdrawal payload.' },
                { status: 422 }
              );
            }
            const userSnapshot = await prisma.user.findUnique({
              where: { id: auth.user.id },
              select: { usdtBalance: true, usdtLocked: true },
            });
            return buildReplayResponse(lateReplay, userSnapshot);
          }
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }

        await db.logAudit({
          actorId: auth.user.id,
          actorRole: auth.user.role,
          action: 'WITHDRAW_OTP_FAILED',
          targetType: 'User',
          targetId: auth.user.id,
          ip,
          details: { reason: otpCheck.error },
        });
        return NextResponse.json(
          { error: otpCheck.error || 'Invalid or expired withdrawal confirmation code.' },
          { status: 401 }
        );
      }

      const meta = otpCheck.metadata;
      if (meta) {
        const metaAmount = typeof meta.amountUsdt === 'number' ? Number(meta.amountUsdt) : null;
        const metaNet = typeof meta.network === 'string' ? meta.network : null;
        const metaAddr =
          typeof meta.destinationAddress === 'string' ? meta.destinationAddress.trim() : null;

        if (
          (metaAmount !== null && Math.abs(metaAmount - amountUsdt) > 0.000001) ||
          (metaNet && metaNet !== network) ||
          (metaAddr && metaAddr.toLowerCase() !== cleanAddress.toLowerCase())
        ) {
          return NextResponse.json(
            {
              error:
                'Withdrawal amount, network, or destination address changed after your verification code was issued. Please request a fresh code.',
            },
            { status: 400 }
          );
        }
      }

      const netAmountRaw =
        network === 'BEP20'
          ? parseUnits(netPayoutDec.toFixed(6), USDT_BEP20_DECIMALS).toString()
          : parseUnits(netPayoutDec.toFixed(6), 6).toString();

      const withdrawalId = crypto.randomUUID();
      const walletTxId = `wdr-${withdrawalId}`;

      // 9. Atomic Serializable database transaction with per-user row lock (`FOR UPDATE`).
      // Attack vectors mitigated:
      // - Race conditions / parallel double-spending across HTTP calls (`SELECT ... FOR UPDATE`).
      // - TOCTOU 24h velocity bypasses (`evaluateWithdrawalRisk` runs while user row is locked).
      // - Orphan debits or unrecorded ledger deltas (`Withdrawal`, `User`, `WalletBalance`, `WalletTransaction` commit together).
      let txResult;
      try {
        txResult = await prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${auth.user.id} FOR UPDATE`;

            const lockedUser = await tx.user.findUnique({ where: { id: auth.user.id } });
            if (!lockedUser) {
              throw new HttpRouteError(404, 'User account not found.');
            }
            if (lockedUser.isSuspended) {
              throw new HttpRouteError(403, 'Account is suspended.');
            }
            if (lockedUser.usdtBalance.lt(amountDec)) {
              throw new HttpRouteError(
                400,
                `Insufficient available balance (${lockedUser.usdtBalance.toFixed(2)} USDT available).`
              );
            }

            const risk = await evaluateWithdrawalRisk(tx, {
              userId: lockedUser.id,
              userEmail: lockedUser.email,
              network,
              amountUsdt: amountDec,
              destination: cleanAddress,
              accountCreatedAt: lockedUser.createdAt,
            });

            const newBalance = lockedUser.usdtBalance.minus(amountDec).toDecimalPlaces(6);
            const updatedUserRow = await tx.user.update({
              where: { id: lockedUser.id },
              data: { usdtBalance: newBalance },
            });

            const note =
              risk.status === 'PENDING'
                ? `Fee: ${networkFeeUsdt.toFixed(2)} USDT (paid by user) • Net payout: ${netPayoutUsdt.toFixed(2)} USDT (${network}) — Queued for automatic payout`
                : `Fee: ${networkFeeUsdt.toFixed(2)} USDT (paid by user) • Net payout: ${netPayoutUsdt.toFixed(2)} USDT (${network}) — ${risk.riskReason || 'Manual review'}`;

            const walletTxRow = await tx.walletTransaction.create({
              data: {
                id: walletTxId,
                userId: lockedUser.id,
                type: 'WITHDRAW',
                amount: amountDec,
                network,
                address: cleanAddress,
                status: 'PENDING',
                note,
              },
            });

            const withdrawalRow = await tx.withdrawal.create({
              data: {
                id: withdrawalId,
                userId: lockedUser.id,
                idempotencyKey,
                requestHash,
                walletTxId: walletTxRow.id,
                network,
                destination: cleanAddress,
                amountUsdt: amountDec,
                feeUsdt: feeDec,
                netAmountUsdt: netPayoutDec,
                netAmountRaw,
                status: risk.status,
                riskReason: risk.riskReason,
              },
            });

            await appendLedgerEntry(tx, {
              userId: lockedUser.id,
              type: 'WITHDRAWAL_DEBIT',
              amount: amountDec.neg(),
              balanceAfter: newBalance,
              referenceId: withdrawalRow.id,
            });

            return {
              withdrawalRow,
              walletTxRow,
              updatedUserRow,
              risk,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 15_000 }
        );
      } catch (txErr: unknown) {
        const prismaCode = (txErr as { code?: string })?.code;
        if (prismaCode === 'P2002') {
          const raced = await findExistingIdempotentWithdrawal(idempotencyKey);
          if (raced) {
            if (raced.userId !== auth.user.id || raced.requestHash !== requestHash) {
              return NextResponse.json(
                { error: 'Idempotency-Key conflict with a different withdrawal payload.' },
                { status: 422 }
              );
            }
            const userSnapshot = await prisma.user.findUnique({
              where: { id: auth.user.id },
              select: { usdtBalance: true, usdtLocked: true },
            });
            return buildReplayResponse(raced, userSnapshot);
          }
        }
        throw txErr;
      }

      const updatedUser = await db.getUser(auth.user.id);
      const txPayload = {
        id: txResult.walletTxRow.id,
        userId: txResult.walletTxRow.userId,
        type: txResult.walletTxRow.type,
        amount: Number(txResult.walletTxRow.amount),
        network: txResult.walletTxRow.network as 'TRC20' | 'BEP20' | 'TON',
        address: txResult.walletTxRow.address || undefined,
        status: txResult.walletTxRow.status,
        note: txResult.walletTxRow.note || undefined,
        createdAt: txResult.walletTxRow.createdAt.toISOString(),
      };

      // 10. Non-blocking notifications & audit log outside financial transaction
      await db.logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: 'WITHDRAWAL_REQUESTED',
        targetType: 'Withdrawal',
        targetId: txResult.withdrawalRow.id,
        ip,
        details: {
          amountUsdt,
          networkFeeUsdt,
          netPayoutUsdt,
          network,
          destinationAddress: cleanAddress,
          status: txResult.withdrawalRow.status,
          riskReason: txResult.withdrawalRow.riskReason,
          idempotencyKey,
        },
      });

      wsGateway.emitToUser(auth.user.id, 'balance_updated', {
        usdtBalance: Number(txResult.updatedUserRow.usdtBalance),
        usdtLocked: Number(txResult.updatedUserRow.usdtLocked),
        message: `Withdrawal submitted: -${amountUsdt.toFixed(2)} USDT (Fee: ${networkFeeUsdt.toFixed(2)}, Net payout: ${netPayoutUsdt.toFixed(2)} USDT via ${network}).`,
      });
      wsGateway.emitToRoom('admin:dashboard', 'withdrawal_requested', {
        tx: txPayload,
        withdrawalStatus: txResult.withdrawalRow.status,
      });

      await telegramBot.sendWithdrawalAlert(txPayload, auth.user);

      return NextResponse.json({
        success: true,
        user: updatedUser,
        transaction: txPayload,
        withdrawal: {
          id: txResult.withdrawalRow.id,
          status: txResult.withdrawalRow.status,
          riskReason: txResult.withdrawalRow.riskReason,
          netAmountUsdt: Number(txResult.withdrawalRow.netAmountUsdt),
        },
        feeUsdt: networkFeeUsdt,
        netPayoutUsdt,
        message:
          txResult.withdrawalRow.status === 'PENDING'
            ? `Withdrawal queued for automatic payout: ${netPayoutUsdt.toFixed(2)} USDT net via ${network}.`
            : `Withdrawal placed in manual compliance review: ${netPayoutUsdt.toFixed(2)} USDT net via ${network}.`,
      });
    } finally {
      inFlightWithdrawals.delete(idempotencyKey);
      resolveLeader();
    }
  } catch (err: unknown) {
    if (err instanceof WithdrawalRateLimitError) {
      const res = NextResponse.json({ error: err.message }, { status: err.statusCode });
      if (err.retryAfterSeconds) {
        res.headers.set('Retry-After', String(err.retryAfterSeconds));
      }
      return res;
    }
    if (err instanceof HttpRouteError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : 'Withdrawal failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
