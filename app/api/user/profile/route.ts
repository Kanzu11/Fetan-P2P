import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { sanitizeString } from '@/server/security/sanitize';
import { getClientIp } from '@/server/security/rate-limiter';
import { wsGateway } from '@/server/websocket-gateway';
import type { User, UserPaymentDetails } from '@/client/types';

export const dynamic = 'force-dynamic';

const optionalCleanStr = (max = 80) =>
  z.string().max(max).optional();

const paymentDetailsSchema = z
  .object({
    telebirr: optionalCleanStr(40),
    cbeAccount: optionalCleanStr(40),
    cbeHolder: optionalCleanStr(80),
    abyssiniaAccount: optionalCleanStr(40),
    abyssiniaHolder: optionalCleanStr(80),
    awashAccount: optionalCleanStr(40),
    awashHolder: optionalCleanStr(80),
    cbeBirr: optionalCleanStr(40),
    dashenAccount: optionalCleanStr(40),
    dashenHolder: optionalCleanStr(80),
  })
  .optional();

const profileUpdateSchema = z.object({
  action: z.string().optional(),
  name: z.string().max(80).optional(),
  nickname: z.string().max(40).optional(),
  phone: z.string().max(32).optional(),
  telegramHandle: z.string().max(64).optional(),
  telegramChatId: z.string().max(40).optional(),
  telegramNotifications: z.boolean().optional(),
  paymentDetails: paymentDetailsSchema,
});

function cleanOptionalField(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = sanitizeString(value, max);
  return cleaned.length > 0 ? cleaned : undefined;
}

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ user: auth.user });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const rawBody = await req.json();
    const parsed = profileUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid profile update payload' },
        { status: 400 }
      );
    }

    const data = parsed.data;
    if (data.action === 'WITHDRAW_USDT') {
      return NextResponse.json(
        {
          error:
            'Legacy direct withdrawals are disabled. Use POST /api/user/withdraw with email OTP verification.',
        },
        { status: 410 }
      );
    }

    const updates: Partial<User> = {};

    if (data.name !== undefined) {
      const cleanName = sanitizeString(data.name, 80);
      if (cleanName.length >= 2 && auth.user.kycStatus !== 'VERIFIED') {
        updates.name = cleanName;
      }
    }

    if (data.nickname !== undefined) {
      const cleanNick = sanitizeString(data.nickname, 40);
      updates.nickname = cleanNick || undefined;
    }

    if (data.phone !== undefined) {
      updates.phone = cleanOptionalField(data.phone, 32);
    }

    if (data.telegramHandle !== undefined) {
      const cleanTg = sanitizeString(data.telegramHandle, 64);
      updates.telegramHandle = cleanTg
        ? cleanTg.startsWith('@')
          ? cleanTg
          : `@${cleanTg}`
        : undefined;
    }

    if (data.telegramChatId !== undefined) {
      updates.telegramChatId = cleanOptionalField(data.telegramChatId, 40);
    }

    if (typeof data.telegramNotifications === 'boolean') {
      updates.telegramNotifications = data.telegramNotifications;
    }

    if (data.paymentDetails) {
      const pd = data.paymentDetails;
      const existing = auth.user.paymentDetails || {};
      const merged: UserPaymentDetails = {
        ...existing,
        ...(pd.telebirr !== undefined ? { telebirr: cleanOptionalField(pd.telebirr, 40) } : {}),
        ...(pd.cbeAccount !== undefined ? { cbeAccount: cleanOptionalField(pd.cbeAccount, 40) } : {}),
        ...(pd.cbeHolder !== undefined ? { cbeHolder: cleanOptionalField(pd.cbeHolder, 80) } : {}),
        ...(pd.abyssiniaAccount !== undefined
          ? { abyssiniaAccount: cleanOptionalField(pd.abyssiniaAccount, 40) }
          : {}),
        ...(pd.abyssiniaHolder !== undefined
          ? { abyssiniaHolder: cleanOptionalField(pd.abyssiniaHolder, 80) }
          : {}),
        ...(pd.awashAccount !== undefined
          ? { awashAccount: cleanOptionalField(pd.awashAccount, 40) }
          : {}),
        ...(pd.awashHolder !== undefined
          ? { awashHolder: cleanOptionalField(pd.awashHolder, 80) }
          : {}),
        ...(pd.cbeBirr !== undefined ? { cbeBirr: cleanOptionalField(pd.cbeBirr, 40) } : {}),
        ...(pd.dashenAccount !== undefined
          ? { dashenAccount: cleanOptionalField(pd.dashenAccount, 40) }
          : {}),
        ...(pd.dashenHolder !== undefined
          ? { dashenHolder: cleanOptionalField(pd.dashenHolder, 80) }
          : {}),
      };
      updates.paymentDetails = merged;
    }

    const updated = await db.updateUser(auth.user.id, updates);

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: 'PROFILE_UPDATED',
      targetType: 'User',
      targetId: auth.user.id,
      ip: getClientIp(req),
    });

    wsGateway.emitToUser(updated.id, 'user_updated', { user: updated });

    return NextResponse.json({
      success: true,
      user: updated,
      message: 'Profile updated successfully.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Profile update failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
