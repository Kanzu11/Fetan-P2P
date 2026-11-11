import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';
import { MerchantApplication } from '@/client/types';

export async function POST(req: Request) {
  try {
    const {
      userId,
      telegramHandle,
      businessName,
      terms,
      tradeExperience,
      proofDocumentUrl,
      kycDocType,
      kycDocNumber,
    } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const user = db.getUser(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Gatekeeper rule: Balance >= 10 USDT
    if (user.usdtBalance < 10.0) {
      return NextResponse.json(
        {
          error: `Minimum 10.00 USDT balance required to apply for merchant status. Current balance: ${user.usdtBalance.toFixed(2)} USDT.`
        },
        { status: 400 }
      );
    }

    // Update user's merchantStatus to PENDING
    db.updateUser(userId, {
      merchantStatus: 'PENDING',
      telegramHandle: telegramHandle || user.telegramHandle,
    });

    const application: MerchantApplication = {
      id: `app-${Date.now()}`,
      userId,
      userEmail: user.email,
      userName: user.name,
      businessName: businessName?.trim() || undefined,
      telegramHandle: telegramHandle || user.telegramHandle || '@unknown',
      kycDocType: kycDocType || user.kycDocType || 'NATIONAL_ID',
      kycDocNumber: kycDocNumber || user.kycDocNumber || 'FAYDA-VERIFIED',
      proofDocumentUrl: proofDocumentUrl || undefined,
      tradeExperience: tradeExperience?.trim() || undefined,
      terms: terms?.trim() || undefined,
      usdtBalance: user.usdtBalance,
      status: 'PENDING',
      submittedAt: new Date().toISOString()
    };

    db.saveMerchantApplication(application);

    // 1. WebSocket broadcast: new_merchant_request to connected Admins on Admin Dashboard
    wsGateway.emitToRoom('admin:dashboard', 'new_merchant_request', application);

    // 2. Telegram Bot alert to Superadmin (@kanzedin)
    telegramBot.sendMerchantApplicationAlert(application);

    return NextResponse.json({
      success: true,
      application,
      message: 'Merchant application submitted. Superadmin @kanzedin notified via Telegram and email.'
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
