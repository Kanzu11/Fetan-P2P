import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';

// Load local .env for Node test runner when not already injected
function loadDotEnvIfPresent() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadDotEnvIfPresent();

import { prisma } from '../server/database/prisma';
import { applyPayoutDatabaseGuards } from '../server/database/apply-payout-guards';
import { appendLedgerEntry } from '../server/payouts/ledger';
import { evaluateWithdrawalRisk } from '../server/payouts/risk-engine';
import { validatePayoutDestination } from '../server/payouts/address-guard';
import {
  enforceWithdrawalRateLimit,
  WithdrawalRateLimitError,
} from '../server/payouts/redis-rate-limit';
import { createOtpChallenge } from '../server/security/otp';
import { SESSION_COOKIE_NAME, signSessionToken } from '../server/security/session';
import { POST as postWithdrawAlias } from '../app/api/withdraw/route';
import { POST as postAdminWithdrawals } from '../app/api/admin/withdrawals/route';
import { GET as getHealth } from '../app/api/health/route';
import { POST as postTelegramWebhook } from '../app/api/telegram/webhook/route';
import { POST as postTelegramSync } from '../app/api/telegram/sync/route';
import type { Redis } from '@upstash/redis';
import os from 'node:os';
import { BaseWallet, keccak256, parseEther, parseUnits, Transaction, Wallet } from 'ethers';
import { ERC20_TRANSFER_TOPIC } from '../server/payouts/constants';
import { syncNonceOnBoot } from '../workers/payout-engine/nonce-manager';
import { PayoutEngine, loadWorkerConfig } from '../workers/payout-engine/payout-engine';
import type { PayoutAlerter } from '../workers/payout-engine/alerts';
import type { QuorumFeeData, QuorumReceipt, RpcPoolInterface } from '../workers/payout-engine/rpc-pool';
import { loadIsolatedHotWallet } from '../workers/payout-engine/secrets';

const RUN_TAG = crypto.randomBytes(4).toString('hex');
const createdUserIds: string[] = [];
const createdEmails: string[] = [];
const createdRateKeys: string[] = [];

async function purgeTestUsers(userIds: string[]) {
  if (userIds.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL fetan.allow_test_ledger_cleanup = 'on'`);
    await tx.walletBalance.deleteMany({ where: { userId: { in: userIds } } });
    await tx.withdrawalBroadcast.deleteMany({
      where: { withdrawal: { userId: { in: userIds } } },
    });
    await tx.withdrawal.deleteMany({ where: { userId: { in: userIds } } });
    await tx.walletTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await tx.auditLog.deleteMany({
      where: {
        OR: [{ actorId: { in: userIds } }, { targetId: { in: userIds } }],
      },
    });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

after(async () => {
  try {
    if (createdEmails.length > 0) {
      await prisma.otpChallenge.deleteMany({ where: { email: { in: createdEmails } } });
    }
    if (createdRateKeys.length > 0) {
      await prisma.rateLimitRecord.deleteMany({ where: { key: { in: createdRateKeys } } });
    }
    if (createdUserIds.length > 0) {
      await purgeTestUsers(createdUserIds);
    }
  } finally {
    await prisma.$disconnect();
  }
});

test('Phase 1: SQL state-machine trigger blocks illegal jumps, field tampering, and bumps version', async () => {
  await applyPayoutDatabaseGuards(prisma);

  const user = await prisma.user.create({
    data: {
      id: `usr-p1-${RUN_TAG}`,
      email: `p1-${RUN_TAG}@fetan.test`,
      name: `P1 Guard ${RUN_TAG}`,
      role: 'USER',
      kycStatus: 'VERIFIED',
      usdtBalance: new Prisma.Decimal('250.000000'),
    },
  });
  createdUserIds.push(user.id);

  const w = await prisma.withdrawal.create({
    data: {
      userId: user.id,
      idempotencyKey: crypto.randomUUID(),
      requestHash: `hash-${RUN_TAG}`,
      network: 'BEP20',
      destination: '0x1111111111111111111111111111111111111111',
      amountUsdt: new Prisma.Decimal('25.000000'),
      feeUsdt: new Prisma.Decimal('0.500000'),
      netAmountUsdt: new Prisma.Decimal('24.500000'),
      netAmountRaw: '24500000000000000000',
      status: 'PENDING',
    },
  });

  // 1. Illegal direct jump PENDING -> COMPLETED must be rejected by trigger
  await assert.rejects(
    () =>
      prisma.withdrawal.update({
        where: { id: w.id },
        data: { status: 'COMPLETED', txHash: `0x${'b'.repeat(64)}` },
      }),
    /Illegal withdrawal status transition/
  );

  // 2. Tampering with destination or netAmountRaw must be rejected by trigger
  await assert.rejects(
    () =>
      prisma.withdrawal.update({
        where: { id: w.id },
        data: { destination: '0x2222222222222222222222222222222222222222' },
      }),
    /immutable/
  );

  // 3. Legal transition PENDING -> SIMULATING increments version monotonically
  const sim = await prisma.withdrawal.update({
    where: { id: w.id },
    data: { status: 'SIMULATING', lockedBy: 'test-worker' },
  });
  assert.equal(sim.version, 1);

  // 4. SIMULATING -> PROCESSING without nonce must fail
  await assert.rejects(
    () =>
      prisma.withdrawal.update({
        where: { id: w.id },
        data: { status: 'PROCESSING' },
      }),
    /Illegal withdrawal status transition/
  );

  // 5. Legal SIMULATING -> PROCESSING with nonce = 990001 + test RUN_TAG hash integer
  const testNonce = 900_000 + parseInt(RUN_TAG.slice(0, 4), 16);
  const proc = await prisma.withdrawal.update({
    where: { id: w.id },
    data: { status: 'PROCESSING', nonce: testNonce },
  });
  assert.equal(proc.version, 2);

  // 6. PROCESSING -> PENDING (re-queue double payout!) MUST fail at DB trigger level
  await assert.rejects(
    () =>
      prisma.withdrawal.update({
        where: { id: w.id },
        data: { status: 'PENDING' },
      }),
    /Illegal withdrawal status transition/
  );

  // 7. Legal PROCESSING -> COMPLETED freezes terminal row
  const txHash = `0x${crypto.randomBytes(32).toString('hex')}`;
  const done = await prisma.withdrawal.update({
    where: { id: w.id },
    data: { status: 'COMPLETED', txHash, confirmations: 2 },
  });
  assert.equal(done.version, 3);

  await assert.rejects(
    () =>
      prisma.withdrawal.update({
        where: { id: w.id },
        data: { status: 'FAILED' },
      }),
    /Terminal withdrawal status/
  );
});

test('Phase 1: WalletBalance ledger is append-only (UPDATE/DELETE rejected) and deduplicates replays', async () => {
  const user = await prisma.user.create({
    data: {
      id: `usr-led-${RUN_TAG}`,
      email: `led-${RUN_TAG}@fetan.test`,
      name: `P1 Ledger ${RUN_TAG}`,
      role: 'USER',
      kycStatus: 'VERIFIED',
      usdtBalance: new Prisma.Decimal('100.000000'),
    },
  });
  createdUserIds.push(user.id);

  const refId = `wdr-ref-${RUN_TAG}`;
  await prisma.$transaction(async (tx) => {
    await appendLedgerEntry(tx, {
      userId: user.id,
      type: 'WITHDRAWAL_DEBIT',
      amount: '-25.000000',
      balanceAfter: '75.000000',
      referenceId: refId,
    });
  });

  // Duplicate refund/debit with same (type, referenceId, userId) must violate unique index
  await assert.rejects(
    () =>
      prisma.$transaction(async (tx) => {
        await appendLedgerEntry(tx, {
          userId: user.id,
          type: 'WITHDRAWAL_DEBIT',
          amount: '-25.000000',
          balanceAfter: '50.000000',
          referenceId: refId,
        });
      }),
    /Unique constraint/
  );

  const ledgerRow = await prisma.walletBalance.findFirstOrThrow({
    where: { userId: user.id, referenceId: refId },
  });

  // UPDATE or DELETE without test cleanup setting must raise Postgres trigger exception
  await assert.rejects(
    () =>
      prisma.walletBalance.update({
        where: { id: ledgerRow.id },
        data: { amount: new Prisma.Decimal('0.000000') },
      }),
    /append-only/
  );

  await assert.rejects(
    () =>
      prisma.walletBalance.delete({
        where: { id: ledgerRow.id },
      }),
    /append-only/
  );
});

test('Phase 2: Risk engine enforces 100 USDT single-tx, 500 USDT/24h velocity, and 24h account age limits', async () => {
  const matureDate = new Date(Date.now() - 48 * 3600_000);
  const youngDate = new Date(Date.now() - 2 * 3600_000);

  const user = await prisma.user.create({
    data: {
      id: `usr-risk-${RUN_TAG}`,
      email: `risk-${RUN_TAG}@fetan.test`,
      name: `P2 Risk ${RUN_TAG}`,
      role: 'USER',
      kycStatus: 'VERIFIED',
      usdtBalance: new Prisma.Decimal('1000.000000'),
      createdAt: matureDate,
    },
  });
  createdUserIds.push(user.id);

  // 1. Account < 24h old must go to MANUAL_REVIEW even for small BEP20 amount
  const youngRes = await prisma.$transaction((tx) =>
    evaluateWithdrawalRisk(tx, {
      userId: user.id,
      network: 'BEP20',
      amountUsdt: new Prisma.Decimal('20.000000'),
      accountCreatedAt: youngDate,
    })
  );
  assert.equal(youngRes.status, 'MANUAL_REVIEW');

  // 2. Single tx > 100 USDT -> MANUAL_REVIEW; <= 100 USDT -> PENDING
  const overSingle = await prisma.$transaction((tx) =>
    evaluateWithdrawalRisk(tx, {
      userId: user.id,
      network: 'BEP20',
      amountUsdt: new Prisma.Decimal('100.000001'),
      accountCreatedAt: matureDate,
    })
  );
  assert.equal(overSingle.status, 'MANUAL_REVIEW');

  const okSingle = await prisma.$transaction((tx) =>
    evaluateWithdrawalRisk(tx, {
      userId: user.id,
      network: 'BEP20',
      amountUsdt: new Prisma.Decimal('100.000000'),
      accountCreatedAt: matureDate,
    })
  );
  assert.equal(okSingle.status, 'PENDING');

  // 3. Seed 5 x 95 USDT active withdrawals (475 USDT in 24h) + 1 FAILED 50 USDT (excluded!)
  for (let i = 0; i < 5; i++) {
    await prisma.withdrawal.create({
      data: {
        userId: user.id,
        idempotencyKey: crypto.randomUUID(),
        requestHash: `rh-${RUN_TAG}-${i}`,
        network: 'BEP20',
        destination: '0x1111111111111111111111111111111111111111',
        amountUsdt: new Prisma.Decimal('95.000000'),
        feeUsdt: new Prisma.Decimal('0.500000'),
        netAmountUsdt: new Prisma.Decimal('94.500000'),
        netAmountRaw: '94500000000000000000',
        status: 'COMPLETED',
        txHash: `0x${crypto.randomBytes(32).toString('hex')}`,
      },
    });
  }
  await prisma.withdrawal.create({
    data: {
      userId: user.id,
      idempotencyKey: crypto.randomUUID(),
      requestHash: `rh-${RUN_TAG}-fail`,
      network: 'BEP20',
      destination: '0x1111111111111111111111111111111111111111',
      amountUsdt: new Prisma.Decimal('50.000000'),
      feeUsdt: new Prisma.Decimal('0.500000'),
      netAmountUsdt: new Prisma.Decimal('49.500000'),
      netAmountRaw: '49500000000000000000',
      status: 'FAILED',
    },
  });

  // 475 + 25 = 500 -> still PENDING
  const atCap = await prisma.$transaction((tx) =>
    evaluateWithdrawalRisk(tx, {
      userId: user.id,
      network: 'BEP20',
      amountUsdt: new Prisma.Decimal('25.000000'),
      accountCreatedAt: matureDate,
    })
  );
  assert.equal(atCap.status, 'PENDING');

  // 475 + 25.01 = 500.01 -> exceeds 500/24h -> MANUAL_REVIEW
  const overCap = await prisma.$transaction((tx) =>
    evaluateWithdrawalRisk(tx, {
      userId: user.id,
      network: 'BEP20',
      amountUsdt: new Prisma.Decimal('25.010000'),
      accountCreatedAt: matureDate,
    })
  );
  assert.equal(overCap.status, 'MANUAL_REVIEW');
});

test('Phase 2: Address guard & fail-closed Redis rate limiter defend invalid addresses and store outages', async () => {
  // Invalid mixed-case EIP-55 checksum must be rejected
  const badChecksum = validatePayoutDestination(
    '0x55d398326F99059fF775485246999027B3197955'.replace('F', 'f'),
    'BEP20',
    'usr-addr-1'
  );
  assert.equal(badChecksum.valid, false);

  // Zero address & USDT BEP-20 contract address must be rejected
  assert.equal(
    validatePayoutDestination('0x0000000000000000000000000000000000000000', 'BEP20', 'usr-addr-1')
      .valid,
    false
  );
  assert.equal(
    validatePayoutDestination('0x55d398326f99059ff775485246999027b3197955', 'BEP20', 'usr-addr-1')
      .valid,
    false
  );

  // Valid lowercase EVM address normalizes cleanly to EIP-55 checksum
  const validDest = validatePayoutDestination(
    '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    'BEP20',
    'usr-addr-1'
  );
  assert.equal(validDest.valid, true);
  assert.equal(validDest.canonicalAddress, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');

  // Fail-closed: Redis error MUST raise 503 WithdrawalRateLimitError instead of allowing withdrawals
  const brokenRedis = {
    eval: async () => {
      throw new Error('ECONNREFUSED redis down');
    },
  } as unknown as Redis;

  await assert.rejects(
    () => enforceWithdrawalRateLimit('usr-rl-1', '198.51.100.1', brokenRedis),
    (err: unknown) => err instanceof WithdrawalRateLimitError && err.statusCode === 503
  );
});

test('Phase 2: /api/withdraw enforces strict Zod, parallel UUIDv4 idempotency, 422 mismatch, and admin review flow', async () => {
  const matureDate = new Date(Date.now() - 48 * 3600_000);
  const email = `p2api-${RUN_TAG}@fetan.test`;
  const testIp = '198.51.100.77';
  const destAddr = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  createdEmails.push(email);

  const user = await prisma.user.create({
    data: {
      id: `usr-p2-${RUN_TAG}`,
      email,
      name: `P2 User ${RUN_TAG}`,
      role: 'USER',
      kycStatus: 'VERIFIED',
      usdtBalance: new Prisma.Decimal('500.000000'),
      createdAt: matureDate,
    },
  });
  const admin = await prisma.user.create({
    data: {
      id: `adm-p2-${RUN_TAG}`,
      email: `adm-p2-${RUN_TAG}@fetan.test`,
      name: `P2 Admin ${RUN_TAG}`,
      role: 'ADMIN',
      kycStatus: 'VERIFIED',
    },
  });
  createdUserIds.push(user.id, admin.id);
  createdRateKeys.push(`wdr:rl:user:${user.id}`, `wdr:rl:ip:${testIp}`);
  const localIds: string[] = [user.id, admin.id];

  try {

  const userCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    signSessionToken(user.id, 'USER')
  )}`;
  const adminCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    signSessionToken(admin.id, 'ADMIN')
  )}`;

  // 1. Missing or non-v4 Idempotency-Key -> 400
  const missingKeyRes = await postWithdrawAlias(
    new Request('http://localhost/api/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: userCookie, 'x-forwarded-for': testIp },
      body: '{}',
    })
  );
  assert.equal(missingKeyRes.status, 400);

  const badUuidRes = await postWithdrawAlias(
    new Request('http://localhost/api/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: userCookie,
        'idempotency-key': 'not-a-uuid-v4',
        'x-forwarded-for': testIp,
      },
      body: '{}',
    })
  );
  assert.equal(badUuidRes.status, 400);

  // 2. Strict Zod rejects numeric float amounts and extra keys (e.g. status: "COMPLETED")
  const strictFailRes = await postWithdrawAlias(
    new Request('http://localhost/api/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: userCookie,
        'idempotency-key': crypto.randomUUID(),
        'x-forwarded-for': testIp,
      },
      body: JSON.stringify({
        amountUsdt: 25,
        network: 'BEP20',
        destinationAddress: destAddr,
        otpCode: '123456',
        status: 'COMPLETED',
      }),
    })
  );
  assert.equal(strictFailRes.status, 400);

  // 3. Parallel double-click race with identical UUIDv4 Idempotency-Key -> only ONE debit & row!
  const otp1 = await createOtpChallenge({
    email,
    purpose: 'WITHDRAW',
    metadata: { amountUsdt: 25, network: 'BEP20', destinationAddress: destAddr },
  });
  const idemKey1 = crypto.randomUUID();
  const makeReq = () =>
    postWithdrawAlias(
      new Request('http://localhost/api/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: userCookie,
          'idempotency-key': idemKey1,
          'x-forwarded-for': testIp,
        },
        body: JSON.stringify({
          amountUsdt: '25.00',
          network: 'BEP20',
          destinationAddress: destAddr,
          otpCode: otp1.code,
        }),
      })
    );

  const [r1, r2, r3] = await Promise.all([makeReq(), makeReq(), makeReq()]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r3.status, 200);

  const userAfterAuto = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(Number(userAfterAuto.usdtBalance), 475);

  const countW1 = await prisma.withdrawal.count({ where: { idempotencyKey: idemKey1 } });
  assert.equal(countW1, 1);
  const w1 = await prisma.withdrawal.findUniqueOrThrow({ where: { idempotencyKey: idemKey1 } });
  assert.equal(w1.status, 'PENDING');
  assert.equal(w1.netAmountRaw, '24500000000000000000'); // (25 - 0.5) * 1e18

  // 4. Reusing idemKey1 with a modified amount must fail with 422
  const mismatchRes = await postWithdrawAlias(
    new Request('http://localhost/api/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: userCookie,
        'idempotency-key': idemKey1,
        'x-forwarded-for': testIp,
      },
      body: JSON.stringify({
        amountUsdt: '30.00',
        network: 'BEP20',
        destinationAddress: destAddr,
        otpCode: '000000',
      }),
    })
  );
  assert.equal(mismatchRes.status, 422);

  // 5. High-value > 100 USDT routes to MANUAL_REVIEW, then admin REJECT refunds via ledger
  const email2 = `p2api2-${RUN_TAG}@fetan.test`;
  createdEmails.push(email2);
  const user2 = await prisma.user.create({
    data: {
      id: `usr-p2b-${RUN_TAG}`,
      email: email2,
      name: `P2 User2 ${RUN_TAG}`,
      role: 'USER',
      kycStatus: 'VERIFIED',
      usdtBalance: new Prisma.Decimal('400.000000'),
      createdAt: matureDate,
    },
  });
  createdUserIds.push(user2.id);
  localIds.push(user2.id);
  createdRateKeys.push(`wdr:rl:user:${user2.id}`);
  const user2Cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    signSessionToken(user2.id, 'USER')
  )}`;

  const otp2 = await createOtpChallenge({
    email: email2,
    purpose: 'WITHDRAW',
    metadata: { amountUsdt: 150, network: 'BEP20', destinationAddress: destAddr },
  });
  const idemKey2 = crypto.randomUUID();
  const manualRes = await postWithdrawAlias(
    new Request('http://localhost/api/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: user2Cookie,
        'idempotency-key': idemKey2,
        'x-forwarded-for': testIp,
      },
      body: JSON.stringify({
        amountUsdt: '150.00',
        network: 'BEP20',
        destinationAddress: destAddr,
        otpCode: otp2.code,
      }),
    })
  );
  assert.equal(manualRes.status, 200);
  const manualBody = (await manualRes.json()) as {
    withdrawal: { id: string; status: string };
    transaction: { id: string };
  };
  assert.equal(manualBody.withdrawal.status, 'MANUAL_REVIEW');

  // Admin rejects & refunds -> balance returns from 250 back to 400, ledger records WITHDRAWAL_REFUND
  const rejectRes = await postAdminWithdrawals(
    new Request('http://localhost/api/admin/withdrawals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ txId: manualBody.transaction.id, action: 'REJECT', note: 'Test refund' }),
    })
  );
  assert.equal(rejectRes.status, 200);

  const userAfterRefund = await prisma.user.findUniqueOrThrow({ where: { id: user2.id } });
  assert.equal(Number(userAfterRefund.usdtBalance), 400);

  // Second reject must fail with 409 (no double refund)
  const doubleRejectRes = await postAdminWithdrawals(
    new Request('http://localhost/api/admin/withdrawals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ txId: manualBody.transaction.id, action: 'REJECT' }),
    })
  );
  assert.equal(doubleRejectRes.status, 409);

  // 6. Another MANUAL_REVIEW BEP-20 withdrawal approved by admin moves to PENDING for worker
  const otp3 = await createOtpChallenge({
    email: email2,
    purpose: 'WITHDRAW',
    metadata: { amountUsdt: 120, network: 'BEP20', destinationAddress: destAddr },
  });
  const manual2Res = await postWithdrawAlias(
    new Request('http://localhost/api/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: user2Cookie,
        'idempotency-key': crypto.randomUUID(),
        'x-forwarded-for': testIp,
      },
      body: JSON.stringify({
        amountUsdt: '120.00',
        network: 'BEP20',
        destinationAddress: destAddr,
        otpCode: otp3.code,
      }),
    })
  );
  assert.equal(manual2Res.status, 200);
  const manual2Body = (await manual2Res.json()) as {
    withdrawal: { id: string; status: string };
    transaction: { id: string };
  };
  const approveAutoRes = await postAdminWithdrawals(
    new Request('http://localhost/api/admin/withdrawals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ txId: manual2Body.transaction.id, action: 'APPROVE' }),
    })
  );
  assert.equal(approveAutoRes.status, 200);
  const approveAutoBody = (await approveAutoRes.json()) as { queuedForWorker: boolean };
  assert.equal(approveAutoBody.queuedForWorker, true);
  const queuedW = await prisma.withdrawal.findUniqueOrThrow({ where: { id: manual2Body.withdrawal.id } });
  assert.equal(queuedW.status, 'PENDING');
  assert.equal(queuedW.version, 1);
  } finally {
    await purgeTestUsers(localIds);
  }
});

function createTestAlerter() {
  const sent: Array<{ level: string; title: string; detail?: string }> = [];
  const alerter: PayoutAlerter = {
    async send(level, title, detail) {
      sent.push({ level, title, detail });
    },
    async notifyUser() {
      // no-op in tests
    },
  };
  return { alerter, sent };
}

function makeMockSigner(wallet: BaseWallet) {
  return {
    address: wallet.address,
    signTransaction: (tx: Parameters<BaseWallet['signTransaction']>[0]) =>
      wallet.signTransaction(tx),
  };
}

function makeTransferReceipt(params: {
  hash: string;
  usdtContract: string;
  from: string;
  to: string;
  rawAmount: bigint;
  status?: number;
  confirmations?: number;
  includeValidLog?: boolean;
}): QuorumReceipt {
  const padAddr = (a: string) => `0x000000000000000000000000${a.slice(2).toLowerCase()}`;
  const hexData = `0x${params.rawAmount.toString(16).padStart(64, '0')}`;
  return {
    hash: params.hash.toLowerCase(),
    status: params.status ?? 1,
    blockNumber: 42_000_000,
    confirmations: params.confirmations ?? 2,
    gasUsed: 52_000n,
    effectiveGasPrice: 1_000_000_000n,
    logs:
      params.includeValidLog === false
        ? []
        : [
            {
              address: params.usdtContract.toLowerCase(),
              topics: [ERC20_TRANSFER_TOPIC, padAddr(params.from), padAddr(params.to)],
              data: hexData,
            },
          ],
  };
}

function createMockRpcPool(overrides?: Partial<RpcPoolInterface>): RpcPoolInterface {
  return {
    chainId: 56,
    async verifyHealthAndChainIds() {
      return 42_000_002;
    },
    async quorumBlockNumber() {
      return 42_000_002;
    },
    async quorumNativeBalance() {
      return parseEther('0.5');
    },
    async quorumTokenBalance() {
      return parseUnits('1000', 18);
    },
    async quorumTransactionCount() {
      return 10;
    },
    async simulateCall() {},
    async estimateGas() {
      return 55_000n;
    },
    async feeData(): Promise<QuorumFeeData> {
      return {
        gasPrice: 1_000_000_000n,
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 100_000_000n,
        supportsEip1559: true,
      };
    },
    async broadcastAll() {
      return { acceptedBy: ['https://rpc1.test', 'https://rpc2.test'] };
    },
    async getQuorumReceipt() {
      return null;
    },
    ...overrides,
  };
}

test('Phase 3: Worker secret loader rejects process.env private key, checks pinned address, and loads credential file', async () => {
  const randomWallet = Wallet.createRandom();
  const prevEnvKey = process.env.HOT_WALLET_PRIVATE_KEY;
  const prevAddr = process.env.HOT_WALLET_ADDRESS;
  const prevSource = process.env.HOT_WALLET_KEY_SOURCE;
  const prevKeyFile = process.env.HOT_WALLET_KEY_FILE;
  const tmpFile = path.join(os.tmpdir(), `fetan-key-${RUN_TAG}.txt`);

  try {
    // 1. Refuse HOT_WALLET_PRIVATE_KEY in process.env
    process.env.HOT_WALLET_PRIVATE_KEY = randomWallet.privateKey;
    process.env.HOT_WALLET_ADDRESS = randomWallet.address;
    await assert.rejects(() => loadIsolatedHotWallet(), /NEVER be passed in process\.env/);
    delete process.env.HOT_WALLET_PRIVATE_KEY;

    // 2. Credential file with mismatched pinned address must abort
    fs.writeFileSync(tmpFile, randomWallet.privateKey, { mode: 0o600 });
    process.env.HOT_WALLET_KEY_SOURCE = 'credential';
    process.env.HOT_WALLET_KEY_FILE = tmpFile;
    process.env.HOT_WALLET_ADDRESS = Wallet.createRandom().address;
    await assert.rejects(() => loadIsolatedHotWallet(), /address mismatch/);

    // 3. Matching pinned address loads cleanly
    process.env.HOT_WALLET_ADDRESS = randomWallet.address;
    const loaded = await loadIsolatedHotWallet();
    assert.equal(loaded.address, randomWallet.address);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    if (prevEnvKey === undefined) delete process.env.HOT_WALLET_PRIVATE_KEY;
    else process.env.HOT_WALLET_PRIVATE_KEY = prevEnvKey;
    if (prevAddr === undefined) delete process.env.HOT_WALLET_ADDRESS;
    else process.env.HOT_WALLET_ADDRESS = prevAddr;
    if (prevSource === undefined) delete process.env.HOT_WALLET_KEY_SOURCE;
    else process.env.HOT_WALLET_KEY_SOURCE = prevSource;
    if (prevKeyFile === undefined) delete process.env.HOT_WALLET_KEY_FILE;
    else process.env.HOT_WALLET_KEY_FILE = prevKeyFile;
  }
});

test('Phase 3: Worker enforces drain protection, pre-flight revert refund, happy finality, fabricated log detection, stuck bump, SKIP LOCKED, and crash recovery', async () => {
  const hotWallet = Wallet.createRandom();
  const destAddr = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const cfg = {
    ...loadWorkerConfig(),
    workerId: `test-worker-${RUN_TAG}`,
    receiptTimeoutMs: 120,
    pollIntervalMs: 50,
  };
  const { alerter, sent } = createTestAlerter();

  const u = await prisma.user.create({
    data: {
      id: `usr-p3-${RUN_TAG}`,
      email: `p3-${RUN_TAG}@fetan.test`,
      name: `P3 Worker ${RUN_TAG}`,
      role: 'USER',
      kycStatus: 'VERIFIED',
      usdtBalance: new Prisma.Decimal('400.000000'),
    },
  });
  createdUserIds.push(u.id);

  async function queueTestWithdrawal(tag: string, amt: string, net: string) {
    const wid = crypto.randomUUID();
    const wtxId = `wdr-${wid}`;
    return prisma.$transaction(async (tx) => {
      const curU = await tx.user.findUniqueOrThrow({ where: { id: u.id } });
      const decAmt = new Prisma.Decimal(amt);
      const newBal = curU.usdtBalance.minus(decAmt).toDecimalPlaces(6);
      await tx.user.update({ where: { id: u.id }, data: { usdtBalance: newBal } });
      await tx.walletTransaction.create({
        data: {
          id: wtxId,
          userId: u.id,
          type: 'WITHDRAW',
          amount: decAmt,
          network: 'BEP20',
          address: destAddr,
          status: 'PENDING',
          note: `Test ${tag}`,
        },
      });
      const wRow = await tx.withdrawal.create({
        data: {
          id: wid,
          userId: u.id,
          idempotencyKey: crypto.randomUUID(),
          requestHash: `p3-${RUN_TAG}-${tag}`,
          walletTxId: wtxId,
          network: 'BEP20',
          destination: destAddr,
          amountUsdt: decAmt,
          feeUsdt: new Prisma.Decimal('0.500000'),
          netAmountUsdt: new Prisma.Decimal(net),
          netAmountRaw: parseUnits(net, 18).toString(),
          status: 'PENDING',
        },
      });
      await appendLedgerEntry(tx, {
        userId: u.id,
        type: 'WITHDRAWAL_DEBIT',
        amount: decAmt.neg(),
        balanceAfter: newBal,
        referenceId: wid,
      });
      return wRow;
    });
  }

  try {
    // 1. Foreign pending nonce on boot must pause & alert CRITICAL
    const badBootPool = createMockRpcPool({
      quorumTransactionCount: async (_addr, tag) => (tag === 'latest' ? 5 : 6),
    });
    await assert.rejects(
      () => syncNonceOnBoot(prisma, badBootPool, hotWallet.address, alerter),
      /Unknown pending nonce/
    );
    const pausedControl = await prisma.payoutControl.findUniqueOrThrow({ where: { id: 'BEP20' } });
    assert.equal(pausedControl.paused, true);

    // Reset PayoutControl and sync nonce cleanly at 10
    await prisma.payoutControl.update({
      where: { id: 'BEP20' },
      data: { paused: false, pauseReason: null, nextNonce: null },
    });
    await syncNonceOnBoot(prisma, createMockRpcPool(), hotWallet.address, alerter);

    // 2. Drain protection: BNB below 0.02 pauses without claiming row
    const wDrain = await queueTestWithdrawal('drain', '15.000000', '14.500000');
    const lowBnbEngine = new PayoutEngine(
      prisma,
      createMockRpcPool({ quorumNativeBalance: async () => parseEther('0.005') }),
      makeMockSigner(hotWallet),
      alerter,
      cfg
    );
    const didDrainRun = await lowBnbEngine.runTick();
    assert.equal(didDrainRun, false);
    assert.equal((await prisma.payoutControl.findUniqueOrThrow({ where: { id: 'BEP20' } })).paused, true);
    assert.equal((await prisma.withdrawal.findUniqueOrThrow({ where: { id: wDrain.id } })).status, 'PENDING');
    await prisma.payoutControl.update({ where: { id: 'BEP20' }, data: { paused: false, pauseReason: null } });

    // 3. Pre-flight simulation revert -> FAILED + WITHDRAWAL_REFUND ledger credit
    const revertEngine = new PayoutEngine(
      prisma,
      createMockRpcPool({
        simulateCall: async () => {
          throw new Error('execution reverted: BEP20: blacklisted');
        },
      }),
      makeMockSigner(hotWallet),
      alerter,
      cfg
    );
    await revertEngine.runTick();
    const afterRevert = await prisma.withdrawal.findUniqueOrThrow({ where: { id: wDrain.id } });
    assert.equal(afterRevert.status, 'FAILED');
    assert.equal(afterRevert.nonce, null);
    assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).usdtBalance), 400);

    // 4. Happy path + concurrent SKIP LOCKED across two competing workers
    const wHappy = await queueTestWithdrawal('happy', '25.000000', '24.500000');
    const receipts = new Map<string, QuorumReceipt>();
    const happyPool = createMockRpcPool({
      async broadcastAll(rawTx) {
        const parsed = Transaction.from(rawTx);
        const h = keccak256(rawTx).toLowerCase();
        receipts.set(
          h,
          makeTransferReceipt({
            hash: h,
            usdtContract: cfg.usdtContract,
            from: hotWallet.address,
            to: destAddr,
            rawAmount: BigInt(wHappy.netAmountRaw),
            confirmations: 2,
          })
        );
        assert.equal(parsed.nonce, 10);
        return { acceptedBy: ['https://rpc1.test', 'https://rpc2.test'] };
      },
      async getQuorumReceipt(hash) {
        return receipts.get(hash.toLowerCase()) || null;
      },
    });
    const workerA = new PayoutEngine(prisma, happyPool, makeMockSigner(hotWallet), alerter, {
      ...cfg,
      workerId: `A-${RUN_TAG}`,
    });
    const workerB = new PayoutEngine(prisma, happyPool, makeMockSigner(hotWallet), alerter, {
      ...cfg,
      workerId: `B-${RUN_TAG}`,
    });
    const [ranA, ranB] = await Promise.all([workerA.runTick(), workerB.runTick()]);
    assert.equal(Number(ranA) + Number(ranB), 1, 'SKIP LOCKED must allow only 1 competing worker to claim the row');

    const happyDone = await prisma.withdrawal.findUniqueOrThrow({ where: { id: wHappy.id } });
    assert.equal(happyDone.status, 'COMPLETED');
    assert.equal(happyDone.nonce, 10);
    assert.equal(happyDone.confirmations, 2);
    assert.ok(happyDone.txHash);

    // 5. Lying RPC returning status=1 without matching Transfer log -> NEEDS_RECONCILIATION + auto-pause
    const wFake = await queueTestWithdrawal('fake-log', '10.000000', '9.500000');
    const fakeReceiptMap = new Map<string, QuorumReceipt>();
    const lyingEngine = new PayoutEngine(
      prisma,
      createMockRpcPool({
        async broadcastAll(rawTx) {
          const h = keccak256(rawTx).toLowerCase();
          fakeReceiptMap.set(
            h,
            makeTransferReceipt({
              hash: h,
              usdtContract: cfg.usdtContract,
              from: hotWallet.address,
              to: destAddr,
              rawAmount: BigInt(wFake.netAmountRaw),
              includeValidLog: false,
            })
          );
          return { acceptedBy: ['https://rpc1.test'] };
        },
        async getQuorumReceipt(hash) {
          return fakeReceiptMap.get(hash.toLowerCase()) || null;
        },
      }),
      makeMockSigner(hotWallet),
      alerter,
      cfg
    );
    await lyingEngine.runTick();
    const fakeDone = await prisma.withdrawal.findUniqueOrThrow({ where: { id: wFake.id } });
    assert.equal(fakeDone.status, 'NEEDS_RECONCILIATION');
    assert.equal((await prisma.payoutControl.findUniqueOrThrow({ where: { id: 'BEP20' } })).paused, true);
    await prisma.payoutControl.update({ where: { id: 'BEP20' }, data: { paused: false, pauseReason: null } });

    // 6. Stuck transaction same-nonce +12.5% replacement gas bump
    const wBump = await queueTestWithdrawal('bump', '12.000000', '11.500000');
    const bumpBroadcasts: Array<{ hash: string; nonce: number; maxFeePerGas: bigint }> = [];
    const bumpEngine = new PayoutEngine(
      prisma,
      createMockRpcPool({
        quorumTransactionCount: async (_a, tag) => (tag === 'latest' ? 12 : 13),
        async broadcastAll(rawTx) {
          const tx = Transaction.from(rawTx);
          const h = keccak256(rawTx).toLowerCase();
          bumpBroadcasts.push({
            hash: h,
            nonce: tx.nonce,
            maxFeePerGas: tx.maxFeePerGas ?? tx.gasPrice ?? 0n,
          });
          return { acceptedBy: ['https://rpc1.test'] };
        },
        async getQuorumReceipt(hash) {
          if (bumpBroadcasts.length >= 2 && hash.toLowerCase() === bumpBroadcasts[1].hash) {
            return makeTransferReceipt({
              hash,
              usdtContract: cfg.usdtContract,
              from: hotWallet.address,
              to: destAddr,
              rawAmount: BigInt(wBump.netAmountRaw),
              confirmations: 2,
            });
          }
          return null;
        },
      }),
      makeMockSigner(hotWallet),
      alerter,
      cfg
    );
    await bumpEngine.runTick();
    assert.ok(bumpBroadcasts.length >= 2, 'Expected replacement broadcast');
    assert.equal(bumpBroadcasts[0].nonce, bumpBroadcasts[1].nonce);
    assert.ok(
      bumpBroadcasts[1].maxFeePerGas > bumpBroadcasts[0].maxFeePerGas,
      'Replacement bump must strictly increase fee'
    );
    const bumpDone = await prisma.withdrawal.findUniqueOrThrow({ where: { id: wBump.id } });
    assert.equal(bumpDone.status, 'COMPLETED');
    assert.equal(bumpDone.txHash, bumpBroadcasts[1].hash);

    // 7. Boot crash recovery on PROCESSING row finalizes mined broadcast without re-signing
    const wCrash = await queueTestWithdrawal('crash', '8.000000', '7.500000');
    const crashNonce = 13;
    const crashTxHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    const simCrash = await prisma.withdrawal.update({
      where: { id: wCrash.id },
      data: { status: 'SIMULATING' },
    });
    await prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id: simCrash.id, version: simCrash.version },
        data: { status: 'PROCESSING', nonce: crashNonce, attempts: 1 },
      });
      await tx.withdrawalBroadcast.create({
        data: {
          withdrawalId: simCrash.id,
          txHash: crashTxHash,
          nonce: crashNonce,
          maxFeePerGas: '1000000000',
          maxPriorityFee: '100000000',
          rpcUrl: 'rpc1',
        },
      });
    });

    let recoveryBroadcastCalls = 0;
    const recoveryEngine = new PayoutEngine(
      prisma,
      createMockRpcPool({
        async broadcastAll() {
          recoveryBroadcastCalls += 1;
          return { acceptedBy: [] };
        },
        async getQuorumReceipt(hash) {
          if (hash.toLowerCase() === crashTxHash.toLowerCase()) {
            return makeTransferReceipt({
              hash: crashTxHash,
              usdtContract: cfg.usdtContract,
              from: hotWallet.address,
              to: destAddr,
              rawAmount: BigInt(wCrash.netAmountRaw),
              confirmations: 3,
            });
          }
          return null;
        },
      }),
      makeMockSigner(hotWallet),
      alerter,
      cfg
    );
    await recoveryEngine.recoverInFlightPayouts();
    assert.equal(recoveryBroadcastCalls, 0);
    const crashDone = await prisma.withdrawal.findUniqueOrThrow({ where: { id: wCrash.id } });
    assert.equal(crashDone.status, 'COMPLETED');
    assert.equal(crashDone.txHash, crashTxHash.toLowerCase());
    assert.ok(sent.some((s) => s.level === 'CRITICAL'));
  } finally {
    await prisma.payoutControl.update({
      where: { id: 'BEP20' },
      data: { paused: false, pauseReason: null, nextNonce: null },
    });
    await purgeTestUsers([u.id]);
  }
});

test('Phase 4: /api/health reports DB + worker heartbeat and Oracle Cloud ARM deploy bundle enforces hardening', async () => {
  const healthRes = await getHealth();
  assert.equal(healthRes.status, 200);
  const body = (await healthRes.json()) as {
    ok: boolean;
    database: string;
    payoutWorker: { configured: boolean; paused: boolean };
  };
  assert.equal(body.ok, true);
  assert.equal(body.database, 'connected');
  assert.equal(body.payoutWorker.configured, true);

  const deployDir = path.join(process.cwd(), 'workers/payout-engine/deploy');
  for (const fname of [
    'setup-oracle.sh',
    'fetan-payout.service',
    'nftables.conf',
    'payout.env.example',
    'README-oracle.md',
  ]) {
    assert.ok(fs.existsSync(path.join(deployDir, fname)), `Missing deploy file: ${fname}`);
  }

  const serviceUnit = fs.readFileSync(path.join(deployDir, 'fetan-payout.service'), 'utf8');
  assert.ok(serviceUnit.includes('User=fetan-payout'));
  assert.ok(serviceUnit.includes('LimitCORE=0'));
  assert.ok(serviceUnit.includes('NoNewPrivileges=yes'));
  assert.ok(serviceUnit.includes('ProtectSystem=strict'));
  assert.ok(serviceUnit.includes('dist/workers/payout-engine/payout-engine.js'));
  assert.ok(serviceUnit.includes('LoadCredential=hot_wallet_key:/etc/fetan/hot_wallet_key'));

  const setupSh = fs.readFileSync(path.join(deployDir, 'setup-oracle.sh'), 'utf8');
  assert.ok(setupSh.includes('swapoff -a'));
  assert.ok(setupSh.includes('PermitRootLogin no'));
  assert.ok(setupSh.includes('nftables'));

  const nft = fs.readFileSync(path.join(deployDir, 'nftables.conf'), 'utf8');
  assert.ok(nft.includes('policy drop'));
  assert.ok(nft.includes('tcp dport 5432 accept'));
});

test('Security Hardening Audit: TGCloud ledger atomicity, dedicated webhook/sync secrets, password-reset cooldown, and new-address hold', async () => {
  // 1. TGCloud neon.js must use atomic CTE ledger inserts and block BEP-20 overrides
  const tgNeonSrc = fs.readFileSync(path.join(process.cwd(), 'telegram/tgcloud/lib/neon.js'), 'utf8');
  assert.equal(tgNeonSrc.includes('GREATEST(0, "usdtLocked"'), false);
  assert.ok(tgNeonSrc.includes("'ESCROW_LOCK'::\"LedgerEntryType\""));
  assert.ok(tgNeonSrc.includes("'ESCROW_RELEASE'::\"LedgerEntryType\""));
  assert.ok(tgNeonSrc.includes("'ESCROW_REFUND'::\"LedgerEntryType\""));
  assert.ok(tgNeonSrc.includes("'WITHDRAWAL_REFUND'::\"LedgerEntryType\""));
  assert.ok(tgNeonSrc.includes("linkedW.network === 'BEP20'"));

  // 2. Webhook & sync routes must reject TELEGRAM_BOT_TOKEN fallback when dedicated secrets are absent
  const prevWh = process.env.TELEGRAM_WEBHOOK_SECRET;
  const prevSync = process.env.TELEGRAM_SYNC_SECRET;
  try {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_SYNC_SECRET;
    const token = process.env.TELEGRAM_BOT_TOKEN || 'dummy-bot-token';
    const whRes = await postTelegramWebhook(
      new Request('http://localhost/api/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': token },
        body: '{}',
      })
    );
    assert.equal(whRes.status, 401);

    const syncRes = await postTelegramSync(
      new Request('http://localhost/api/telegram/sync', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: '{}',
      })
    );
    assert.equal(syncRes.status, 401);
  } finally {
    if (prevWh !== undefined) process.env.TELEGRAM_WEBHOOK_SECRET = prevWh;
    if (prevSync !== undefined) process.env.TELEGRAM_SYNC_SECRET = prevSync;
  }

  // 3. Risk engine holds withdrawals within 24h of RESET_PASSWORD and first-time addresses > 50 USDT
  const matureDate = new Date(Date.now() - 48 * 3600_000);
  const email = `audit-sec-${RUN_TAG}@fetan.test`;
  createdEmails.push(email);
  const u = await prisma.user.create({
    data: {
      id: `usr-sec-${RUN_TAG}`,
      email,
      name: `Sec Audit ${RUN_TAG}`,
      role: 'USER',
      kycStatus: 'VERIFIED',
      usdtBalance: new Prisma.Decimal('500.000000'),
      createdAt: matureDate,
    },
  });
  createdUserIds.push(u.id);

  // First-time address with > 50 USDT -> MANUAL_REVIEW
  const newAddrRisk = await prisma.$transaction((tx) =>
    evaluateWithdrawalRisk(tx, {
      userId: u.id,
      userEmail: email,
      network: 'BEP20',
      amountUsdt: new Prisma.Decimal('60.000000'),
      destination: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      accountCreatedAt: matureDate,
    })
  );
  assert.equal(newAddrRisk.status, 'MANUAL_REVIEW');

  // Consumed RESET_PASSWORD OTP in last 24h -> MANUAL_REVIEW even for 15 USDT
  await prisma.otpChallenge.create({
    data: {
      email,
      purpose: 'RESET_PASSWORD',
      codeHash: 'test-hash',
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
  const resetRisk = await prisma.$transaction((tx) =>
    evaluateWithdrawalRisk(tx, {
      userId: u.id,
      userEmail: email,
      network: 'BEP20',
      amountUsdt: new Prisma.Decimal('15.000000'),
      destination: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      accountCreatedAt: matureDate,
    })
  );
  assert.equal(resetRisk.status, 'MANUAL_REVIEW');
  assert.match(resetRisk.riskReason || '', /password reset/i);
});
