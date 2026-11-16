import { Prisma, PrismaClient } from '@prisma/client';
import type { PayoutAlerter } from './alerts';
import type { QuorumFeeData, RpcPoolInterface } from './rpc-pool';

/**
 * Syncs PayoutControl.nextNonce with on-chain state on worker boot.
 *
 * Mitigates:
 * - Nonce drift / collisions after restarts.
 * - Foreign private key compromise: if chain `pending > latest` without matching local
 *   PROCESSING broadcast rows, the worker alerts CRITICAL and pauses immediately.
 */
export async function syncNonceOnBoot(
  prisma: PrismaClient,
  pool: RpcPoolInterface,
  hotAddress: string,
  alerts: PayoutAlerter
): Promise<number> {
  const [chainLatest, chainPending, control, inFlight] = await Promise.all([
    pool.quorumTransactionCount(hotAddress, 'latest'),
    pool.quorumTransactionCount(hotAddress, 'pending'),
    prisma.payoutControl.upsert({
      where: { id: 'BEP20' },
      create: { id: 'BEP20', paused: false },
      update: {},
    }),
    prisma.withdrawal.findMany({
      where: { network: 'BEP20', status: 'PROCESSING', nonce: { not: null } },
      select: { id: true, nonce: true },
    }),
  ]);

  const knownInFlightNonces = new Set(
    inFlight.map((r) => r.nonce).filter((n): n is number => n !== null)
  );

  // Detect any unrecorded pending nonces originating outside this worker (key compromise signal)
  for (let n = chainLatest; n < chainPending; n++) {
    if (!knownInFlightNonces.has(n)) {
      const reason = `Unknown pending nonce ${n} detected on hot wallet ${hotAddress} (latest=${chainLatest}, pending=${chainPending}). Possible key compromise.`;
      await prisma.payoutControl.update({
        where: { id: 'BEP20' },
        data: { paused: true, pauseReason: reason },
      });
      await alerts.send('CRITICAL', 'Foreign Pending Transaction Detected', reason);
      throw new Error(reason);
    }
  }

  const targetNextNonce = Math.max(control.nextNonce ?? 0, chainPending);
  await prisma.payoutControl.update({
    where: { id: 'BEP20' },
    data: { nextNonce: targetNextNonce },
  });

  return targetNextNonce;
}

/**
 * Atomically reserves and increments PayoutControl.nextNonce inside an active transaction.
 *
 * Mitigates:
 * - Concurrent signing threads or retries double-assigning the same EVM nonce.
 */
export async function reserveNextNonce(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ reserved: number }>>`
    UPDATE "PayoutControl"
    SET "nextNonce" = "nextNonce" + 1, "updatedAt" = now()
    WHERE "id" = 'BEP20' AND "nextNonce" IS NOT NULL
    RETURNING ("nextNonce" - 1) AS "reserved"
  `;

  if (!rows[0] || typeof rows[0].reserved !== 'number') {
    throw new Error('PayoutControl.nextNonce not initialized before reservation.');
  }
  return rows[0].reserved;
}

/**
 * Computes a +12.5% replacement gas fee bump (minimum threshold enforced by Geth/BSC mempools)
 * bounded by MAX_GWEI ceiling.
 */
export function computeReplacementFee(prev: QuorumFeeData, maxGwei: number): QuorumFeeData {
  const capWei = BigInt(Math.floor(maxGwei * 1_000_000_000));
  const bump = (v: bigint) => {
    const bumped = (v * 1125n + 999n) / 1000n;
    return bumped <= v ? v + 1n : bumped;
  };

  const nextGasPrice = bump(prev.gasPrice);
  const nextMaxFee = bump(prev.maxFeePerGas);
  const nextPriority = bump(prev.maxPriorityFeePerGas);

  if (nextMaxFee > capWei || nextGasPrice > capWei) {
    throw new Error(`Replacement gas fee bump exceeds MAX_GWEI ceiling (${maxGwei} gwei).`);
  }

  return {
    gasPrice: nextGasPrice,
    maxFeePerGas: nextMaxFee,
    maxPriorityFeePerGas: nextPriority > nextMaxFee ? nextMaxFee : nextPriority,
    supportsEip1559: prev.supportsEip1559,
  };
}
