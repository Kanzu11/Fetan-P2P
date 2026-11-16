import { PrismaClient } from '@prisma/client';

/**
 * Installs PostgreSQL-level triggers protecting the Withdrawal state machine and
 * WalletBalance append-only ledger, and ensures the default PayoutControl row exists.
 *
 * Statements are executed individually so Dollar-quoted PL/pgSQL blocks never break.
 */
const GUARD_STATEMENTS: string[] = [
  `CREATE OR REPLACE FUNCTION withdrawal_transition_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('COMPLETED', 'FAILED', 'REJECTED') THEN
    RAISE EXCEPTION 'Terminal withdrawal status % cannot be modified (id=%)', OLD.status, OLD.id;
  END IF;

  IF NEW."userId" <> OLD."userId"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."requestHash" <> OLD."requestHash"
     OR NEW."network" <> OLD."network"
     OR NEW."destination" <> OLD."destination"
     OR NEW."amountUsdt" <> OLD."amountUsdt"
     OR NEW."feeUsdt" <> OLD."feeUsdt"
     OR NEW."netAmountUsdt" <> OLD."netAmountUsdt"
     OR NEW."netAmountRaw" <> OLD."netAmountRaw" THEN
    RAISE EXCEPTION 'Withdrawal amount, destination, network, or identity fields are immutable (id=%)', OLD.id;
  END IF;

  IF OLD."nonce" IS NOT NULL AND NEW."nonce" IS DISTINCT FROM OLD."nonce" THEN
    RAISE EXCEPTION 'Withdrawal nonce % is immutable once bound (id=%)', OLD."nonce", OLD.id;
  END IF;
  IF OLD."txHash" IS NOT NULL AND NEW."txHash" IS DISTINCT FROM OLD."txHash" THEN
    RAISE EXCEPTION 'Withdrawal txHash is immutable once bound (id=%)', OLD.id;
  END IF;

  IF NOT (
    (OLD.status = 'MANUAL_REVIEW'        AND NEW.status IN ('PENDING', 'REJECTED')) OR
    (OLD.status = 'MANUAL_REVIEW'        AND NEW.status = 'COMPLETED' AND OLD."network" <> 'BEP20' AND NEW."txHash" IS NOT NULL) OR
    (OLD.status = 'PENDING'              AND NEW.status IN ('SIMULATING', 'REJECTED') AND OLD."nonce" IS NULL) OR
    (OLD.status = 'SIMULATING'           AND NEW.status IN ('PENDING', 'FAILED') AND OLD."nonce" IS NULL AND NEW."nonce" IS NULL) OR
    (OLD.status = 'SIMULATING'           AND NEW.status = 'PROCESSING' AND NEW."nonce" IS NOT NULL) OR
    (OLD.status = 'PROCESSING'           AND NEW.status IN ('PROCESSING', 'NEEDS_RECONCILIATION')) OR
    (OLD.status = 'PROCESSING'           AND NEW.status = 'COMPLETED' AND NEW."txHash" IS NOT NULL) OR
    (OLD.status = 'NEEDS_RECONCILIATION' AND NEW.status = 'COMPLETED' AND NEW."txHash" IS NOT NULL) OR
    (OLD.status = 'NEEDS_RECONCILIATION' AND NEW.status = 'FAILED') OR
    (OLD.status = NEW.status)
  ) THEN
    RAISE EXCEPTION 'Illegal withdrawal status transition: % -> % (id=%, nonce=%)',
      OLD.status, NEW.status, OLD.id, OLD."nonce";
  END IF;

  NEW."version" := OLD."version" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,

  `DROP TRIGGER IF EXISTS withdrawal_transition_guard ON "Withdrawal";`,

  `CREATE TRIGGER withdrawal_transition_guard
BEFORE UPDATE ON "Withdrawal"
FOR EACH ROW EXECUTE FUNCTION withdrawal_transition_guard();`,

  `CREATE OR REPLACE FUNCTION wallet_balance_immutability_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WalletBalance ledger is append-only; updates are forbidden (id=%)', OLD.id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF current_setting('fetan.allow_test_ledger_cleanup', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WalletBalance ledger is append-only; deletes are forbidden (id=%)', OLD.id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;`,

  `DROP TRIGGER IF EXISTS wallet_balance_immutable ON "WalletBalance";`,

  `CREATE TRIGGER wallet_balance_immutable
BEFORE UPDATE OR DELETE ON "WalletBalance"
FOR EACH ROW EXECUTE FUNCTION wallet_balance_immutability_guard();`,
];

export async function applyPayoutDatabaseGuards(client: PrismaClient): Promise<void> {
  for (const sql of GUARD_STATEMENTS) {
    await client.$executeRawUnsafe(sql);
  }

  await client.payoutControl.upsert({
    where: { id: 'BEP20' },
    create: { id: 'BEP20', paused: false },
    update: {},
  });
}

/**
 * Seeds one-time opening WalletBalance entries for existing users who already hold
 * non-zero balances prior to ledger rollout, without touching users who already have ledger rows.
 */
export async function seedOpeningLedgerBalances(client: PrismaClient): Promise<number> {
  const usersWithoutLedger = await client.user.findMany({
    where: {
      usdtBalance: { gt: 0 },
      walletBalances: { none: {} },
    },
    select: { id: true, usdtBalance: true },
  });

  let seeded = 0;
  for (const user of usersWithoutLedger) {
    try {
      await client.walletBalance.create({
        data: {
          userId: user.id,
          type: 'ADMIN_ADJUSTMENT',
          amount: user.usdtBalance,
          balanceAfter: user.usdtBalance,
          referenceId: `opening-${user.id}`,
        },
      });
      seeded += 1;
    } catch (err: unknown) {
      // Unique constraint conflict means another run already seeded this user cleanly
      const code = (err as { code?: string })?.code;
      if (code !== 'P2002') throw err;
    }
  }
  return seeded;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  (async () => {
    try {
      await applyPayoutDatabaseGuards(prisma);
      const seeded = await seedOpeningLedgerBalances(prisma);
      console.log(
        `Applied Withdrawal & WalletBalance DB guards cleanly (seeded ${seeded} opening ledger balance(s)).`
      );
    } finally {
      await prisma.$disconnect();
    }
  })().catch((err) => {
    console.error('Failed to apply payout DB guards:', err);
    process.exit(1);
  });
}
