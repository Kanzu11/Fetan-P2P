import { NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const offer = db.getOffer(params.id);
    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const updated = db.updateOffer(params.id, {
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : offer.isActive,
      pricePerUsdtEtb: body.pricePerUsdtEtb !== undefined ? Number(body.pricePerUsdtEtb) : offer.pricePerUsdtEtb,
      totalAvailable: body.totalAvailable !== undefined ? Number(body.totalAvailable) : offer.totalAvailable,
    });

    return NextResponse.json({ success: true, offer: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const openOrders = db.getOpenOrdersForOffer(params.id);
  if (openOrders.length > 0) {
    return NextResponse.json(
      { error: 'Cannot delete this ad while it has open orders. Pause it instead.' },
      { status: 400 }
    );
  }
  const deleted = db.deleteOffer(params.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

