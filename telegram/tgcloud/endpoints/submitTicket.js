import { db, eq } from 'sdk/db';
import { api, EndpointError } from 'sdk';
import { users, supportTickets } from '../schema.js';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user || input?.user;
  if (!tgUser?.id) {
    throw new EndpointError('Authentication required via Telegram Mini App', { code: 'UNAUTHORIZED' });
  }

  const { orderId, category, message } = input || {};
  if (!message || !message.trim()) {
    throw new EndpointError('Please write your message for support', { code: 'EMPTY_MESSAGE' });
  }

  let user = await db.select().from(users).where(eq(users.tgId, tgUser.id)).get();
  const userName = user?.name || tgUser.first_name || 'Trader';
  const userId = user?.id || `usr-tg-${tgUser.id}`;

  const ticketId = `sup-app-${Date.now().toString(36)}`;
  await db.insert(supportTickets).values({
    id: ticketId,
    userId,
    userName,
    orderId: orderId?.trim() || null,
    category: category || 'ORDER_COMPLAINT',
    subject: orderId?.trim() ? `Order #${orderId.trim()} Complaint` : 'Mini App Support Request',
    message: message.trim(),
    status: 'OPEN',
    createdAt: new Date().toISOString(),
  }).run();

  // Alert Superadmin @kanzedin
  try {
    const superUser = await db.select().from(users).where(eq(users.role, 'SUPERADMIN')).get();
    if (superUser && superUser.tgId) {
      await api.sendMessage({
        chat_id: superUser.tgId,
        parse_mode: 'HTML',
        text: `🚨 <b>NEW ORDER COMPLAINT / SUPPORT via Mini App</b>\n\n• From: <b>${userName}</b>\n• Order ID: ${orderId ? `<code>${orderId}</code>` : 'General'}\n• Message:\n"${message.trim()}"`,
        reply_markup: {
          inline_keyboard: [
            orderId ? [{ text: `🔓 Release Order`, callback_data: `order_release:${orderId.trim()}` }] : [],
            [{ text: '✅ Mark Ticket Resolved', callback_data: `ticket_resolve:${ticketId}` }],
          ].filter((row) => row.length > 0),
        },
      });
    }
  } catch {}

  return { ok: true, ticketId, message: 'Your complaint was sent to Superadmin @kanzedin' };
}
