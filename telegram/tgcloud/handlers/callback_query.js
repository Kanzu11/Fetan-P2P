import { api, fetch } from 'sdk';
import { db, eq } from 'sdk/db';
import { users, orders, kycSubmissions, merchantApplications, supportTickets } from '../schema.js';

const WEB_API_URL = 'http://localhost:3000/api/telegram/sync';
const MINIAPP_URL = 'https://app9136159373.tgcloud.ai/';
const SUPERADMIN_USERNAME = 'kanzedin';

export default async function (callbackQuery, ctx) {
  const queryId = callbackQuery.id;
  const data = callbackQuery.data || '';
  const message = callbackQuery.message;
  const chatId = message?.chat?.id;
  const fromUser = callbackQuery.from || {};
  const tgUsername = (fromUser.username || '').replace(/^@/, '').toLowerCase();
  const isSuperadmin = tgUsername === SUPERADMIN_USERNAME;

  // Toggle order notifications for user/merchant
  if (data === 'toggle_notify') {
    const user = await db.select().from(users).where(eq(users.tgId, fromUser.id)).get();
    const current = user ? Boolean(user.notifications) : true;
    const nextVal = !current;

    if (user) {
      await db.update(users).set({ notifications: nextVal }).where(eq(users.id, user.id)).run();
    }

    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: nextVal ? 'Order notifications enabled! 🔔' : 'Order notifications paused. 🔕',
    });

    if (chatId && message?.message_id) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `🔔 <b>Order Notifications Status:</b> <b>${nextVal ? 'ENABLED' : 'PAUSED'}</b>\n\n${nextVal ? 'You will receive immediate alerts for new orders, payment confirmations, and releases.' : 'You will not receive bot messages for new orders.'}`,
      });
    }
    return;
  }

  // User prompts
  if (data === 'start_kyc') {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    if (chatId) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `🪪 <b>Submit ID Verification (KYC)</b>\n\nPlease reply with:\n<code>/kyc &lt;Fayda or Passport Number&gt;</code>\n\nOr complete verification in the Mini App:`,
        reply_markup: {
          inline_keyboard: [[{ text: '📱 Open KYC in Mini App', web_app: { url: MINIAPP_URL } }]],
        },
      });
    }
    return;
  }

  if (data === 'open_support') {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    if (chatId) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `💬 <b>Support & Order Complaints</b>\n\nTo file a complaint directly to Superadmin @${SUPERADMIN_USERNAME}, send:\n<code>/support &lt;Your order ID & details&gt;</code>`,
      });
    }
    return;
  }

  // SUPERADMIN ACTIONS: KYC Approve / Reject
  if (data.startsWith('kyc_approve:') || data.startsWith('kyc_reject:')) {
    const isApprove = data.startsWith('kyc_approve:');
    const kycId = data.split(':')[1];

    await db.update(kycSubmissions).set({ status: isApprove ? 'VERIFIED' : 'REJECTED' }).where(eq(kycSubmissions.id, kycId)).run();
    const kyc = await db.select().from(kycSubmissions).where(eq(kycSubmissions.id, kycId)).get();

    if (kyc && kyc.userId) {
      await db.update(users).set({ kycStatus: isApprove ? 'VERIFIED' : 'REJECTED' }).where(eq(users.id, kyc.userId)).run();

      // Notify the applicant
      const applicant = await db.select().from(users).where(eq(users.id, kyc.userId)).get();
      if (applicant && applicant.tgId) {
        try {
          await api.sendMessage({
            chat_id: applicant.tgId,
            parse_mode: 'HTML',
            text: isApprove
              ? `🎉 <b>Identity Verification Approved!</b>\nYour Fetan P2P account is verified. You can now buy and sell USDT freely.`
              : `❌ <b>Identity Verification Rejected</b>\nPlease submit clear ID details using <code>/kyc</code>.`,
          });
        } catch {}
      }
    }

    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: isApprove ? 'KYC Approved Successfully' : 'KYC Rejected',
    });

    if (chatId && message?.message_id) {
      await api.editMessageText({
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: 'HTML',
        text: `${message.text}\n\n<b>STATUS:</b> ${isApprove ? '✅ APPROVED by @kanzedin' : '❌ REJECTED by @kanzedin'}`,
      });
    }
    return;
  }

  // SUPERADMIN ACTIONS: Merchant Approve / Reject
  if (data.startsWith('merchant_approve:') || data.startsWith('merchant_reject:')) {
    const isApprove = data.startsWith('merchant_approve:');
    const appId = data.split(':')[1];

    await db.update(merchantApplications).set({ status: isApprove ? 'APPROVED' : 'REJECTED' }).where(eq(merchantApplications.id, appId)).run();
    const app = await db.select().from(merchantApplications).where(eq(merchantApplications.id, appId)).get();

    if (app && app.userId && isApprove) {
      await db.update(users).set({ role: 'MERCHANT', kycStatus: 'VERIFIED' }).where(eq(users.id, app.userId)).run();
      const applicant = await db.select().from(users).where(eq(users.id, app.userId)).get();
      if (applicant && applicant.tgId) {
        try {
          await api.sendMessage({
            chat_id: applicant.tgId,
            parse_mode: 'HTML',
            text: `🎉 <b>Merchant Status Approved!</b>\nYou can now post Buy and Sell ads on Fetan P2P.`,
          });
        } catch {}
      }
    }

    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: isApprove ? 'Merchant Approved' : 'Merchant Rejected',
    });

    if (chatId && message?.message_id) {
      await api.editMessageText({
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: 'HTML',
        text: `${message.text}\n\n<b>STATUS:</b> ${isApprove ? '✅ APPROVED by @kanzedin' : '❌ REJECTED by @kanzedin'}`,
      });
    }
    return;
  }

  // SUPERADMIN ACTIONS: Order Release / Cancel from inline button
  if (data.startsWith('order_release:') || data.startsWith('order_cancel:')) {
    const isRelease = data.startsWith('order_release:');
    const orderId = data.split(':')[1];

    // Forward resolution to web engine
    try {
      await fetch(WEB_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ADMIN_ORDER_ACTION',
          decision: isRelease ? 'RELEASE' : 'CANCEL',
          orderId,
          note: `Resolved via @fetanp2probot by @kanzedin`,
        }),
      });
    } catch {}

    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: isRelease ? `Order #${orderId} Released to Buyer` : `Order #${orderId} Cancelled & Refunded`,
    });

    if (chatId && message?.message_id) {
      await api.editMessageText({
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: 'HTML',
        text: `${message.text}\n\n<b>RESOLUTION:</b> ${isRelease ? '🔓 Released to Buyer' : '↩️ Cancelled & Refunded to Seller'} by @kanzedin`,
      });
    }
    return;
  }

  // Resolve support ticket
  if (data.startsWith('ticket_resolve:')) {
    const ticketId = data.split(':')[1];
    await db.update(supportTickets).set({ status: 'RESOLVED', adminReply: 'Resolved by @kanzedin' }).where(eq(supportTickets.id, ticketId)).run();

    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: 'Support Ticket Marked Resolved',
    });

    if (chatId && message?.message_id) {
      await api.editMessageText({
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: 'HTML',
        text: `${message.text}\n\n<b>STATUS:</b> ✅ RESOLVED by @kanzedin`,
      });
    }
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: queryId });
}

