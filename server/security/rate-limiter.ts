import { NextResponse } from 'next/server';
import { prisma } from '@/server/database/prisma';

interface MemoryRateLimitRecord {
  count: number;
  resetAt: number;
}

/**
 * PostgreSQL-backed sliding/fixed window rate limiter with fast in-memory fallback.
 * Survives serverless cold starts and multi-worker instances using Neon Postgres.
 */
class RateLimiter {
  private memoryFallback: Map<string, MemoryRateLimitRecord> = new Map();

  private checkInMemory(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): { allowed: boolean; remaining: number; resetSeconds: number } {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const record = this.memoryFallback.get(key);

    if (!record || now > record.resetAt) {
      this.memoryFallback.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: maxRequests - 1, resetSeconds: windowSeconds };
    }

    if (record.count >= maxRequests) {
      const resetSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      return { allowed: false, remaining: 0, resetSeconds };
    }

    record.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - record.count),
      resetSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
    };
  }

  /**
   * Distributed rate-limit check backed by Postgres `RateLimitRecord` table.
   */
  async checkAsync(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetSeconds: number }> {
    const now = new Date();
    const nextResetAt = new Date(now.getTime() + windowSeconds * 1000);

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.rateLimitRecord.findUnique({ where: { key } });

          if (!existing || existing.resetAt <= now) {
            const created = await tx.rateLimitRecord.upsert({
              where: { key },
              create: { key, count: 1, resetAt: nextResetAt },
              update: { count: 1, resetAt: nextResetAt },
            });
            return {
              allowed: true,
              remaining: Math.max(0, maxRequests - created.count),
              resetSeconds: windowSeconds,
            };
          }

          if (existing.count >= maxRequests) {
            const resetSeconds = Math.max(
              1,
              Math.ceil((existing.resetAt.getTime() - now.getTime()) / 1000)
            );
            return { allowed: false, remaining: 0, resetSeconds };
          }

          const updated = await tx.rateLimitRecord.update({
            where: { key },
            data: { count: { increment: 1 } },
          });
          const resetSeconds = Math.max(
            1,
            Math.ceil((updated.resetAt.getTime() - now.getTime()) / 1000)
          );
          return {
            allowed: true,
            remaining: Math.max(0, maxRequests - updated.count),
            resetSeconds,
          };
        },
        { maxWait: 10000, timeout: 25000 }
      );

      return result;
    } catch {
      return this.checkInMemory(key, maxRequests, windowSeconds);
    }
  }

  /**
   * Synchronous helper kept for backward compatibility (prefer checkAsync).
   */
  check(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): { allowed: boolean; remaining: number; resetSeconds: number } {
    return this.checkInMemory(key, maxRequests, windowSeconds);
  }

  rateLimitResponse(
    resetSeconds: number,
    message: string = 'Too many requests. Please try again later.'
  ) {
    return NextResponse.json(
      {
        error: message,
        retryAfter: resetSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(resetSeconds),
          'X-RateLimit-Reset': String(resetSeconds),
        },
      }
    );
  }
}

export const rateLimiter = new RateLimiter();

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  return '127.0.0.1';
}
