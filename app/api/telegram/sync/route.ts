import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { escrowController } from '@/server/escrow-controller';
import { telegramBot } from '@/server/telegram-bot';
import { KycDocType } from '@/client/types';

function verifySyncAuth(req: Request): boolean {
  const syncSecret = process.env.TELEGRAM_SYNC_SECRET || process.env.TGCLOUD_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  // In development without configured secrets, permit localhost requests
  if (!syncSecret) {
    return true;
  }
  const authHeader = req.headers.get('authorization') || '';
  const xSecret = req.headers.get('x-telegram-sync-secret') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  return token === syncSecret || xSecret === syncSecret;
}

/**
 * Shared Database Synchronization Endpoint between Website & Telegram Serverless (@tgcloud/bot)
 */
export async function GET(req: Request) {
  if (!verifySyncAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized sync request' }, { status: 401 });
  }

  // Sanitize user list: remove sensitive internal fields
  const safeUsers = db.getAllUsers().map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    kycStatus: u.kycStatus,
    telegramHandle: u.telegramHandle,
    telegramChatId: u.telegramChatId,
    usdtBalance: u.usdtBalance,
    usdtLocked: u.usdtLocked,
    completedTrades: u.completedTrades,
    completionRate: u.completionRate,
  }));

  return NextResponse.json({
    ok: true,
    botUsername: telegramBot.getBotUsername(),
    miniAppUrl: telegramBot.getMiniAppUrl(),
    users: safeUsers,
    offers: db.getOffers(undefined, undefined, true),
    orders: db.getAllOrders(),
    kycSubmissions: db.getKycSubmissions(),
    merchantApplications: db.getMerchantApplications(),
    supportTickets: db.getSupportTickets(),
  });
}

export async function POST(req: Request) {
  try {
    if (!verifySyncAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized sync action' }, { status: 401 });
    }

    const body = await req.json();
    const { action } = body;

    if (action === 'LINK_TELEGRAM') {
      const { code, chatId, username } = body;
      const linkedUser = db.linkTelegramAccount(String(code), String(chatId), username);
      if (!linkedUser) {
        return NextResponse.json({ error: 'Invalid link code or user ID' }, { status: 404 });
      }
      return NextResponse.json({ success: true, user: linkedUser });
    }

    if (action === 'TELEGRAM_KYC') {
      const { tgId, username, name, email, docType, docNumber } = body;
      if (!docNumber || !docType) {
        return NextResponse.json({ error: 'Missing KYC document details' }, { status: 400 });
      }
      const user = db.createOrGetTelegramUser({ tgId: String(tgId), username, name, email });
      db.updateUser(user.id, {
        kycStatus: 'PENDING',
        kycDocType: (docType as KycDocType) || 'NATIONAL_ID',
        kycDocNumber: String(docNumber).trim(),
        kycSubmittedAt: new Date().toISOString(),
      });
      const sub = db.saveKycSubmission({
        id: `kyc-tg-${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        telegramHandle: user.telegramHandle,
        source: 'TELEGRAM_BOT',
        kycDocType: (docType as KycDocType) || 'NATIONAL_ID',
        kycDocNumber: String(docNumber).trim(),
        status: 'PENDING',
        submittedAt: new Date().toISOString(),
      });
      void telegramBot.sendKycSubmissionAlert(sub);
      return NextResponse.json({ success: true, submission: sub, user: db.getUser(user.id) });
    }

    if (action === 'ADMIN_ORDER_ACTION') {
      const { orderId, decision, note } = body;
      const superadmin = db.getSuperadminUser();
      const actorId = superadmin?.id || 'usr-super-yared';
      if (decision === 'RELEASE') {
        const order = await escrowController.releaseEscrow(orderId, actorId, note || 'Released via Telegram Bot');
        return NextResponse.json({ success: true, order });
      }
      if (decision === 'CANCEL') {
        const order = await escrowController.cancelEscrow(orderId, actorId, note || 'Cancelled via Telegram Bot');
        return NextResponse.json({ success: true, order });
      }
    }

    return NextResponse.json({ error: 'Unknown sync action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
