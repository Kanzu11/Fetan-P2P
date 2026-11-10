import { api, fetch } from 'sdk';
import { db, eq } from 'sdk/db';
import { users, orders, kycSubmissions, merchantApplications, supportTickets } from '../schema.js';

const SUPERADMIN_USERNAME = 'kanzedin';
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'support@fetan.et';
const MINIAPP_URL = 'https://app9136159373.tgcloud.ai/';
const WEB_API_URL = 'http://localhost:3000/api/telegram/sync';

export default async function (message, ctx) {
  const chatId = message.chat.id;
  const rawText = (message.text || '').trim();
  const fromUser = message.from || {};
  const tgUsername = (fromUser.username || '').replace(/^@/, '').toLowerCase();
  const tgName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || fromUser.username || 'Trader';

  const isSuperadmin = tgUsername === SUPERADMIN_USERNAME;

  // Ensure user exists in Telegram DB
  let user = await db.select().from(users).where(eq(users.tgId, fromUser.id)).get();
  if (!user) {
    const role = isSuperadmin ? 'SUPERADMIN' : 'USER';
    const kycStatus = isSuperadmin ? 'VERIFIED' : 'UNVERIFIED';
    const email = isSuperadmin ? SUPERADMIN_EMAIL : `${tgUsername || fromUser.id}@telegram.fetan.et`;

    user = {
      id: `usr-tg-${fromUser.id}`,
      tgId: fromUser.id,
      username: tgUsername ? `@${tgUsername}` : null,
      name: tgName,
      email,
      role,
      kycStatus,
      notifications: true,
      usdtBalance: isSuperadmin ? 5000.0 : 0.0,
      usdtLocked: 0.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.insert(users).values(user).run();
  } else if (isSuperadmin && user.role !== 'SUPERADMIN') {
    await db.update(users).set({ role: 'SUPERADMIN', kycStatus: 'VERIFIED' }).where(eq(users.id, user.id)).run();
    user.role = 'SUPERADMIN';
    user.kycStatus = 'VERIFIED';
  }

  // Handle deep-link /start commands
  if (rawText.startsWith('/start')) {
    const parts = rawText.split(' ');
    const param = parts[1] || '';

    // Linking website account to bot
    if (param.startsWith('link_') || param.startsWith('FETAN-')) {
      const code = param.replace(/^link_/, '');
      await db.update(users).set({ linkCode: code, notifications: true }).where(eq(users.id, user.id)).run();

      // Notify web backend to link accounts in shared database
      try {
        await fetch(WEB_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'LINK_TELEGRAM',
            code,
            chatId: String(chatId),
            username: tgUsername ? `@${tgUsername}` : undefined,
          }),
        });
      } catch {
        // web server may be offline, local link recorded
      }

      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `✅ <b>Account Linked Successfully!</b>\n\nYour Fetan P2P account is now connected to <b>@fetanp2probot</b>.\nYou will receive instant notifications whenever an order is placed, marked paid, or released.`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 Open Fetan Mini App', web_app: { url: MINIAPP_URL } }],
            [{ text: '🔔 Toggle Notifications', callback_data: 'toggle_notify' }],
          ],
        },
      });
      return;
    }

    // Direct KYC initiation
    if (param.startsWith('kyc_')) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `🪪 <b>Fetan P2P Identity Verification (KYC)</b>\n\nAll users must verify their ID before buying or selling USDT.\n\nPlease reply with:\n<code>/kyc &lt;Fayda or Passport Number&gt;</code>\n\nExample:\n<code>/kyc FAYDA-8821-9920</code>`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 Verify in Mini App', web_app: { url: MINIAPP_URL } }],
          ],
        },
      });
      return;
    }

    // Default /start
    if (isSuperadmin) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `👑 <b>Superadmin Control Desk (@${SUPERADMIN_USERNAME})</b>\n\nWelcome back, Kanzedin! You have full access to manage:\n• Order Complaints & Appeals\n• Identity Verifications (KYC)\n• Merchant Applications\n• User Support Tickets`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛡️ Open Superadmin Mini App', web_app: { url: MINIAPP_URL } }],
            [
              { text: '⚠️ View Open Appeals', callback_data: 'admin_view_appeals' },
              { text: '🪪 View Pending KYCs', callback_data: 'admin_view_kycs' },
            ],
            [{ text: '🏪 Pending Merchants', callback_data: 'admin_view_merchants' }],
          ],
        },
      });
      return;
    }

    await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `👋 <b>Welcome to Fetan P2P (@fetanp2probot)</b>\n\nBuy & Sell USDT in Ethiopia safely with Ethiopian Birr (Telebirr, CBE, Abyssinia, Awash).\n\n• <b>ID Status:</b> ${user.kycStatus === 'VERIFIED' ? '✅ Verified' : '⚠️ Unverified (KYC Required)'}\n• <b>Notifications:</b> ${user.notifications ? '🔔 Enabled' : '🔕 Disabled'}\n\nTap below to open the Mini App or connect your account:`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Open Fetan P2P Mini App', web_app: { url: MINIAPP_URL } }],
          [
            { text: '🪪 Submit KYC', callback_data: 'start_kyc' },
            { text: '💬 Support / Complaint', callback_data: 'open_support' },
          ],
          [{ text: '🔔 Notifications Setting', callback_data: 'toggle_notify' }],
        ],
      },
    });
    return;
  }

  // /kyc <docNumber>
  if (rawText.startsWith('/kyc')) {
    const docNumber = rawText.replace('/kyc', '').trim();
    if (!docNumber) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `🪪 <b>Submit ID for Verification</b>\n\nPlease enter your Fayda or Passport number after /kyc:\n\n<code>/kyc FAYDA-1234-5678</code>`,
      });
      return;
    }

    const subId = `kyc-tg-${Date.now()}`;
    await db.insert(kycSubmissions).values({
      id: subId,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      docType: 'NATIONAL_ID',
      docNumber,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
    }).run();

    await db.update(users).set({
      kycStatus: 'PENDING',
      kycDocType: 'NATIONAL_ID',
      kycDocNumber: docNumber,
    }).where(eq(users.id, user.id)).run();

    // Notify Superadmin on Telegram
    try {
      const superUser = await db.select().from(users).where(eq(users.role, 'SUPERADMIN')).get();
      if (superUser && superUser.tgId) {
        await api.sendMessage({
          chat_id: superUser.tgId,
          parse_mode: 'HTML',
          text: `🪪 <b>NEW KYC SUBMISSION via Telegram</b>\n\n• User: <b>${user.name}</b> (${user.username || user.email})\n• ID Number: <code>${docNumber}</code>\n• Type: NATIONAL_ID`,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve KYC', callback_data: `kyc_approve:${subId}` },
                { text: '❌ Reject KYC', callback_data: `kyc_reject:${subId}` },
              ],
            ],
          },
        });
      }
    } catch {}

    await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `✅ <b>KYC Submitted!</b>\n\nYour ID number <code>${docNumber}</code> was sent to Superadmin <b>@${SUPERADMIN_USERNAME}</b>. You will be notified here as soon as it is reviewed.`,
    });
    return;
  }

  // /support or /complaint <message>
  if (rawText.startsWith('/support') || rawText.startsWith('/complaint')) {
    const textContent = rawText.replace(/^\/(support|complaint)/, '').trim();
    if (!textContent) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `💬 <b>Need Help or Have an Order Complaint?</b>\n\nType your message after /support:\n<code>/support Order #20261109000101 I paid but seller hasn't released</code>`,
      });
      return;
    }

    const ticketId = `sup-tg-${Date.now().toString(36)}`;
    await db.insert(supportTickets).values({
      id: ticketId,
      userId: user.id,
      userName: user.name,
      category: 'ORDER_COMPLAINT',
      subject: `Telegram Support from ${user.name}`,
      message: textContent,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    }).run();

    // Alert Superadmin
    try {
      const superUser = await db.select().from(users).where(eq(users.role, 'SUPERADMIN')).get();
      if (superUser && superUser.tgId) {
        await api.sendMessage({
          chat_id: superUser.tgId,
          parse_mode: 'HTML',
          text: `🚨 <b>NEW ORDER COMPLAINT / SUPPORT TICKET</b>\n\n• From: <b>${user.name}</b> (${user.username || user.id})\n• Message:\n"${textContent}"`,
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Mark Resolved', callback_data: `ticket_resolve:${ticketId}` }],
              [{ text: '🛡️ Open Superadmin Mini App', web_app: { url: MINIAPP_URL } }],
            ],
          },
        });
      }
    } catch {}

    await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `✅ <b>Message Sent to Superadmin @${SUPERADMIN_USERNAME}</b>\n\nOur team has received your complaint and will respond promptly.`,
    });
    return;
  }

  // /admin commands for Superadmin
  if (isSuperadmin && rawText === '/admin') {
    const pendingKycs = await db.select().from(kycSubmissions).where(eq(kycSubmissions.status, 'PENDING')).all();
    const openAppeals = await db.select().from(orders).where(eq(orders.status, 'DISPUTED')).all();

    await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `👑 <b>Superadmin Control Panel</b>\n\n• Pending KYCs: <b>${pendingKycs.length}</b>\n• Open Appeals: <b>${openAppeals.length}</b>\n\nSelect an action:`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Open Superadmin Mini App', web_app: { url: MINIAPP_URL } }],
          [
            { text: `🪪 KYCs (${pendingKycs.length})`, callback_data: 'admin_view_kycs' },
            { text: `⚠️ Appeals (${openAppeals.length})`, callback_data: 'admin_view_appeals' },
          ],
        ],
      },
    });
    return;
  }

  // Default Fallback
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `🤖 <b>Fetan P2P Assistant</b>\n\nUse the buttons below or commands:\n• <code>/kyc &lt;id_number&gt;</code> - Submit ID verification\n• <code>/support &lt;message&gt;</code> - Order complaint or help\n• <code>/start</code> - Main menu`,
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Open Fetan P2P Mini App', web_app: { url: MINIAPP_URL } }],
      ],
    },
  });
}
