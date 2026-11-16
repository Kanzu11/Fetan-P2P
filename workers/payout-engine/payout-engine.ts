import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Prisma, PrismaClient, Withdrawal } from '@prisma/client';
import {
  formatEther,
  formatUnits,
  getAddress,
  Interface,
  keccak256,
  parseEther,
  parseUnits,
  TransactionRequest,
  ZeroAddress,
} from 'ethers';
import {
  BSC_MAINNET_CHAIN_ID,
  DEFAULT_USDT_BEP20_CONTRACT,
  ERC20_TRANSFER_TOPIC,
  MAX_AUTO_TX_USDT,
  USDT_BEP20_DECIMALS,
} from '../../server/payouts/constants';
import { appendLedgerEntry } from '../../server/payouts/ledger';
import type { PayoutAlerter } from './alerts';
import { createTelegramAlerter } from './alerts';
import { computeReplacementFee, reserveNextNonce, syncNonceOnBoot } from './nonce-manager';
import { reconcileLedgerAndReserves } from './reconcile';
import { BscRpcPool, parseConfiguredRpcUrls, type QuorumFeeData, type QuorumReceipt, type RpcPoolInterface } from './rpc-pool';
import { loadIsolatedHotWallet, type WorkerSigner } from './secrets';

const ERC20_IFACE = new Interface(['function transfer(address to, uint256 value) returns (bool)']);
const MAX_SAFE_GAS_LIMIT = 120_000n;
const REQUIRED_CONFIRMATIONS = 2;
const MAX_GAS_BUMPS = 3;

export interface WorkerConfig {
  workerId: string;
  chainId: number;
  usdtContract: string;
  minBnbWei: bigint;
  minUsdtRaw: bigint;
  maxGwei: number;
  receiptTimeoutMs: number;
  pollIntervalMs: number;
  reconcileIntervalMs: number;
}

export function loadWorkerConfig(): WorkerConfig {
  return {
    workerId: process.env.PAYOUT_WORKER_ID?.trim() || `oracle-worker-${process.pid}`,
    chainId: Number(process.env.PAYOUT_CHAIN_ID || BSC_MAINNET_CHAIN_ID),
    usdtContract: getAddress(
      process.env.USDT_BEP20_CONTRACT?.trim() || DEFAULT_USDT_BEP20_CONTRACT
    ),
    minBnbWei: parseEther(process.env.PAYOUT_MIN_BNB?.trim() || '0.02'),
    minUsdtRaw: parseUnits(process.env.PAYOUT_MIN_USDT?.trim() || '200', USDT_BEP20_DECIMALS),
    maxGwei: Number(process.env.PAYOUT_MAX_GWEI || '10'),
    receiptTimeoutMs: Number(process.env.PAYOUT_RECEIPT_TIMEOUT_MS || '180000'),
    pollIntervalMs: Number(process.env.PAYOUT_POLL_INTERVAL_MS || '5000'),
    reconcileIntervalMs: Number(process.env.PAYOUT_RECONCILE_INTERVAL_MS || '3600000'),
  };
}

function topicToAddress(topic: string): string {
  return getAddress(`0x${topic.slice(-40)}`).toLowerCase();
}

export function verifyTransferLogMatchesPayout(
  receipt: QuorumReceipt,
  usdtContract: string,
  hotAddress: string,
  destination: string,
  expectedRawAmount: bigint
): boolean {
  const targetContract = usdtContract.toLowerCase();
  const expectedFrom = hotAddress.toLowerCase();
  const expectedTo = destination.toLowerCase();

  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== targetContract) return false;
    if (!log.topics || log.topics.length < 3) return false;
    if (log.topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC) return false;
    try {
      return (
        topicToAddress(log.topics[1]) === expectedFrom &&
        topicToAddress(log.topics[2]) === expectedTo &&
        BigInt(log.data) === expectedRawAmount
      );
    } catch {
      return false;
    }
  });
}

/**
 * Isolated BEP-20 payout execution engine.
 */
export class PayoutEngine {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly pool: RpcPoolInterface,
    private readonly signer: WorkerSigner,
    private readonly alerts: PayoutAlerter,
    private readonly config: WorkerConfig
  ) {}

  private async pauseWorker(reason: string): Promise<void> {
    await this.prisma.payoutControl.upsert({
      where: { id: 'BEP20' },
      create: { id: 'BEP20', paused: true, pauseReason: reason },
      update: { paused: true, pauseReason: reason },
    });
    await this.alerts.send('CRITICAL', 'Payout Worker Paused Automatically', reason);
  }

  private async markNeedsReconciliation(
    withdrawal: Withdrawal,
    reason: string,
    pauseAll = false
  ): Promise<void> {
    await this.prisma.withdrawal.updateMany({
      where: { id: withdrawal.id, version: withdrawal.version },
      data: { status: 'NEEDS_RECONCILIATION', lastError: reason.slice(0, 500) },
    });
    if (pauseAll) {
      await this.pauseWorker(`Withdrawal ${withdrawal.id}: ${reason}`);
    } else {
      await this.alerts.send(
        'CRITICAL',
        `Withdrawal ${withdrawal.id} Requires Manual Reconciliation`,
        reason
      );
    }
  }

  private async failAndRefundPreBroadcast(
    withdrawal: Withdrawal,
    reason: string
  ): Promise<void> {
    // Safety invariant: NEVER auto-refund if a nonce or broadcast tx exists.
    if (withdrawal.nonce !== null) {
      await this.markNeedsReconciliation(
        withdrawal,
        `Attempted pre-broadcast refund while nonce ${withdrawal.nonce} was bound: ${reason}`,
        true
      );
      return;
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${withdrawal.userId} FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({ where: { id: withdrawal.userId } });

        const moved = await tx.withdrawal.updateMany({
          where: {
            id: withdrawal.id,
            version: withdrawal.version,
            status: 'SIMULATING',
            nonce: null,
          },
          data: { status: 'FAILED', lastError: reason.slice(0, 500) },
        });
        if (moved.count !== 1) return;

        const newBal = user.usdtBalance.plus(withdrawal.amountUsdt).toDecimalPlaces(6);
        await tx.user.update({ where: { id: user.id }, data: { usdtBalance: newBal } });
        await appendLedgerEntry(tx, {
          userId: user.id,
          type: 'WITHDRAWAL_REFUND',
          amount: withdrawal.amountUsdt,
          balanceAfter: newBal,
          referenceId: withdrawal.id,
        });

        if (withdrawal.walletTxId) {
          await tx.walletTransaction.update({
            where: { id: withdrawal.walletTxId },
            data: { status: 'REJECTED', note: `Auto payout reverted before broadcast: ${reason}` },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 15_000 }
    );

    await this.alerts.send(
      'WARN',
      `Withdrawal ${withdrawal.id} Failed Pre-Flight & Refunded`,
      reason
    );
  }

  private async finalizeCompletedReceipt(
    withdrawal: Withdrawal,
    receipt: QuorumReceipt
  ): Promise<void> {
    if (receipt.status !== 1) {
      await this.markNeedsReconciliation(
        withdrawal,
        `On-chain receipt ${receipt.hash} reverted (status=${receipt.status}); gas spent — admin review required.`
      );
      return;
    }

    // Verify authentic BEP-20 USDT Transfer log against expected hotWallet -> destination & exact raw amount
    const logOk = verifyTransferLogMatchesPayout(
      receipt,
      this.config.usdtContract,
      this.signer.address,
      withdrawal.destination,
      BigInt(withdrawal.netAmountRaw)
    );
    if (!logOk) {
      await this.markNeedsReconciliation(
        withdrawal,
        `Transfer log mismatch on receipt ${receipt.hash} — expected ${withdrawal.netAmountRaw} raw USDT to ${withdrawal.destination}.`,
        true
      );
      return;
    }

    const updatedCount = await this.prisma.$transaction(async (tx) => {
      const res = await tx.withdrawal.updateMany({
        where: {
          id: withdrawal.id,
          version: withdrawal.version,
          status: 'PROCESSING',
        },
        data: {
          status: 'COMPLETED',
          txHash: receipt.hash,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
          blockNumber: receipt.blockNumber,
          confirmations: receipt.confirmations,
          completedAt: new Date(),
        },
      });
      if (res.count === 1 && withdrawal.walletTxId) {
        await tx.walletTransaction.update({
          where: { id: withdrawal.walletTxId },
          data: {
            status: 'COMPLETED',
            txHash: receipt.hash,
            note: `Dispatched automatically on BEP20 (${receipt.confirmations} confs)`,
          },
        });
      }
      return res.count;
    });

    if (updatedCount === 1) {
      const user = await this.prisma.user.findUnique({
        where: { id: withdrawal.userId },
        select: { telegramChatId: true },
      });
      await this.alerts.notifyUser(
        user?.telegramChatId,
        `✅ *Automatic USDT Withdrawal Sent*\n\nNet Paid: *${withdrawal.netAmountUsdt.toFixed(2)} USDT* (BEP20)\nTo: \`${withdrawal.destination}\`\nTxHash: \`${receipt.hash}\``
      );
    }
  }

  /**
   * Re-verifies every claimed withdrawal against DB invariants before signing.
   * Mitigates: post-approval DB tampering bypassing the API risk engine or ledger.
   */
  private async assertRowIntegrity(withdrawal: Withdrawal): Promise<string> {
    const checksumDest = getAddress(withdrawal.destination);
    if (
      checksumDest !== withdrawal.destination ||
      checksumDest.toLowerCase() === ZeroAddress.toLowerCase() ||
      checksumDest.toLowerCase() === this.signer.address.toLowerCase() ||
      checksumDest.toLowerCase() === this.config.usdtContract.toLowerCase()
    ) {
      throw new Error(`Invalid or prohibited destination address: ${withdrawal.destination}`);
    }

    const expectedRaw = parseUnits(withdrawal.netAmountUsdt.toFixed(6), USDT_BEP20_DECIMALS);
    if (BigInt(withdrawal.netAmountRaw) !== expectedRaw || expectedRaw <= 0n) {
      throw new Error(
        `netAmountRaw integrity failure (dbRaw=${withdrawal.netAmountRaw}, computed=${expectedRaw.toString()})`
      );
    }

    if (withdrawal.amountUsdt.gt(MAX_AUTO_TX_USDT) && !withdrawal.approvedBy) {
      throw new Error(
        `Withdrawal exceeds ${MAX_AUTO_TX_USDT.toFixed(0)} USDT auto threshold without approvedBy.`
      );
    }

    const [user, debitLedger] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: withdrawal.userId },
        select: { isSuspended: true },
      }),
      this.prisma.walletBalance.findUnique({
        where: {
          type_referenceId_userId: {
            type: 'WITHDRAWAL_DEBIT',
            referenceId: withdrawal.id,
            userId: withdrawal.userId,
          },
        },
      }),
    ]);

    if (!user || user.isSuspended) {
      throw new Error('User account missing or suspended before broadcast.');
    }
    if (!debitLedger || !debitLedger.amount.neg().eq(withdrawal.amountUsdt)) {
      throw new Error('Matching immutable WITHDRAWAL_DEBIT ledger entry missing.');
    }

    return checksumDest;
  }

  private async signTxForPayout(
    destination: string,
    netAmountRaw: bigint,
    nonce: number,
    gasLimit: bigint,
    fee: QuorumFeeData
  ): Promise<{ rawTx: string; txHash: string }> {
    const data = ERC20_IFACE.encodeFunctionData('transfer', [destination, netAmountRaw]);
    const txReq: TransactionRequest = {
      to: this.config.usdtContract,
      data,
      nonce,
      gasLimit,
      chainId: BigInt(this.config.chainId),
      ...(fee.supportsEip1559
        ? {
            type: 2,
            maxFeePerGas: fee.maxFeePerGas,
            maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
          }
        : {
            type: 0,
            gasPrice: fee.gasPrice,
          }),
    };

    const rawTx = await this.signer.signTransaction(txReq);
    const txHash = keccak256(rawTx).toLowerCase();
    return { rawTx, txHash };
  }

  private async waitAndBumpUntilFinality(
    initialWithdrawal: Withdrawal,
    initialFee: QuorumFeeData,
    gasLimit: bigint,
    initialHashes: string[]
  ): Promise<void> {
    let withdrawal = initialWithdrawal;
    let currentFee = initialFee;
    const trackedHashes = new Set(initialHashes.map((h) => h.toLowerCase()));

    for (let bumpAttempt = 0; bumpAttempt <= MAX_GAS_BUMPS; bumpAttempt++) {
      const deadline = Date.now() + this.config.receiptTimeoutMs;

      while (Date.now() <= deadline) {
        for (const candidateHash of trackedHashes) {
          const receipt = await this.pool.getQuorumReceipt(candidateHash);
          if (receipt && receipt.confirmations >= REQUIRED_CONFIRMATIONS) {
            await this.finalizeCompletedReceipt(withdrawal, receipt);
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      // Timed out awaiting confirmation: verify whether nonce is already mined before replacing
      const latestChainNonce = await this.pool.quorumTransactionCount(this.signer.address, 'latest');
      if (withdrawal.nonce !== null && latestChainNonce > withdrawal.nonce) {
        // One last sweep of all candidate broadcast hashes before pausing for human check
        for (const candidateHash of trackedHashes) {
          const receipt = await this.pool.getQuorumReceipt(candidateHash);
          if (receipt) {
            if (receipt.confirmations >= REQUIRED_CONFIRMATIONS) {
              await this.finalizeCompletedReceipt(withdrawal, receipt);
              return;
            }
          }
        }
        await this.markNeedsReconciliation(
          withdrawal,
          `Nonce ${withdrawal.nonce} already confirmed on-chain while none of ${trackedHashes.size} recorded hashes reached quorum confirmation.`,
          true
        );
        return;
      }

      if (bumpAttempt === MAX_GAS_BUMPS) {
        await this.markNeedsReconciliation(
          withdrawal,
          `Transaction stuck in mempool after ${MAX_GAS_BUMPS} same-nonce gas replacements.`,
          true
        );
        return;
      }

      if (withdrawal.nonce === null) {
        await this.markNeedsReconciliation(withdrawal, 'Missing nonce during replacement bump.', true);
        return;
      }

      // Same-nonce replacement bump (+12.5%) with write-ahead persistence BEFORE broadcast
      const nextFee = computeReplacementFee(currentFee, this.config.maxGwei);
      const { rawTx, txHash } = await this.signTxForPayout(
        withdrawal.destination,
        BigInt(withdrawal.netAmountRaw),
        withdrawal.nonce,
        gasLimit,
        nextFee
      );

      withdrawal = await this.prisma.$transaction(async (tx) => {
        await tx.withdrawalBroadcast.create({
          data: {
            withdrawalId: withdrawal.id,
            txHash,
            nonce: withdrawal.nonce as number,
            maxFeePerGas: nextFee.maxFeePerGas.toString(),
            maxPriorityFee: nextFee.maxPriorityFeePerGas.toString(),
            rpcUrl: 'pool-replacement',
          },
        });
        return await tx.withdrawal.update({
          where: { id: withdrawal.id, version: withdrawal.version },
          data: {
            attempts: { increment: 1 },
            lastError: `Stuck > ${Math.round(this.config.receiptTimeoutMs / 1000)}s; bumped gas (${bumpAttempt + 1}/${MAX_GAS_BUMPS})`,
          },
        });
      });

      currentFee = nextFee;
      trackedHashes.add(txHash);
      await this.pool.broadcastAll(rawTx);
      await this.alerts.send(
        'WARN',
        `Same-Nonce Gas Bump Issued (${bumpAttempt + 1}/${MAX_GAS_BUMPS})`,
        `withdrawal=${withdrawal.id} nonce=${withdrawal.nonce} newTx=${txHash}`
      );
    }
  }

  /**
   * Crash-recovery step executed on boot before claiming new PENDING work.
   * Ensures in-flight PROCESSING withdrawals are never re-queued or double-paid.
   */
  async recoverInFlightPayouts(): Promise<void> {
    // 1. Re-queue stale pre-sign SIMULATING rows (strictly nonce IS NULL)
    const staleSim = await this.prisma.withdrawal.findMany({
      where: { network: 'BEP20', status: 'SIMULATING' },
    });
    for (const row of staleSim) {
      if (row.nonce === null) {
        await this.prisma.withdrawal.updateMany({
          where: { id: row.id, version: row.version, status: 'SIMULATING', nonce: null },
          data: {
            status: 'PENDING',
            lockedBy: null,
            lockedAt: null,
            lastError: 'Recovered pre-sign SIMULATING state after worker restart',
          },
        });
      } else {
        await this.markNeedsReconciliation(
          row,
          'Found SIMULATING row with non-null nonce during boot recovery.',
          true
        );
      }
    }

    // 2. Reconcile every PROCESSING row strictly via recorded WithdrawalBroadcast hashes
    const processingRows = await this.prisma.withdrawal.findMany({
      where: { network: 'BEP20', status: 'PROCESSING' },
      include: { broadcasts: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'asc' },
    });

    for (const row of processingRows) {
      if (row.broadcasts.length === 0 || row.nonce === null) {
        await this.markNeedsReconciliation(
          row,
          'PROCESSING row missing WithdrawalBroadcast history during crash recovery.',
          true
        );
        continue;
      }

      let resolved = false;
      for (const b of row.broadcasts) {
        const receipt = await this.pool.getQuorumReceipt(b.txHash);
        if (receipt && receipt.confirmations >= REQUIRED_CONFIRMATIONS) {
          await this.finalizeCompletedReceipt(row, receipt);
          resolved = true;
          break;
        }
      }
      if (resolved) continue;

      const latestChainNonce = await this.pool.quorumTransactionCount(this.signer.address, 'latest');
      if (latestChainNonce > row.nonce) {
        await this.markNeedsReconciliation(
          row,
          `On-chain nonce (${latestChainNonce}) advanced past PROCESSING nonce (${row.nonce}) without quorum receipt match.`,
          true
        );
        continue;
      }

      // Still unmined in mempool: continue monitoring all existing broadcast hashes and bump if stuck
      const latestB = row.broadcasts[0];
      const fee: QuorumFeeData = {
        gasPrice: BigInt(latestB.maxFeePerGas),
        maxFeePerGas: BigInt(latestB.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(latestB.maxPriorityFee),
        supportsEip1559: true,
      };
      await this.waitAndBumpUntilFinality(
        row,
        fee,
        MAX_SAFE_GAS_LIMIT,
        row.broadcasts.map((b) => b.txHash)
      );
    }
  }

  /**
   * Executes one single worker polling cycle. Returns true if a withdrawal was processed.
   */
  async runTick(): Promise<boolean> {
    const control = await this.prisma.payoutControl.upsert({
      where: { id: 'BEP20' },
      create: { id: 'BEP20', paused: false, lastHeartbeatAt: new Date() },
      update: { lastHeartbeatAt: new Date() },
    });

    if (control.paused) {
      return false;
    }

    // Drain protection BEFORE claiming any row: halt immediately if BNB gas or hot USDT runs low
    const [bnbBalance, usdtBalance] = await Promise.all([
      this.pool.quorumNativeBalance(this.signer.address),
      this.pool.quorumTokenBalance(this.config.usdtContract, this.signer.address),
    ]);

    if (bnbBalance < this.config.minBnbWei || usdtBalance < this.config.minUsdtRaw) {
      await this.pauseWorker(
        `Drain protection triggered: BNB=${formatEther(bnbBalance)} (min ${formatEther(
          this.config.minBnbWei
        )}), USDT=${formatUnits(usdtBalance, USDT_BEP20_DECIMALS)} (min ${formatUnits(
          this.config.minUsdtRaw,
          USDT_BEP20_DECIMALS
        )})`
      );
      return false;
    }

    // Enforce global 24h platform outflow ceiling to limit hot-wallet blast radius
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const outflowAgg = await this.prisma.withdrawal.aggregate({
      where: {
        network: 'BEP20',
        status: { in: ['COMPLETED', 'PROCESSING'] },
        createdAt: { gte: since },
      },
      _sum: { netAmountUsdt: true },
    });
    const sent24h = outflowAgg._sum.netAmountUsdt ?? new Prisma.Decimal(0);
    if (sent24h.gte(control.dailyCapUsdt)) {
      await this.pauseWorker(
        `Platform 24h BEP-20 outflow cap reached (${sent24h.toFixed(2)} / ${control.dailyCapUsdt.toFixed(
          2
        )} USDT).`
      );
      return false;
    }

    // Claim oldest eligible PENDING withdrawal atomically using PostgreSQL SKIP LOCKED
    const claimed = await this.prisma.$queryRaw<Withdrawal[]>`
      UPDATE "Withdrawal" w
      SET "status" = 'SIMULATING',
          "lockedBy" = ${this.config.workerId},
          "lockedAt" = now(),
          "updatedAt" = now()
      WHERE w."id" = (
        SELECT id FROM "Withdrawal"
        WHERE "status" = 'PENDING' AND "network" = 'BEP20'
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING w.*
    `;

    const row = claimed[0];
    if (!row) return false;

    // Post-claim integrity validation before touching RPC or key
    let checksumDest: string;
    try {
      checksumDest = await this.assertRowIntegrity(row);
    } catch (integrityErr) {
      await this.markNeedsReconciliation(
        row,
        `Integrity verification failed: ${
          integrityErr instanceof Error ? integrityErr.message : String(integrityErr)
        }`,
        true
      );
      return true;
    }

    const netRaw = BigInt(row.netAmountRaw);
    const transferData = ERC20_IFACE.encodeFunctionData('transfer', [checksumDest, netRaw]);

    // Pre-flight simulation (eth_call + eth_estimateGas): prevents burning gas on reverting tx
    let gasLimit: bigint;
    let fee: QuorumFeeData;
    try {
      await this.pool.simulateCall({
        from: this.signer.address,
        to: this.config.usdtContract,
        data: transferData,
      });
      const estimated = await this.pool.estimateGas({
        from: this.signer.address,
        to: this.config.usdtContract,
        data: transferData,
      });
      gasLimit = (estimated * 120n) / 100n;
      if (gasLimit > MAX_SAFE_GAS_LIMIT) {
        throw new Error(`Gas estimate safety breach (${gasLimit.toString()} > ${MAX_SAFE_GAS_LIMIT})`);
      }
      fee = await this.pool.feeData(this.config.maxGwei);
    } catch (simErr) {
      const msg = simErr instanceof Error ? simErr.message : String(simErr);
      const isDeterministicRevert =
        /revert|CALL_EXCEPTION|execution reverted|Gas estimate safety breach/i.test(msg);

      if (isDeterministicRevert) {
        await this.failAndRefundPreBroadcast(row, msg);
      } else {
        // Transient RPC/gas failure before signing -> safely release back to PENDING
        await this.prisma.withdrawal.updateMany({
          where: { id: row.id, version: row.version, status: 'SIMULATING', nonce: null },
          data: {
            status: 'PENDING',
            attempts: { increment: 1 },
            lockedBy: null,
            lockedAt: null,
            lastError: `Transient simulation error: ${msg}`.slice(0, 500),
          },
        });
      }
      return true;
    }

    // Write-ahead phase: reserve nonce, sign raw tx, and commit hash + PROCESSING BEFORE broadcast
    let signed: { rawTx: string; txHash: string; nonce: number; updatedRow: Withdrawal };
    try {
      signed = await this.prisma.$transaction(
        async (tx) => {
          const nonce = await reserveNextNonce(tx);
          const { rawTx, txHash } = await this.signTxForPayout(
            checksumDest,
            netRaw,
            nonce,
            gasLimit,
            fee
          );

          const moved = await tx.withdrawal.updateMany({
            where: { id: row.id, version: row.version, status: 'SIMULATING', nonce: null },
            data: {
              status: 'PROCESSING',
              nonce,
              attempts: { increment: 1 },
            },
          });
          if (moved.count !== 1) {
            throw new Error('Optimistic concurrency mismatch during write-ahead commit.');
          }

          await tx.withdrawalBroadcast.create({
            data: {
              withdrawalId: row.id,
              txHash,
              nonce,
              maxFeePerGas: fee.maxFeePerGas.toString(),
              maxPriorityFee: fee.maxPriorityFeePerGas.toString(),
              rpcUrl: 'pool-all',
            },
          });

          const updatedRow = await tx.withdrawal.findUniqueOrThrow({ where: { id: row.id } });
          return { rawTx, txHash, nonce, updatedRow };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 15_000 }
      );
    } catch (writeAheadErr) {
      await this.markNeedsReconciliation(
        row,
        `Write-ahead commit aborted: ${
          writeAheadErr instanceof Error ? writeAheadErr.message : String(writeAheadErr)
        }`,
        true
      );
      return true;
    }

    // Broadcast to all healthy RPCs
    const broadcastRes = await this.pool.broadcastAll(signed.rawTx);
    if (broadcastRes.acceptedBy.length === 0) {
      const errMsg = broadcastRes.firstError || 'All RPC providers rejected raw transaction.';
      if (/nonce too low|nonce has already been used/i.test(errMsg)) {
        const alreadyReceipt = await this.pool.getQuorumReceipt(signed.txHash);
        if (alreadyReceipt && alreadyReceipt.confirmations >= REQUIRED_CONFIRMATIONS) {
          await this.finalizeCompletedReceipt(signed.updatedRow, alreadyReceipt);
          return true;
        }
        await this.markNeedsReconciliation(
          signed.updatedRow,
          `RPC reported "${errMsg}" for nonce ${signed.nonce} — halting signer for immediate audit.`,
          true
        );
        return true;
      }
      await this.alerts.send(
        'WARN',
        `Broadcast Warning on Withdrawal ${row.id}`,
        `0 nodes confirmed immediate acceptance (${errMsg}); proceeding to finality/bump monitor.`
      );
    }

    await this.waitAndBumpUntilFinality(signed.updatedRow, fee, gasLimit, [signed.txHash]);
    return true;
  }
}

function loadWorkerEnvFileIfPresent(): void {
  const envPath =
    process.env.WORKER_ENV_FILE?.trim() || path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    let v = trimmed.slice(eqIdx + 1).trim();
    if (
      v.length >= 2 &&
      ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) {
      process.env[k] = v;
    }
  }
}

async function main(): Promise<void> {
  loadWorkerEnvFileIfPresent();
  const config = loadWorkerConfig();
  const prisma = new PrismaClient();
  const alerts = createTelegramAlerter();

  const urls = parseConfiguredRpcUrls();
  const pool = new BscRpcPool(urls, config.chainId, 2);
  await pool.verifyHealthAndChainIds();

  const signer = await loadIsolatedHotWallet();

  // Optional direct Postgres session advisory lock for single-signer guarantee when direct URL is used
  const lockId = crypto.createHash('sha256').update('fetan-payout-engine-bep20').digest().readInt32BE(0);
  const lockRes = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(${lockId}) AS "locked"
  `;
  if (lockRes[0] && !lockRes[0].locked) {
    throw new Error('Another payout worker instance already holds the advisory lock.');
  }

  const engine = new PayoutEngine(prisma, pool, signer, alerts, config);

  await syncNonceOnBoot(prisma, pool, signer.address, alerts);
  await engine.recoverInFlightPayouts();
  await reconcileLedgerAndReserves(prisma, pool, config.usdtContract, signer.address, alerts);

  await alerts.send(
    'INFO',
    'BEP-20 Payout Worker Online',
    `worker=${config.workerId} chain=${config.chainId} hotWallet=${signer.address} rpcs=${urls.length}`
  );

  let lastReconcileAt = Date.now();
  let shuttingDown = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      shuttingDown = true;
    });
  }

  try {
    while (!shuttingDown) {
      try {
        await pool.verifyHealthAndChainIds();
        await engine.runTick();

        if (Date.now() - lastReconcileAt >= config.reconcileIntervalMs) {
          await reconcileLedgerAndReserves(prisma, pool, config.usdtContract, signer.address, alerts);
          lastReconcileAt = Date.now();
        }
      } catch (loopErr) {
        await alerts.send(
          'WARN',
          'Worker Loop Recoverable Error',
          loopErr instanceof Error ? loopErr.message : String(loopErr)
        );
      }

      if (!shuttingDown) {
        await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal payout worker error:', err);
    process.exit(1);
  });
}
