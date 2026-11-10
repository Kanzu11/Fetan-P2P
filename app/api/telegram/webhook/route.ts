import { NextResponse } from 'next/server';
import { telegramBot } from '@/server/telegram-bot';
import { escrowController } from '@/server/escrow-controller';
import { db } from '@/lib/db/store';

export async function POST(req: Request) {
  try {
    const update = await req.json();

    if (update.action === 'simulate_callback') {
      const { callbackData, reviewedBy } = update;
      const adminActor = reviewedBy || '@kanzedin';
      const superadminId = db.getSuperadminUser()?.id || 'usr-super-yared';

      if (callbackData?.startsWith('approve_merchant:')) {
        const appId = callbackData.replace('approve_merchant:', '');
        const app = await telegramBot.handleMerchantApproval(appId, adminActor, true);
        return NextResponse.json({ success: true, app, message: 'Merchant approved via @fetanp2probot' });
      }
      if (callbackData?.startsWith('reject_merchant:')) {
        const appId = callbackData.replace('reject_merchant:', '');
        const app = await telegramBot.handleMerchantApproval(appId, adminActor, false);
        return NextResponse.json({ success: true, app, message: 'Merchant rejected via @fetanp2probot' });
      }
      if (callbackData?.startsWith('approve_kyc:')) {
        const kycId = callbackData.replace('approve_kyc:', '');
        const kyc = await telegramBot.handleKycApproval(kycId, adminActor, true);
        return NextResponse.json({ success: true, kyc, message: 'KYC approved via @fetanp2probot' });
      }
      if (callbackData?.startsWith('reject_kyc:')) {
        const kycId = callbackData.replace('reject_kyc:', '');
        const kyc = await telegramBot.handleKycApproval(kycId, adminActor, false);
        return NextResponse.json({ success: true, kyc, message: 'KYC rejected via @fetanp2probot' });
      }
      if (callbackData?.startsWith('admin_release:') || callbackData?.startsWith('order_release:')) {
        const orderId = callbackData.replace(/^(admin_release:|order_release:)/, '');
        const order = await escrowController.releaseEscrow(
          orderId,
          superadminId,
          'Released via @fetanp2probot inline button by @kanzedin'
        );
        return NextResponse.json({ success: true, order, message: `Order #${orderId} released to buyer` });
      }
      if (callbackData?.startsWith('admin_cancel:') || callbackData?.startsWith('order_cancel:')) {
        const orderId = callbackData.replace(/^(admin_cancel:|order_cancel:)/, '');
        const order = await escrowController.cancelEscrow(
          orderId,
          superadminId,
          'Cancelled via @fetanp2probot inline button by @kanzedin'
        );
        return NextResponse.json({ success: true, order, message: `Order #${orderId} cancelled` });
      }
      if (callbackData?.startsWith('resolve_ticket:')) {
        const ticketId = callbackData.replace('resolve_ticket:', '');
        const existing = db.getSupportTicket(ticketId);
        if (existing) {
          existing.status = 'RESOLVED';
          existing.resolvedBy = '@kanzedin';
          existing.adminReply = 'Resolved via @fetanp2probot by @kanzedin.';
          existing.updatedAt = new Date().toISOString();
          db.saveSupportTicket(existing);
        }
        return NextResponse.json({ success: true, message: 'Support ticket resolved' });
      }
    }

    await telegramBot.handleWebhookUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const logs = telegramBot.getRecentLogs();
  return NextResponse.json({
    botUsername: telegramBot.getBotUsername(),
    miniAppUrl: telegramBot.getMiniAppUrl(),
    superadmin: '@kanzedin',
    logs,
  });
}
