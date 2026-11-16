import { Redis } from '@upstash/redis';
import { prisma } from '@/server/database/prisma';

export class WithdrawalRateLimitError extends Error {
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;

  constructor(statusCode: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Atomic sliding-window Lua script in Redis: avoids INCR+EXPIRE crash race & boundary bursts.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxReq = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
if count >= maxReq then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetMs = windowMs
  if oldest[2] then
    resetMs = math.max(1000, windowMs - (now - tonumber(oldest[2])))
  end
  return {0, math.ceil(resetMs / 1000)}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return {1, math.ceil(windowMs / 1000)}
`;

let cachedRedis: Redis | null = null;

function getRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  if (!cachedRedis) {
    cachedRedis = new Redis({ url, token });
  }
  return cachedRedis;
}

async function checkPostgresFailClosed(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; resetSeconds: number }> {
  const now = new Date();
  const nextResetAt = new Date(now.getTime() + windowSeconds * 1000);

  // Single atomic upsert avoids race conditions between concurrent requests
  const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimitRecord" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${nextResetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitRecord"."resetAt" <= ${now} THEN 1
        ELSE "RateLimitRecord"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitRecord"."resetAt" <= ${now} THEN ${nextResetAt}
        ELSE "RateLimitRecord"."resetAt"
      END
    RETURNING "count", "resetAt"
  `;

  const row = rows[0];
  if (!row) {
    throw new WithdrawalRateLimitError(503, 'Rate limiter state unavailable.');
  }

  const resetSeconds = Math.max(
    1,
    Math.ceil((new Date(row.resetAt).getTime() - now.getTime()) / 1000)
  );
  return {
    allowed: row.count <= maxRequests,
    resetSeconds,
  };
}

/**
 * Enforces per-user (5 / 15 min) and per-IP (20 / hour) withdrawal rate limits.
 *
 * Mitigates:
 * - Multi-instance bypasses via centralized Upstash Redis sliding window.
 * - Attacker DoS / failover abuse: NEVER falls back to permissive in-memory state.
 *   If the backing store fails, withdrawals fail closed with HTTP 503.
 */
export async function enforceWithdrawalRateLimit(
  userId: string,
  ip: string,
  overrideRedis?: Redis | null
): Promise<void> {
  const redis = overrideRedis !== undefined ? overrideRedis : getRedisClient();

  if (!redis && process.env.PAYOUT_REQUIRE_REDIS === 'true') {
    throw new WithdrawalRateLimitError(
      503,
      'Withdrawal rate-limit Redis backend is required but not configured.'
    );
  }

  const checks: Array<{ key: string; max: number; windowSec: number }> = [
    { key: `wdr:rl:user:${userId}`, max: 5, windowSec: 900 },
    { key: `wdr:rl:ip:${ip || 'unknown'}`, max: 20, windowSec: 3600 },
  ];

  for (const item of checks) {
    try {
      if (redis) {
        const nowMs = Date.now();
        const uniqueMember = `${nowMs}:${Math.random().toString(36).slice(2, 10)}`;
        const rawRes = (await redis.eval(
          SLIDING_WINDOW_LUA,
          [item.key],
          [nowMs, item.windowSec * 1000, item.max, uniqueMember]
        )) as [number, number];

        const allowed = Number(rawRes?.[0]) === 1;
        const resetSec = Math.max(1, Number(rawRes?.[1] || item.windowSec));
        if (!allowed) {
          throw new WithdrawalRateLimitError(
            429,
            'Too many withdrawal requests. Please wait before trying again.',
            resetSec
          );
        }
      } else {
        const res = await checkPostgresFailClosed(item.key, item.max, item.windowSec);
        if (!res.allowed) {
          throw new WithdrawalRateLimitError(
            429,
            'Too many withdrawal requests. Please wait before trying again.',
            res.resetSeconds
          );
        }
      }
    } catch (err) {
      if (err instanceof WithdrawalRateLimitError) throw err;
      // Fail closed on Redis / Postgres outage — never allow unmetered withdrawals
      throw new WithdrawalRateLimitError(
        503,
        'Security rate limiter is temporarily unavailable. Withdrawals paused for safety.'
      );
    }
  }
}
