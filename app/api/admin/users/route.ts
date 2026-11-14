import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAdmin, requireSuperadmin } from '@/server/security/session';
import { getClientIp } from '@/server/security/rate-limiter';
import { wsGateway } from '@/server/websocket-gateway';
import { sanitizeString } from '@/server/security/sanitize';
import { telegramBot } from '@/server/telegram-bot';
import type { Role } from '@/client/types';

export const dynamic = 'force-dynamic';

const adminUserActionSchema = z.object({
  targetUserId: z.string().min(1),
  action: z.enum(['TOGGLE_MERCHANT', 'UPDATE_KYC', 'TOGGLE_ADMIN', 'TOGGLE_SUSPEND']),
  newKycStatus: z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']).optional(),
  newRole: z.enum(['USER', 'MERCHANT', 'ADMIN']).optional(),
  newStatus: z.boolean().optional(),
  suspendReason: z.string().max(250).optional(),
});

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const users = await db.getAllUsers();
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;

    const rawBody = await req.json();
    const parsed = adminUserActionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid admin user action payload' },
        { status: 400 }
      );
    }

    const { targetUserId, action, newKycStatus, newRole, newStatus, suspendReason } = parsed.data;
    const target = await db.getUser(targetUserId);
    if (!target) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    }

    const ip = getClientIp(req);
    let updated = target;

    if (action === 'TOGGLE_ADMIN') {
      const superCheck = await requireSuperadmin(req);
      if (!superCheck.ok) return superCheck.response;

      if (target.role === 'SUPERADMIN') {
        return NextResponse.json(
          { error: 'Superadmin role cannot be modified or demoted.' },
          { status: 403 }
        );
      }

      if (target.id === auth.user.id) {
        return NextResponse.json(
          { error: 'You cannot change your own administrative privileges.' },
          { status: 400 }
        );
      }

      const promote = newRole ? newRole === 'ADMIN' : target.role !== 'ADMIN';
      const isMerchant = target.role === 'MERCHANT' || target.merchantStatus === 'APPROVED';
      const nextRole: Role = promote
        ? 'ADMIN'
        : isMerchant
        ? 'MERCHANT'
        : 'USER';

      updated = await db.updateUser(target.id, { role: nextRole });
      await db.logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: promote ? 'PROMOTED_ADMIN' : 'DEMOTED_ADMIN',
        targetType: 'User',
        targetId: target.id,
        ip,
        details: { previousRole: target.role, nextRole },
      });
    } else if (action === 'TOGGLE_MERCHANT') {
      const currentlyMerchant =
        target.role === 'MERCHANT' || target.merchantStatus === 'APPROVED';
      const nextMerchant =
        typeof newStatus === 'boolean' ? newStatus : !currentlyMerchant;

      if (nextMerchant && target.kycStatus !== 'VERIFIED') {
        return NextResponse.json(
          { error: 'User must complete KYC verification before becoming a verified merchant.' },
          { status: 400 }
        );
      }

      const nextRole: Role =
        target.role === 'ADMIN' || target.role === 'SUPERADMIN'
          ? target.role
          : nextMerchant
          ? 'MERCHANT'
          : 'USER';

      updated = await db.updateUser(target.id, {
        merchantStatus: nextMerchant ? 'APPROVED' : 'NONE',
        role: nextRole,
      });

      await db.logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: nextMerchant ? 'GRANTED_MERCHANT' : 'REVOKED_MERCHANT',
        targetType: 'User',
        targetId: target.id,
        ip,
        details: { nextMerchant, nextRole },
      });
    } else if (action === 'UPDATE_KYC') {
      if (!newKycStatus) {
        return NextResponse.json(
          { error: 'newKycStatus is required for UPDATE_KYC action.' },
          { status: 400 }
        );
      }

      updated = await db.updateUser(target.id, { kycStatus: newKycStatus });
      await db.logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: `KYC_SET_${newKycStatus}`,
        targetType: 'User',
        targetId: target.id,
        ip,
        details: { previousStatus: target.kycStatus, newKycStatus },
      });
    } else if (action === 'TOGGLE_SUSPEND') {
      if (target.role === 'SUPERADMIN') {
        return NextResponse.json(
          { error: 'Superadmin account cannot be suspended or banned.' },
          { status: 403 }
        );
      }

      if (target.id === auth.user.id) {
        return NextResponse.json(
          { error: 'You cannot suspend or ban your own account.' },
          { status: 400 }
        );
      }

      if (target.role === 'ADMIN' && auth.user.role !== 'SUPERADMIN') {
        const superCheck = await requireSuperadmin(req);
        if (!superCheck.ok) return superCheck.response;
      }

      const nextSuspended =
        typeof newStatus === 'boolean' ? newStatus : !Boolean(target.isSuspended);
      const cleanReason = nextSuspended
        ? sanitizeString(suspendReason, 220) || 'Suspended by Fetan Compliance Admin'
        : '';

      updated = await db.updateUser(target.id, {
        isSuspended: nextSuspended,
        suspendReason: nextSuspended ? cleanReason : '',
      });

      if (nextSuspended) {
        const ownedOffers = await db.getOffers(undefined, undefined, true, target.id);
        for (const off of ownedOffers) {
          if (off.isActive) {
            await db.updateOffer(off.id, { isActive: false });
          }
        }
      }

      if (target.telegramChatId) {
        void telegramBot.sendTelegramMessage(
          target.telegramChatId,
          nextSuspended
            ? `🚫 <b>Account Suspended</b>\nYour Fetan P2P account has been suspended.\nReason: ${cleanReason}`
            : `✅ <b>Account Reactivated</b>\nYour Fetan P2P account has been unsuspended. Trading access is restored.`
        );
      }

      await db.logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: nextSuspended ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED',
        targetType: 'User',
        targetId: target.id,
        ip,
        details: { nextSuspended, suspendReason: cleanReason || null },
      });
    }

    wsGateway.emitToUser(updated.id, 'user_updated', { user: updated });
    wsGateway.emitToRoom('admin:dashboard', 'user_updated', { user: updated });

    return NextResponse.json({ success: true, user: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
