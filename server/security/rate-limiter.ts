import { NextResponse } from 'next/server';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

/**
 * In-memory sliding-window rate limiter for production edge protection.
 * Can be swapped for Redis / Upstash in multi-node clusters.
 */
class RateLimiter {
  private records: Map<string, RateLimitRecord> = new Map();

  constructor() {
    // Periodic garbage collector every 5 minutes to prevent memory leaks
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      if (now > record.resetAt) {
        this.records.delete(key);
      }
    }
  }

  /**
   * Check if a request exceeds limits.
   * @param key Unique key (e.g. `ip:action` or `userId:action`)
   * @param maxRequests Maximum allowed requests within window
   * @param windowSeconds Window length in seconds
   */
  check(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): { allowed: boolean; remaining: number; resetSeconds: number } {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const record = this.records.get(key);

    if (!record || now > record.resetAt) {
      this.records.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: maxRequests - 1, resetSeconds: windowSeconds };
    }

    if (record.count >= maxRequests) {
      const resetSeconds = Math.ceil((record.resetAt - now) / 1000);
      return { allowed: false, remaining: 0, resetSeconds };
    }

    record.count += 1;
    const remaining = maxRequests - record.count;
    const resetSeconds = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: true, remaining, resetSeconds };
  }

  /**
   * Helper to generate a 429 response with standard Retry-After header.
   */
  rateLimitResponse(resetSeconds: number, message: string = 'Too many requests. Please try again later.') {
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

/**
 * Extracts client IP from request headers across various proxies (Cloudflare, Vercel, Nginx).
 */
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

