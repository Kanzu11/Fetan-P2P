import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { Role, User } from '@/client/types';
import { db } from '@/server/database/store';

export const SESSION_COOKIE_NAME = 'fetan_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface SessionPayload {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}

function getSigningSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.startsWith('replace_with_')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be configured with a strong secret in production.');
    }
    return 'fetan-dev-fallback-secret-change-in-env';
  }
  return secret;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const pad = (4 - (input.length % 4)) % 4;
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function signSessionToken(userId: string, role: Role, ttlSeconds = SESSION_TTL_SECONDS): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payloadObj: SessionPayload = {
    sub: userId,
    role,
    iat: now,
    exp: now + ttlSeconds,
  };
  const payload = base64UrlEncode(JSON.stringify(payloadObj));
  const data = `${header}.${payload}`;
  const sig = base64UrlEncode(crypto.createHmac('sha256', getSigningSecret()).update(data).digest());
  return `${data}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const data = `${header}.${payload}`;
  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', getSigningSecret()).update(data).digest()
  );

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (!decoded.sub || typeof decoded.exp !== 'number' || decoded.exp <= now) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const pairs = cookieHeader.split(';');
  for (const part of pairs) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

export function extractTokenFromRequest(req?: Request): string | undefined {
  if (req) {
    const fromHeader = parseCookieHeader(req.headers.get('cookie'), SESSION_COOKIE_NAME);
    if (fromHeader) return fromHeader;
  }
  try {
    const cookieStore = cookies();
    return cookieStore.get(SESSION_COOKIE_NAME)?.value;
  } catch {
    return undefined;
  }
}

export function setSessionCookie(response: NextResponse, userId: string, role: Role): NextResponse {
  const token = signSessionToken(userId, role);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function getSessionUser(req?: Request): Promise<User | null> {
  const token = extractTokenFromRequest(req);
  const payload = verifySessionToken(token);
  if (!payload) return null;

  const user = await db.getUser(payload.sub);
  return user || null;
}

export type AuthCheckSuccess = { ok: true; user: User };
export type AuthCheckFailure = { ok: false; response: NextResponse };

export async function requireAuth(req?: Request): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const user = await getSessionUser(req);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required. Please sign in to continue.' },
        { status: 401 }
      ),
    };
  }
  if (user.isSuspended) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: user.suspendReason
            ? `Account suspended: ${user.suspendReason}`
            : 'Your account has been suspended by Fetan Compliance.',
        },
        { status: 403 }
      ),
    };
  }
  return { ok: true, user };
}

export async function requireAdmin(req?: Request): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth;
  if (auth.user.role !== 'ADMIN' && auth.user.role !== 'SUPERADMIN') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden: Administrator privileges required.' },
        { status: 403 }
      ),
    };
  }
  return auth;
}

export async function requireSuperadmin(req?: Request): Promise<AuthCheckSuccess | AuthCheckFailure> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth;
  if (auth.user.role !== 'SUPERADMIN') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden: Superadmin privileges required.' },
        { status: 403 }
      ),
    };
  }
  return auth;
}

