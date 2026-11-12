import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Legacy unverified login endpoint disabled in Phase 1 security hardening.
 * Clients must verify via /api/auth/request-otp + /api/auth/verify-otp or /api/auth/google.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Unverified direct email login is disabled. Request a 6-digit verification code via /api/auth/request-otp and verify via /api/auth/verify-otp.',
    },
    { status: 410 }
  );
}
