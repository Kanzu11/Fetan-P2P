import { NextResponse } from 'next/server';
import { pricingService } from '@/client/pricing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stats = await pricingService.getLiveStats();
  return NextResponse.json({ stats });
}
