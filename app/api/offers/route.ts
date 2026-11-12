import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth, getSessionUser } from '@/server/security/session';
import { pricingService } from '@/client/pricing';
import { sanitizeString } from '@/server/security/sanitize';
import { getClientIp } from '@/server/security/rate-limiter';
import {
  displayName,
  isAdminRole,
  PAYMENT_METHODS_META,
  type OfferType,
  type P2POffer,
  type PaymentMethod,
} from '@/client/types';

export const dynamic = 'force-dynamic';

const paymentMethodEnum = z.enum([
  'TELEBIRR',
  'CBE',
  'ABYSSINIA',
  'AWASH',
  'CBE_BIRR',
  'DASHEN',
]);

const createOfferSchema = z.object({
  offerType: z.enum(['BUY', 'SELL']),
  pricePerUsdtEtb: z.number().positive(),
  minLimitEtb: z.number().min(100, 'Minimum trade limit must be at least 100 ETB.'),
  maxLimitEtb: z.number().min(100),
  totalAvailable: z.number().min(1, 'Available USDT amount must be at least 1 USDT.'),
  paymentMethods: z.array(paymentMethodEnum).min(1, 'Select at least one payment method.'),
  terms: z.string().max(1000).optional(),
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const offerType = searchParams.get('offerType') as OfferType | null;
    const paymentMethod = searchParams.get('paymentMethod') as PaymentMethod | null;
    const includeInactive = searchParams.get('includeInactive') === 'true';

    const sessionUser = includeInactive ? await getSessionUser(req) : null;
    const allOffers = await db.getOffers(
      offerType === 'BUY' || offerType === 'SELL' ? offerType : undefined,
      paymentMethod || undefined,
      Boolean(includeInactive && sessionUser)
    );

    const filtered = includeInactive
      ? allOffers.filter(
          (o) =>
            o.isActive ||
            (sessionUser && (o.merchantId === sessionUser.id || isAdminRole(sessionUser.role)))
        )
      : allOffers;

    return NextResponse.json({ offers: filtered });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load offers';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    if (auth.user.kycStatus !== 'VERIFIED') {
      return NextResponse.json(
        { error: 'Please complete KYC verification before publishing offers.' },
        { status: 403 }
      );
    }

    const isMerchant =
      auth.user.role === 'MERCHANT' ||
      auth.user.merchantStatus === 'APPROVED' ||
      isAdminRole(auth.user.role);

    if (!isMerchant) {
      return NextResponse.json(
        { error: 'Only verified merchants can publish P2P marketplace offers.' },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const parsed = createOfferSchema.safeParse({
      ...rawBody,
      pricePerUsdtEtb: Number(rawBody?.pricePerUsdtEtb),
      minLimitEtb: Number(rawBody?.minLimitEtb),
      maxLimitEtb: Number(rawBody?.maxLimitEtb),
      totalAvailable: Number(rawBody?.totalAvailable),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid offer payload.' },
        { status: 400 }
      );
    }

    const {
      offerType,
      pricePerUsdtEtb,
      minLimitEtb,
      maxLimitEtb,
      totalAvailable,
      paymentMethods,
      terms,
    } = parsed.data;

    if (minLimitEtb > maxLimitEtb) {
      return NextResponse.json(
        { error: 'Minimum trade limit cannot exceed maximum trade limit.' },
        { status: 400 }
      );
    }

    const priceCheck = await pricingService.validatePrice(pricePerUsdtEtb);
    if (!priceCheck.valid) {
      return NextResponse.json(
        { error: priceCheck.error || 'Offered price is outside allowed market band.' },
        { status: 400 }
      );
    }

    if (offerType === 'SELL') {
      if (auth.user.usdtBalance < totalAvailable) {
        return NextResponse.json(
          {
            error: `Insufficient wallet USDT (${auth.user.usdtBalance.toFixed(2)} available) to back a ${totalAvailable} USDT SELL ad.`,
          },
          { status: 400 }
        );
      }

      const pd = auth.user.paymentDetails || {};
      const missingMethods = paymentMethods.filter((method) => {
        const meta = PAYMENT_METHODS_META[method];
        const value = meta ? pd[meta.accountField] : undefined;
        return !value || String(value).trim().length === 0;
      });

      if (missingMethods.length > 0) {
        return NextResponse.json(
          {
            error: `Save your payout account details in Wallet / Profile for: ${missingMethods.join(', ')} before posting a SELL ad.`,
          },
          { status: 400 }
        );
      }
    }

    const offer: P2POffer = {
      id: `off-${crypto.randomUUID()}`,
      merchantId: auth.user.id,
      merchantName: displayName(auth.user),
      completedTrades: auth.user.completedTrades ?? 0,
      completionRate: auth.user.completionRate ?? 100,
      merchantRating: auth.user.rating,
      avgReleaseTimeMins: auth.user.avgReleaseTimeMins,
      offerType,
      pricePerUsdtEtb: Number(pricePerUsdtEtb.toFixed(2)),
      minLimitEtb: Number(minLimitEtb.toFixed(2)),
      maxLimitEtb: Number(maxLimitEtb.toFixed(2)),
      totalAvailable: Number(totalAvailable.toFixed(6)),
      paymentMethods,
      terms: sanitizeString(terms, 800) || undefined,
      isActive: true,
      isOnline: true,
      isVerifiedMerchant:
        auth.user.role === 'MERCHANT' ||
        auth.user.merchantStatus === 'APPROVED' ||
        isAdminRole(auth.user.role),
      createdAt: new Date().toISOString(),
    };

    const created = await db.createOffer(offer);

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: 'OFFER_CREATED',
      targetType: 'P2POffer',
      targetId: created.id,
      ip: getClientIp(req),
      details: { offerType, pricePerUsdtEtb, totalAvailable },
    });

    return NextResponse.json({ success: true, offer: created });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not publish offer';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
