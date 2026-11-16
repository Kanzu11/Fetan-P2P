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

const RUN_TAG = crypto.randomBytes(4).toString('hex');
const createdUserIds: string[] = [];

after(async () => {
  try {
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
