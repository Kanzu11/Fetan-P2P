import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { sanitizeAmount, sanitizeString } from '@/server/security/sanitize';
import { escrowController } from '@/server/escrow-controller';
import { isAdminRole } from '@/client/types';

export const dynamic = 'force-dynamic';

const createOrderSchema = z.object({
  offerId: z.string().min(1),
  usdtAmount: z.number().min(0.5, 'Minimum trade amount is 0.5 USDT.'),
  paymentMethod: z.enum([
    'TELEBIRR',
    'CBE',
    'ABYSSINIA',
    'AWASH',
    'CBE_BIRR',
    'DASHEN',
  ]),
  sellerAccountNumber: z.string().max(60).optional(),
  sellerAccountName: z.string().max(80).optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  await escrowController.sweepExpiredOrders().catch(() => {});

  const { searchParams } = new URL(req.url);
  const requestedUserId = searchParams.get('userId');
  const isAdmin = isAdminRole(auth.user.role);

  if (requestedUserId && requestedUserId !== auth.user.id && !isAdmin) {
    return NextResponse.json(
      { error: 'Forbidden: cannot read orders belonging to another user.' },
      { status: 403 }
    );
  }

  if (isAdmin && !requestedUserId) {
    const orders = await db.getAllOrders();
    return NextResponse.json({ orders });
  }

  const targetId = isAdmin && requestedUserId ? requestedUserId : auth.user.id;
  const orders = await db.getOrdersForUser(targetId);
  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const ip = getClientIp(req);
    const limit = await rateLimiter.checkAsync(`create-order:${auth.user.id}:${ip}`, 15, 300);
    if (!limit.allowed) {
      return rateLimiter.rateLimitResponse(
        limit.resetSeconds,
        'Too many orders created quickly. Please wait a moment.'
      );
    }

    if (auth.user.kycStatus !== 'VERIFIED' && !isAdminRole(auth.user.role)) {
      return NextResponse.json(
        { error: 'Complete KYC identity verification before opening P2P escrow orders.' },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const amountCheck = sanitizeAmount(rawBody?.usdtAmount, 0.5, 1_000_000, 6);
    const parsed = createOrderSchema.safeParse({
      ...rawBody,
      usdtAmount: amountCheck.valid ? amountCheck.amount : Number(rawBody?.usdtAmount),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid order creation request.' },
        { status: 400 }
      );
    }

    const { offerId, usdtAmount, paymentMethod, sellerAccountNumber, sellerAccountName } =
      parsed.data;

    const order = await escrowController.lockEscrow({
      offerId,
      buyerId: auth.user.id,
      usdtAmount,
      paymentMethod,
      sellerAccountNumber: sanitizeString(sellerAccountNumber, 60) || undefined,
      sellerAccountName: sanitizeString(sellerAccountName, 80) || undefined,
    });

    return NextResponse.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Order creation failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
