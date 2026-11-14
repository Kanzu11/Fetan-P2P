import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { telegramBot } from '@/server/telegram-bot';
import { escrowController } from '@/server/escrow-controller';
import { requireAdmin } from '@/server/security/session';
import { sanitizeString } from '@/server/security/sanitize';
import { wsGateway } from '@/server/websocket-gateway';
import type { KycSubmission, PaymentMethod } from '@/client/types';
import { isAdminRole } from '@/client/types';

export const dynamic = 'force-dynamic';

function hasValidSyncSecret(req: Request): boolean {
  const syncSecret = (
    process.env.TELEGRAM_SYNC_SECRET ||
    process.env.TGCLOUD_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ''
  ).trim();
  if (!syncSecret) return false;

  const authHeader = req.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const xSecret = req.headers.get('x-telegram-sync-secret') || '';
  const candidate = bearerToken || xSecret;
  if (!candidate) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(syncSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const syncBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('LINK_TELEGRAM'),
    codeOrUserId: z.string().min(1),
    chatId: z.union([z.string(), z.number()]),
    username: z.string().optional(),
  }),
  z.object({
    action: z.literal('TELEGRAM_KYC'),
    telegramHandle: z.string().min(1),
    docType: z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE']),
    docNumber: z.string().min(4).max(60),
    docPhotoUrl: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('ADMIN_ORDER_ACTION'),
    orderId: z.string().min(1),
    orderAction: z.enum(['RELEASE', 'CANCEL']),
    actorTelegram: z.string().min(1),
    note: z.string().max(300).optional(),
  }),
  z.object({
    action: z.literal('GET_BOT_MARKET'),
    tgId: z.union([z.string(), z.number()]).optional(),
    username: z.string().optional(),
  }),
  z.object({
    action: z.literal('CREATE_BOT_ORDER'),
    offerId: z.string().min(1),
    usdtAmount: z.number().positive(),
    paymentMethod: z.string().optional(),
    tgId: z.union([z.string(), z.number()]).optional(),
    username: z.string().optional(),
  }),
  z.object({
    action: z.literal('USER_ORDER_ACTION'),
    orderId: z.string().min(1),
    orderAction: z.enum(['MARK_PAID', 'RELEASE', 'CANCEL', 'DISPUTE']),
    tgId: z.union([z.string(), z.number()]).optional(),
    username: z.string().optional(),
    note: z.string().max(300).optional(),
  }),
]);

export async function GET(req: Request) {
  const isSecret = hasValidSyncSecret(req);
  if (!isSecret) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(req.url);
  const includeMarket = searchParams.get('includeMarket') === 'true';
  const lookup = searchParams.get('lookup');

  const offers = includeMarket
    ? (await db.getOffers()).filter((o) => o.isActive && o.totalAvailable > 0).slice(0, 20)
    : undefined;
  const user = lookup ? await db.getUserByTelegram(lookup) : undefined;
  const orders = user ? await db.getOrdersForUser(user.id) : undefined;

  return NextResponse.json({
    status: 'online',
    botUsername: telegramBot.getBotUsername(),
    miniAppUrl: telegramBot.getMiniAppUrl(),
    offers,
    user,
    orders,
  });
}

export async function POST(req: Request) {
  try {
    if (!hasValidSyncSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized sync action' }, { status: 401 });
    }

    const rawBody = await req.json();
    const parsed = syncBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid sync action payload' },
        { status: 400 }
      );
    }

    const data = parsed.data;

    if (data.action === 'LINK_TELEGRAM') {
      const linked = await db.linkTelegramAccount(
        data.codeOrUserId,
        String(data.chatId),
        data.username
      );
      if (!linked) {
        return NextResponse.json(
          { error: 'No matching account found for that code or handle.' },
          { status: 404 }
        );
      }
      wsGateway.emitToUser(linked.id, 'user_updated', { user: linked });
      return NextResponse.json({ success: true, user: linked });
    }

    if (data.action === 'TELEGRAM_KYC') {
      const targetUser = await db.getUserByTelegram(data.telegramHandle);
      if (!targetUser) {
        return NextResponse.json(
          { error: 'Telegram user is not linked to a Fetan P2P account.' },
          { status: 404 }
        );
      }

      const cleanDoc = sanitizeString(data.docNumber, 60);
      const sub: KycSubmission = {
        id: `kyc-${crypto.randomUUID()}`,
        userId: targetUser.id,
        userEmail: targetUser.email,
        userName: targetUser.name,
        telegramHandle: targetUser.telegramHandle,
        source: 'TELEGRAM_BOT',
        kycDocType: data.docType,
        kycDocNumber: cleanDoc,
        docPhotoUrl: data.docPhotoUrl?.trim() || undefined,
        status: 'PENDING',
        submittedAt: new Date().toISOString(),
      };

      const saved = await db.saveKycSubmission(sub);
      await db.updateUser(targetUser.id, {
        kycStatus: 'PENDING',
        kycDocType: data.docType,
        kycDocNumber: cleanDoc,
        kycSubmittedAt: saved.submittedAt,
      });
      await telegramBot.sendKycSubmissionAlert(saved);
      return NextResponse.json({ success: true, submission: saved });
    }

    if (data.action === 'ADMIN_ORDER_ACTION') {
      const adminUser = await db.getUserByTelegram(data.actorTelegram);
      if (!adminUser || (adminUser.role !== 'ADMIN' && adminUser.role !== 'SUPERADMIN')) {
        return NextResponse.json(
          { error: 'Telegram actor is not an authorized Admin or Superadmin.' },
          { status: 403 }
        );
      }

      const order =
        data.orderAction === 'RELEASE'
          ? await escrowController.releaseEscrow(
            data.orderId,
            adminUser.id,
            sanitizeString(data.note, 250) || 'Released via Admin Sync'
          )
          : await escrowController.cancelEscrow(
            data.orderId,
            adminUser.id,
            sanitizeString(data.note, 250) || 'Cancelled via Admin Sync'
          );

      return NextResponse.json({ success: true, order });
    }

    if (data.action === 'GET_BOT_MARKET') {
      const lookupKey = data.tgId ? String(data.tgId) : data.username || '';
      const user = lookupKey ? await db.getUserByTelegram(lookupKey) : undefined;
      const offers = (await db.getOffers())
        .filter((o) => o.isActive && o.totalAvailable > 0)
        .slice(0, 12);
      const orders = user ? (await db.getOrdersForUser(user.id)).slice(0, 12) : [];
      return NextResponse.json({ success: true, user, offers, orders });
    }

    if (data.action === 'CREATE_BOT_ORDER') {
      const lookupKey = data.tgId ? String(data.tgId) : data.username || '';
      const user = lookupKey ? await db.getUserByTelegram(lookupKey) : undefined;
      if (!user) {
        return NextResponse.json(
          { error: 'Please link your Fetan P2P account before placing trades.' },
          { status: 404 }
        );
      }
      if (user.kycStatus !== 'VERIFIED' && !isAdminRole(user.role)) {
        return NextResponse.json(
          { error: 'Identity verification is required before trading.' },
          { status: 403 }
        );
      }
      const offer = await db.getOffer(data.offerId);
      if (!offer) {
        return NextResponse.json({ error: 'Offer not found.' }, { status: 404 });
      }
      const method = (data.paymentMethod || offer.paymentMethods[0] || 'TELEBIRR') as PaymentMethod;
      const order = await escrowController.lockEscrow({
        offerId: offer.id,
        buyerId: user.id,
        usdtAmount: data.usdtAmount,
        paymentMethod: method,
      });
      return NextResponse.json({ success: true, order });
    }

    if (data.action === 'USER_ORDER_ACTION') {
      const lookupKey = data.tgId ? String(data.tgId) : data.username || '';
      const user = lookupKey ? await db.getUserByTelegram(lookupKey) : undefined;
      if (!user) {
        return NextResponse.json({ error: 'Account not found for Telegram user.' }, { status: 404 });
      }
      let order;
      if (data.orderAction === 'MARK_PAID') {
        order = await escrowController.confirmPayment(data.orderId, user.id);
      } else if (data.orderAction === 'RELEASE') {
        order = await escrowController.releaseEscrow(data.orderId, user.id, data.note);
      } else if (data.orderAction === 'CANCEL') {
        order = await escrowController.cancelEscrow(data.orderId, user.id, data.note);
      } else {
        order = await escrowController.disputeTrade(
          data.orderId,
          user.id,
          data.note || 'Opened dispute via Telegram'
        );
      }
      return NextResponse.json({ success: true, order });
    }

    return NextResponse.json({ error: 'Unknown sync action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Telegram sync failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
