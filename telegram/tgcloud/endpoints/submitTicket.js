import { db } from 'sdk/db';
import { api, EndpointError } from 'sdk';
import { supportTickets } from '../schema.js';
import {
  ensureNeonTelegramUser,
  queryNeon,
  getNeonAdminChatIds,
  makeId,
} from '../lib/neon.js';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user || input?.user;
  if (!tgUser?.id) {
    throw new EndpointError('Authentication required via Telegram Mini App', { code: 'UNAUTHORIZED' });
  }

  const { orderId, category, message } = input || {};
  if (!message || !message.trim()) {
    throw new EndpointError('Please write your message for support', { code: 'EMPTY_MESSAGE' });
  }

  const user = await ensureNeonTelegramUser(tgUser);
  const ticketId = makeId('sup-app');
  const cleanOrderId = orderId?.trim() || null;
  const cleanMsg = message.trim();
  const cleanCategory = category || 'ORDER_COMPLAINT';
  const subject = cleanOrderId ? `Order #${cleanOrderId} Complaint` : 'Mini App Support Request';

  await queryNeon(
    `INSERT INTO "SupportTicket" (
       "id", "userId", "userName", "userEmail", "telegramHandle",
       "orderId", "category", "subject", "message", "status", "source", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, 'OPEN', 'MINI_APP', NOW()
     )`,
    [
      ticketId,
      user.id,
      user.name,
      user.email,
      user.telegramHandle || null,
      cleanOrderId,
      cleanCategory,
      subject,
      cleanMsg,
    ]
  );

  // Best-effort mirror to local TGCloud SQLite
  try {
    await db.insert(supportTickets).values({
      id: ticketId,
      userId: user.id,
      userName: user.name,
      orderId: cleanOrderId,
      category: cleanCategory,
      subject,
      message: cleanMsg,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    }).run();
  } catch {}

  const adminChatIds = await getNeonAdminChatIds();
  const alertText =
    `🚨 <b>NEW ORDER COMPLAINT / SUPPORT via Mini App</b>\n\n` +
    `• From: <b>${user.name}</b> (${user.telegramHandle || user.email})\n` +
    `• Order ID: ${cleanOrderId ? `<code>${cleanOrderId}</code>` : 'General'}\n` +
    `• Message:\n"${cleanMsg}"`;

  const inlineKeyboard = [
    cleanOrderId ? [{ text: '🔓 Release Order', callback_data: `order_release:${cleanOrderId}` }] : [],
    [{ text: '✅ Mark Ticket Resolved', callback_data: `ticket_resolve:${ticketId}` }],
  ].filter((row) => row.length > 0);

  for (const admId of adminChatIds) {
    await api.sendMessage({
      chat_id: admId,
      parse_mode: 'HTML',
      text: alertText,
      reply_markup: { inline_keyboard: inlineKeyboard },
    }).catch(() => {});
  }

  return { ok: true, ticketId, message: 'Your support request was sent to Fetan Support Desk' };
}
