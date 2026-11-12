import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { telegramBot } from '@/server/telegram-bot';
import { requireAdmin } from '@/server/security/session';

export const dynamic = 'force-dynamic';

function hasValidWebhookSecret(req: Request): boolean {
  const webhookSecret = (
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ''
  ).trim();
  if (!webhookSecret) return false;

  const headerSecret =
    req.headers.get('x-telegram-bot-api-secret-token') ||
    req.headers.get('x-webhook-secret') ||
    '';

  if (!headerSecret) return false;

  const a = Buffer.from(headerSecret);
  const b = Buffer.from(webhookSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    if (!hasValidWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
    }

    const update = await req.json();
    if (!update || typeof update !== 'object') {
      return NextResponse.json({ error: 'Invalid Telegram update payload' }, { status: 400 });
    }

    await telegramBot.handleWebhookUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Webhook handling failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const logs = telegramBot.getRecentLogs();
  return NextResponse.json({
    botUsername: telegramBot.getBotUsername(),
    miniAppUrl: telegramBot.getMiniAppUrl(),
    totalEventsLogged: logs.length,
    logs: logs.slice(0, 30),
  });
}
