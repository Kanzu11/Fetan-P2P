import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { PaymentMethod, P2POffer } from '@/client/types';
import { pricingService } from '@/client/pricing';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') as 'SELL' | 'BUY' | null;
  const paymentMethod = searchParams.get('paymentMethod') as PaymentMethod | null;
  const includeInactive = searchParams.get('includeInactive') === 'true';

  const offers = db.getOffers(type || undefined, paymentMethod || undefined, includeInactive);
  return NextResponse.json({ offers });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      merchantId,
      offerType,
      pricePerUsdtEtb,
      minLimitEtb,
      maxLimitEtb,
      totalAvailable,
      paymentMethods,
      terms,
    } = body;

    const user = db.getUser(merchantId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.kycStatus !== 'VERIFIED') {
      return NextResponse.json(
        { error: 'Identity verification (KYC) is required before publishing ads.' },
        { status: 403 }
      );
    }

    if (user.role !== 'MERCHANT' && user.role !== 'ADMIN' && user.role !== 'SUPERADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized: Only verified merchants can publish advertisements.' },
        { status: 403 }
      );
    }

    if (
      !offerType ||
      !pricePerUsdtEtb ||
      !minLimitEtb ||
      !maxLimitEtb ||
      !totalAvailable ||
      !paymentMethods?.length
    ) {
      return NextResponse.json({ error: 'Missing required offer fields' }, { status: 400 });
    }

    if (Number(minLimitEtb) > Number(maxLimitEtb)) {
      return NextResponse.json(
        { error: 'Minimum limit cannot exceed maximum limit.' },
        { status: 400 }
      );
    }

    const priceValidation = pricingService.validatePrice(Number(pricePerUsdtEtb));
    if (!priceValidation.valid) {
      return NextResponse.json({ error: priceValidation.error }, { status: 400 });
    }

    if (offerType === 'SELL' && Number(totalAvailable) > user.usdtBalance) {
      return NextResponse.json(
        { error: `Not enough USDT in wallet. You have ${user.usdtBalance.toFixed(2)} USDT available.` },
        { status: 400 }
      );
    }

    const newOffer: P2POffer = {
      id: `off-${Date.now()}`,
      merchantId: user.id,
      merchantName: user.nickname || user.name,
      merchantRating: 5.0,
      completedTrades: user.completedTrades || 12,
      completionRate: user.completionRate || 100.0,
      avgReleaseTimeMins: user.avgReleaseTimeMins || 1,
      isOnline: true,
      isVerifiedMerchant: true,
      offerType,
      pricePerUsdtEtb: Number(pricePerUsdtEtb),
      minLimitEtb: Number(minLimitEtb),
      maxLimitEtb: Number(maxLimitEtb),
      totalAvailable: Number(totalAvailable),
      paymentMethods,
      terms:
        terms ||
        'I am online now. Please send from your own account and leave the payment note blank.',
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    db.createOffer(newOffer);
    return NextResponse.json({ success: true, offer: newOffer });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
