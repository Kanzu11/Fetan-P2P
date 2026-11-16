export type AlertLevel = 'CRITICAL' | 'WARN' | 'INFO';

export interface PayoutAlerter {
  send(level: AlertLevel, title: string, detail?: string): Promise<void>;
  notifyUser(telegramChatId: string | null | undefined, markdownText: string): Promise<void>;
}

/**
 * Lightweight standalone Telegram Bot API alerter.
 * Intentionally decoupled from server/telegram-bot.ts so the isolated worker
 * pulls zero unnecessary web or bot dependencies.
 */
export function createTelegramAlerter(): PayoutAlerter {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() || '';

  async function postTelegram(chatId: string, text: string, parseMode = 'Markdown'): Promise<void> {
    if (!token || !chatId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[ALERT] Telegram HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
    } catch (err) {
      console.error('[ALERT] Telegram dispatch error:', err instanceof Error ? err.message : err);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async send(level: AlertLevel, title: string, detail?: string): Promise<void> {
      const badge = level === 'CRITICAL' ? '🚨 CRITICAL' : level === 'WARN' ? '⚠️ WARN' : 'ℹ️ INFO';
      const line = `[${badge}] ${title}${detail ? ` — ${detail}` : ''}`;
      if (level === 'CRITICAL') console.error(line);
      else console.log(line);

      if (adminChatId) {
        const formatted = `${badge} *Fetan Payout Worker*\n\n*${title}*${
          detail ? `\n\`${detail.replace(/`/g, "'").slice(0, 1200)}\`` : ''
        }`;
        await postTelegram(adminChatId, formatted);
      }
    },

    async notifyUser(telegramChatId: string | null | undefined, markdownText: string): Promise<void> {
      if (!telegramChatId) return;
      await postTelegram(telegramChatId, markdownText);
    },
  };
}
