import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { telegramBot } from '@/server/telegram-bot';
import { escrowController } from '@/server/escrow-controller';
import { requireAdmin } from '@/server/security/session';
import { sanitizeString } from '@/server/security/sanitize';
import { wsGateway } from '@/server/websocket-gateway';
import type { KycSubmission } from '@/client/types';

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
]);

export async function GET(req: Request) {
  const isSecret = hasValidSyncSecret(req);
  if (!isSecret) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  return NextResponse.json({
    status: 'online',
    botUsername: telegramBot.getBotUsername(),
    miniAppUrl: telegramBot.getMiniAppUrl(),
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

    return NextResponse.json({ error: 'Unknown sync action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Telegram sync failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
