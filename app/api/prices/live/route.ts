import { NextResponse } from 'next/server';
import { pricingService } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stats = pricingService.getLiveStats();
  return NextResponse.json({ stats });
}
