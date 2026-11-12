import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error:
        'Unverified direct deposits are disabled. Send USDT to your dedicated deposit address and submit the TxID to /api/user/deposit/verify-tx.',
    },
    { status: 410 }
  );
}
