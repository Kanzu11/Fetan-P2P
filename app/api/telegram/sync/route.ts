import { NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { escrowController } from '@/server/escrow-controller';
import { telegramBot } from '@/server/telegram-bot';
import { KycDocType } from '@/lib/types';

/**
 * Shared Database Synchronization Endpoint between Website & Telegram Serverless (@tgcloud/bot)
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    botUsername: telegramBot.getBotUsername(),
    miniAppUrl: telegramBot.getMiniAppUrl(),
    superadmin: '@kanzedin',
    users: db.getAllUsers(),
    offers: db.getOffers(undefined, undefined, true),
    orders: db.getAllOrders(),
    kycSubmissions: db.getKycSubmissions(),
    merchantApplications: db.getMerchantApplications(),
    supportTickets: db.getSupportTickets(),
  });
}

export async function POST(req: Request) {
  try {
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
      const user = db.createOrGetTelegramUser({ tgId: String(tgId), username, name, email });
      db.updateUser(user.id, {
        kycStatus: 'PENDING',
        kycDocType: (docType as KycDocType) || 'NATIONAL_ID',
        kycDocNumber: docNumber,
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
        kycDocNumber: docNumber,
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
        const order = await escrowController.releaseEscrow(orderId, actorId, note || 'Released via @fetanp2probot by @kanzedin');
        return NextResponse.json({ success: true, order });
      }
      if (decision === 'CANCEL') {
        const order = await escrowController.cancelEscrow(orderId, actorId, note || 'Cancelled via @fetanp2probot by @kanzedin');
        return NextResponse.json({ success: true, order });
      }
    }

    return NextResponse.json({ error: 'Unknown sync action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

