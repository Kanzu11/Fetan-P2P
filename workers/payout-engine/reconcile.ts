import { Prisma, PrismaClient } from '@prisma/client';
import { formatUnits } from 'ethers';
import { USDT_BEP20_DECIMALS } from '../../server/payouts/constants';
import type { PayoutAlerter } from './alerts';
import type { RpcPoolInterface } from './rpc-pool';

/**
 * Runs periodic ledger continuity & hot-wallet solvency checks.
 *
 * Mitigates:
 * - Direct SQL modification of User.usdtBalance bypassing the WalletBalance ledger.
 * - Silent insolvency or unrecorded off-ledger credits exceeding actual custody reserves.
 */
export async function reconcileLedgerAndReserves(
  prisma: PrismaClient,
  pool: RpcPoolInterface,
  usdtContract: string,
  hotAddress: string,
  alerts: PayoutAlerter
): Promise<{ checkedUsers: number; mismatches: string[] }> {
  // Compare each user's current usdtBalance against their latest WalletBalance.balanceAfter
  const mismatchRows = await prisma.$queryRaw<
    Array<{ userId: string; userBalance: string; ledgerBalance: string }>
  >`
    SELECT u."id" AS "userId",
           u."usdtBalance"::text AS "userBalance",
           latest."balanceAfter"::text AS "ledgerBalance"
    FROM "User" u
    JOIN LATERAL (
      SELECT wb."balanceAfter"
      FROM "WalletBalance" wb
      WHERE wb."userId" = u."id"
      ORDER BY wb."createdAt" DESC, wb."id" DESC
      LIMIT 1
    ) latest ON true
    WHERE u."usdtBalance" <> latest."balanceAfter"
  `;

  const autoFreeze = process.env.PAYOUT_RECONCILE_AUTO_FREEZE === 'true';
  const mismatches: string[] = [];
  for (const row of mismatchRows) {
    mismatches.push(
      `user=${row.userId} db=${row.userBalance} ledger=${row.ledgerBalance}`
    );
    if (autoFreeze) {
      await prisma.user.update({
        where: { id: row.userId },
        data: {
          isSuspended: true,
          suspendReason: 'Automated freeze: ledger continuity mismatch pending audit.',
        },
      });
    }
  }

  if (mismatches.length > 0) {
    await alerts.send(
      'CRITICAL',
      autoFreeze
        ? 'User Balance vs Ledger Mismatch Detected (Accounts Frozen)'
        : 'User Balance vs Ledger Mismatch Detected (Alert-Only Mode)',
      mismatches.join('; ')
    );
  }

  const totalLedgerUsers = await prisma.walletBalance.groupBy({ by: ['userId'] });

  // Solvency telemetry (hot wallet balance + declared offline cold storage vs liabilities)
  const [hotUsdtRaw, liabAgg, inFlightAgg] = await Promise.all([
    pool.quorumTokenBalance(usdtContract, hotAddress),
    prisma.user.aggregate({ _sum: { usdtBalance: true, usdtLocked: true } }),
    prisma.withdrawal.aggregate({
      where: { status: { in: ['PENDING', 'MANUAL_REVIEW', 'SIMULATING', 'PROCESSING'] } },
      _sum: { netAmountUsdt: true },
    }),
  ]);

  const hotUsdt = new Prisma.Decimal(formatUnits(hotUsdtRaw, USDT_BEP20_DECIMALS));
  const coldReserve = new Prisma.Decimal(process.env.COLD_WALLET_RESERVE_USDT || '0');
  const totalReserves = hotUsdt.plus(coldReserve);
  const totalLiabilities = (liabAgg._sum.usdtBalance ?? new Prisma.Decimal(0))
    .plus(liabAgg._sum.usdtLocked ?? new Prisma.Decimal(0))
    .plus(inFlightAgg._sum.netAmountUsdt ?? new Prisma.Decimal(0));

  if (coldReserve.gt(0) && totalReserves.lt(totalLiabilities)) {
    await alerts.send(
      'CRITICAL',
      'Platform Reserve Solvency Alert',
      `Reserves (${totalReserves.toFixed(2)} USDT) < Liabilities (${totalLiabilities.toFixed(2)} USDT)`
    );
  }

  return { checkedUsers: totalLedgerUsers.length, mismatches };
}
