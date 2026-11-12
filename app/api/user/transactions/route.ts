import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { isAdminRole } from '@/client/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const requestedUserId = searchParams.get('userId');

  const isAdmin = isAdminRole(auth.user.role);
  if (requestedUserId && requestedUserId !== auth.user.id && !isAdmin) {
    return NextResponse.json(
      { error: 'Forbidden: you can only view your own wallet transactions.' },
      { status: 403 }
    );
  }

  const targetUserId = requestedUserId && isAdmin ? requestedUserId : auth.user.id;
  const transactions = await db.getWalletTransactions(targetUserId);
  return NextResponse.json({ transactions });
}
