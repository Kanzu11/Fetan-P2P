import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { verifyAndConsumeOtp } from '@/server/security/otp';
import { sanitizeAmount, validateCryptoAddress } from '@/server/security/sanitize';
import { wsGateway } from '@/server/websocket-gateway';
import { telegramBot } from '@/server/telegram-bot';

export const dynamic = 'force-dynamic';

const withdrawSchema = z.object({
  amountUsdt: z.number().min(5, 'Minimum withdrawal is 5.00 USDT.').max(100000),
  network: z.enum(['TRC20', 'BEP20', 'TON']),
  destinationAddress: z.string().min(8, 'Valid destination address required.').max(120),
  otpCode: z.string().regex(/^\d{6}$/, '6-digit email verification code is required.'),
});

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const ip = getClientIp(req);
    const limit = await rateLimiter.checkAsync(`withdraw:${auth.user.id}:${ip}`, 5, 900);
    if (!limit.allowed) {
      return rateLimiter.rateLimitResponse(
        limit.resetSeconds,
        'Too many withdrawal requests. Please wait before trying again.'
      );
    }

    if (auth.user.kycStatus !== 'VERIFIED') {
      return NextResponse.json(
        { error: 'KYC verification must be approved before requesting withdrawals.' },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const rawAmount = rawBody?.amountUsdt ?? rawBody?.amount;
    const parsed = withdrawSchema.safeParse({
      ...rawBody,
      amountUsdt: sanitizeAmount(rawAmount, 6) ?? rawAmount,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid withdrawal request.' },
        { status: 400 }
      );
    }

    const { amountUsdt, network, otpCode } = parsed.data;
    const cleanAddress = parsed.data.destinationAddress.trim();

    const addrCheck = validateCryptoAddress(cleanAddress, network);
    if (!addrCheck.valid) {
      return NextResponse.json(
        { error: addrCheck.error || `Invalid ${network} destination wallet address.` },
        { status: 400 }
      );
    }

    const otpCheck = await verifyAndConsumeOtp({
      email: auth.user.email,
      purpose: 'WITHDRAW',
      code: otpCode,
    });

    if (!otpCheck.valid) {
      await db.logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: 'WITHDRAW_OTP_FAILED',
        targetType: 'User',
        targetId: auth.user.id,
        ip,
        details: { reason: otpCheck.error },
      });
      return NextResponse.json(
        { error: otpCheck.error || 'Invalid or expired withdrawal confirmation code.' },
        { status: 401 }
      );
    }

    const meta = otpCheck.metadata;
    if (meta) {
      const metaAmount = typeof meta.amountUsdt === 'number' ? Number(meta.amountUsdt) : null;
      const metaNet = typeof meta.network === 'string' ? meta.network : null;
      const metaAddr =
        typeof meta.destinationAddress === 'string' ? meta.destinationAddress.trim() : null;

      if (
        (metaAmount !== null && Math.abs(metaAmount - amountUsdt) > 0.000001) ||
        (metaNet && metaNet !== network) ||
        (metaAddr && metaAddr !== cleanAddress)
      ) {
        return NextResponse.json(
          {
            error:
              'Withdrawal amount, network, or destination address changed after your verification code was issued. Please request a fresh code.',
          },
          { status: 400 }
        );
      }
    }

    const result = await db.withUserLock(auth.user.id, async (lockedUser) => {
      if (lockedUser.usdtBalance < amountUsdt) {
        throw new Error(
          `Insufficient available balance (${lockedUser.usdtBalance.toFixed(2)} USDT available).`
        );
      }

      const newBalance = Number((lockedUser.usdtBalance - amountUsdt).toFixed(6));
      const updatedUser = await db.updateUser(lockedUser.id, { usdtBalance: newBalance });

      const tx = await db.saveWalletTransaction({
        id: `wdr-${crypto.randomUUID()}`,
        userId: lockedUser.id,
        type: 'WITHDRAW',
        amount: amountUsdt,
        network,
        address: cleanAddress,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        note: `Pending admin review & on-chain payout (${network})`,
      });

      return { updatedUser, tx };
    });

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: 'WITHDRAWAL_REQUESTED',
      targetType: 'WalletTransaction',
      targetId: result.tx.id,
      ip,
      details: { amountUsdt, network, destinationAddress: cleanAddress },
    });

    wsGateway.emitToUser(auth.user.id, 'balance_updated', {
      usdtBalance: result.updatedUser.usdtBalance,
      usdtLocked: result.updatedUser.usdtLocked,
      message: `Withdrawal request submitted: -${amountUsdt.toFixed(2)} USDT (${network}) pending review.`,
    });
    wsGateway.emitToRoom('admin:dashboard', 'withdrawal_requested', { tx: result.tx });

    await telegramBot.broadcastAdminAlert(
      `📤 *New Withdrawal Request*\nUser: *${auth.user.name}* (${auth.user.email})\nAmount: *${amountUsdt.toFixed(2)} USDT*\nNetwork: *${network}*\nTo: \`${cleanAddress}\`\nReview in Admin Console.`
    );

    return NextResponse.json({
      success: true,
      user: result.updatedUser,
      transaction: result.tx,
      message: `Withdrawal of ${amountUsdt.toFixed(2)} USDT queued for payout verification.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Withdrawal failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
