import { Prisma } from '@prisma/client';
import {
  MAX_AUTO_24H_USDT,
  MAX_AUTO_TX_USDT,
  MIN_ACCOUNT_AGE_FOR_AUTO_MS,
} from './constants';

export interface RiskEvaluationInput {
  userId: string;
  network: 'TRC20' | 'BEP20' | 'TON';
  amountUsdt: Prisma.Decimal;
  accountCreatedAt: Date;
}

export interface RiskEvaluationResult {
  status: 'PENDING' | 'MANUAL_REVIEW';
  riskReason: string | null;
  used24hUsdt: Prisma.Decimal;
}

/**
 * Evaluates whether a withdrawal qualifies for automatic BEP-20 execution or must route
 * to MANUAL_REVIEW. MUST be invoked inside a per-user `SELECT ... FOR UPDATE` lock.
 *
 * Mitigates:
 * - TOCTOU split-request bypasses where parallel HTTP calls race past the 500 USDT/24h cap.
 * - Compromised dashboard env vars (limits are compiled constants, not env-configurable).
 * - Newly registered account takeover cash-outs (< 24h old accounts always wait for review).
 */
export async function evaluateWithdrawalRisk(
  tx: Prisma.TransactionClient,
  input: RiskEvaluationInput
): Promise<RiskEvaluationResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Single query combines Withdrawal + unlinked legacy WalletTransaction volume inside the active user lock
  const rows = await tx.$queryRaw<Array<{ totalUsed: string }>>`
    SELECT (
      COALESCE((
        SELECT SUM(w."amountUsdt")
        FROM "Withdrawal" w
        WHERE w."userId" = ${input.userId}
          AND w."createdAt" >= ${since}
          AND w."status" NOT IN ('FAILED', 'REJECTED')
      ), 0)
      +
      COALESCE((
        SELECT SUM(wt."amount")
        FROM "WalletTransaction" wt
        WHERE wt."userId" = ${input.userId}
          AND wt."type" = 'WITHDRAW'
          AND wt."createdAt" >= ${since}
          AND wt."status" <> 'REJECTED'
          AND NOT EXISTS (
            SELECT 1 FROM "Withdrawal" w2 WHERE w2."walletTxId" = wt."id"
          )
      ), 0)
    )::text AS "totalUsed"
  `;

  const used24hUsdt = new Prisma.Decimal(rows[0]?.totalUsed || '0');

  // Only BEP-20 supports automatic worker payout; TRC-20 and TON stay manual
  if (input.network !== 'BEP20') {
    return {
      status: 'MANUAL_REVIEW',
      riskReason: `${input.network} withdrawals are routed to manual admin disbursement.`,
      used24hUsdt,
    };
  }

  // Hardcoded per-transaction threshold (> 100 USDT -> MANUAL_REVIEW)
  if (input.amountUsdt.gt(MAX_AUTO_TX_USDT)) {
    return {
      status: 'MANUAL_REVIEW',
      riskReason: `Single withdrawal exceeds auto limit (${MAX_AUTO_TX_USDT.toFixed(0)} USDT).`,
      used24hUsdt,
    };
  }

  // Hardcoded 24h rolling user velocity limit (> 500 USDT -> MANUAL_REVIEW)
  if (used24hUsdt.plus(input.amountUsdt).gt(MAX_AUTO_24H_USDT)) {
    return {
      status: 'MANUAL_REVIEW',
      riskReason: `Rolling 24h withdrawal volume (${used24hUsdt.plus(input.amountUsdt).toFixed(2)} USDT) exceeds ${MAX_AUTO_24H_USDT.toFixed(0)} USDT limit.`,
      used24hUsdt,
    };
  }

  // Additional high-signal guard: accounts younger than 24 hours require human approval
  if (Date.now() - input.accountCreatedAt.getTime() < MIN_ACCOUNT_AGE_FOR_AUTO_MS) {
    return {
      status: 'MANUAL_REVIEW',
      riskReason: 'Account created within last 24 hours requires manual withdrawal approval.',
      used24hUsdt,
    };
  }

  return {
    status: 'PENDING',
    riskReason: null,
    used24hUsdt,
  };
}
