import { NextResponse } from 'next/server';
import { prisma } from '@/server/database/prisma';
import { telegramBot } from '@/server/telegram-bot';

export const dynamic = 'force-dynamic';

let lastDeadManAlertAt = 0;
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const STALE_HEARTBEAT_MS = 120 * 1000;

/**
 * Health and payout-worker dead-man switch endpoint.
 * Point a free uptime monitor (e.g., UptimeRobot every 5 min) at GET /api/health
 * to alert Telegram admins if the Oracle Cloud ARM worker goes silent > 2 minutes.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const control = await prisma.payoutControl.findUnique({ where: { id: 'BEP20' } });

    const lastBeat = control?.lastHeartbeatAt ?? null;
    const staleMs = lastBeat ? Date.now() - lastBeat.getTime() : null;
    const workerHealthy =
      staleMs !== null && staleMs <= STALE_HEARTBEAT_MS && !(control?.paused ?? false);

    // Dead-man alert only fires when the worker previously checked in and later stopped
    if (
      lastBeat !== null &&
      staleMs !== null &&
      staleMs > STALE_HEARTBEAT_MS &&
      Date.now() - lastDeadManAlertAt > ALERT_COOLDOWN_MS
    ) {
      const pendingBep20Count = await prisma.withdrawal.count({
        where: { network: 'BEP20', status: { in: ['PENDING', 'PROCESSING'] } },
      });

      if (pendingBep20Count > 0 || !control?.paused) {
        lastDeadManAlertAt = Date.now();
        await telegramBot.broadcastAdminAlert(
          `⚠️ *Payout Worker Dead-Man Alert*\n\nOracle ARM worker has not sent a heartbeat in *${Math.round(
            staleMs / 1000
          )}s*.\nPaused: \`${Boolean(control?.paused)}\`\nPending/Processing BEP-20 payouts: \`${pendingBep20Count}\``
        );
      }
    }

    return NextResponse.json({
      ok: true,
      database: 'connected',
      payoutWorker: {
        configured: Boolean(control),
        paused: control?.paused ?? false,
        pauseReason: control?.pauseReason ?? null,
        lastHeartbeatAt: lastBeat ? lastBeat.toISOString() : null,
        staleSeconds: staleMs !== null ? Math.round(staleMs / 1000) : null,
        healthy: workerHealthy,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Health check failed',
      },
      { status: 503 }
    );
  }
}
