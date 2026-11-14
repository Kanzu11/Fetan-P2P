import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { pricingService } from '@/client/pricing';
import { sanitizeString } from '@/server/security/sanitize';
import { isAdminRole } from '@/client/types';

export const dynamic = 'force-dynamic';

const patchOfferSchema = z.object({
  isActive: z.boolean().optional(),
  isOnline: z.boolean().optional(),
  pricePerUsdtEtb: z.number().positive().optional(),
  minLimitEtb: z.number().min(100).optional(),
  maxLimitEtb: z.number().min(100).optional(),
  totalAvailable: z.number().min(0).optional(),
  terms: z.string().max(1000).optional(),
});

export async function PATCH(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const offer = await db.getOffer(context.params.id);
    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    if (offer.merchantId !== auth.user.id && !isAdminRole(auth.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rawBody = await req.json();
    const parsed = patchOfferSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid update payload' },
        { status: 400 }
      );
    }

    if (parsed.data.pricePerUsdtEtb !== undefined) {
      const check = await pricingService.validatePrice(parsed.data.pricePerUsdtEtb);
      if (!check.valid) {
        return NextResponse.json({ error: check.error }, { status: 400 });
      }
    }

    const updated = await db.updateOffer(offer.id, {
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      ...(parsed.data.isOnline !== undefined ? { isOnline: parsed.data.isOnline } : {}),
      ...(parsed.data.pricePerUsdtEtb !== undefined
        ? { pricePerUsdtEtb: Number(parsed.data.pricePerUsdtEtb.toFixed(2)) }
        : {}),
      ...(parsed.data.minLimitEtb !== undefined
        ? { minLimitEtb: parsed.data.minLimitEtb }
        : {}),
      ...(parsed.data.maxLimitEtb !== undefined
        ? { maxLimitEtb: parsed.data.maxLimitEtb }
        : {}),
      ...(parsed.data.totalAvailable !== undefined
        ? { totalAvailable: parsed.data.totalAvailable }
        : {}),
      ...(parsed.data.terms !== undefined
        ? { terms: sanitizeString(parsed.data.terms, 800) }
        : {}),
    });

    return NextResponse.json({ success: true, offer: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update offer';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const offer = await db.getOffer(context.params.id);
    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    if (offer.merchantId !== auth.user.id && !isAdminRole(auth.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const openOrders = await db.getOpenOrdersForOffer(offer.id);
    if (openOrders.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete an ad with active open orders. Complete or cancel them first.' },
        { status: 409 }
      );
    }

    try {
      await db.deleteOffer(offer.id);
      return NextResponse.json({ success: true, deleted: true });
    } catch {
      // Preserve historical completed/cancelled order foreign keys by deactivating and zeroing availability
      await db.updateOffer(offer.id, { isActive: false, totalAvailable: 0 });
      return NextResponse.json({ success: true, archived: true });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete offer';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
