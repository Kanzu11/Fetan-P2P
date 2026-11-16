import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/server/database/prisma';

// RFC 4122 UUID v4 strict match (version nibble = 4, variant nibble = 8/9/a/b)
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(UUID_V4_REGEX, 'Idempotency-Key header must be a valid UUIDv4.');

/**
 * Extracts and validates the client-supplied UUIDv4 Idempotency-Key header.
 *
 * Mitigates:
 * - Duplicate payout submissions from double-clicks, mobile retries, or replay races.
 * - Low-entropy predictable key probing by requiring UUIDv4 syntax.
 */
export function parseIdempotencyKeyHeader(headers: Headers): {
  ok: true;
  key: string;
} | {
  ok: false;
  error: string;
} {
  const raw = headers.get('idempotency-key');
  if (!raw) {
    return { ok: false, error: 'Missing required Idempotency-Key UUIDv4 header.' };
  }
  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message || 'Idempotency-Key header must be a valid UUIDv4.',
    };
  }
  return { ok: true, key: parsed.data.toLowerCase() };
}

/**
 * Produces a deterministic SHA-256 digest of the semantic payout payload bound to userId.
 *
 * Mitigates:
 * - Key-reuse parameter tampering: reusing an Idempotency-Key with a different amount or address returns 422.
 */
export function computeWithdrawalRequestHash(params: {
  userId: string;
  network: string;
  amountUsdt: Prisma.Decimal;
  destination: string;
}): string {
  const canonical = JSON.stringify({
    userId: params.userId,
    network: params.network,
    amountUsdt: params.amountUsdt.toFixed(6),
    destination: params.destination,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function findExistingIdempotentWithdrawal(key: string) {
  return prisma.withdrawal.findUnique({
    where: { idempotencyKey: key },
  });
}
