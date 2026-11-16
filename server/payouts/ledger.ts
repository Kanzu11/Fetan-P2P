import { LedgerEntryType, Prisma } from '@prisma/client';

export interface AppendLedgerInput {
  userId: string;
  type: LedgerEntryType;
  amount: Prisma.Decimal | number | string;
  balanceAfter: Prisma.Decimal | number | string;
  referenceId: string;
}

/**
 * Appends an immutable entry to WalletBalance inside an active Prisma transaction.
 *
 * Mitigates:
 * - Silent balance drift or unrecorded debits/credits.
 * - Duplicate refunds / replay credits via the @@unique([type, referenceId, userId]) DB constraint.
 */
export async function appendLedgerEntry(
  tx: Prisma.TransactionClient,
  input: AppendLedgerInput
): Promise<void> {
  const amountDec = new Prisma.Decimal(input.amount).toDecimalPlaces(6);
  const balanceAfterDec = new Prisma.Decimal(input.balanceAfter).toDecimalPlaces(6);

  if (balanceAfterDec.isNegative()) {
    throw new Error('Ledger invariant violated: balanceAfter cannot be negative.');
  }

  await tx.walletBalance.create({
    data: {
      userId: input.userId,
      type: input.type,
      amount: amountDec,
      balanceAfter: balanceAfterDec,
      referenceId: input.referenceId,
    },
  });
}
