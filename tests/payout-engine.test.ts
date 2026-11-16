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
import type { Redis } from '@upstash/redis';

const RUN_TAG = crypto.randomBytes(4).toString('hex');
const createdUserIds: string[] = [];
const createdEmails: string[] = [];
const createdRateKeys: string[] = [];

after(async () => {
  try {
    if (createdEmails.length > 0) {
      await prisma.otpChallenge.deleteMany({ where: { email: { in: createdEmails } } });
    }
    if (createdRateKeys.length > 0) {
      await prisma.rateLimitRecord.deleteMany({ where: { key: { in: createdRateKeys } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL fetan.allow_test_ledger_cleanup = 'on'`);
        await tx.walletBalance.deleteMany({ where: { userId: { in: createdUserIds } } });
        await tx.withdrawalBroadcast.deleteMany({
          where: { withdrawal: { userId: { in: createdUserIds } } },
        });
        await tx.withdrawal.deleteMany({ where: { userId: { in: createdUserIds } } });
        await tx.walletTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
        await tx.auditLog.deleteMany({
          where: {
            OR: [{ actorId: { in: createdUserIds } }, { targetId: { in: createdUserIds } }],
          },
        });
        await tx.user.deleteMany({ where: { id: { in: createdUserIds } } });
      });
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
});
