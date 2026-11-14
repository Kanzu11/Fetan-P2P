import { api } from 'sdk';
import {
  ensureNeonTelegramUser,
  queryNeon,
  getNeonAdminChatIds,
  createNeonEscrowOrder,
  adminManageUserNeon,
  adminReviewWithdrawalNeon,
  makeId,
} from '../lib/neon.js';

const MINIAPP_URL = 'https://app9136159373.tgcloud.ai/';

export default async function (message, ctx) {
  const chatId = message.chat.id;
  const rawText = (message.text || '').trim();
  const fromUser = message.from || {};
  const tgUsername = (fromUser.username || '').replace(/^@/, '').toLowerCase();

  let user = await ensureNeonTelegramUser(fromUser);
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPERADMIN';
  const isVerified = user.kycStatus === 'VERIFIED' || isAdmin;

  // Handle deep-link /start commands
  if (rawText.startsWith('/start')) {
    const parts = rawText.split(' ');
    const param = parts[1] || '';

    // Linking website account to Telegram directly in shared Neon PostgreSQL
    if (param.startsWith('link_') || param.startsWith('FETAN-')) {
      const code = param.replace(/^link_/, '');
      const linked = await queryNeon(
        `UPDATE "User"
         SET "telegramChatId" = $1,
             "telegramHandle" = COALESCE($2, "telegramHandle"),
             "telegramNotifications" = true,
             "updatedAt" = NOW()
         WHERE "telegramLinkCode" = $3 OR "id" = $3
         RETURNING *`,
        [String(chatId), tgUsername ? `@${tgUsername}` : null, code]
      );
      if (linked.rows[0]) {
        user = await ensureNeonTelegramUser(fromUser);
      }

      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `✅ <b>Account Linked Successfully!</b>\n\nYour Fetan P2P web account and Telegram Bot now share live escrow updates. You can trade USDT right here via /trade or open the Mini App:`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Open Fetan Mini App', web_app: { url: MINIAPP_URL } }],
            [
              { text: '💱 Browse P2P Offers', callback_data: 'browse_offers' },
              { text: '📋 My Active Orders', callback_data: 'my_orders' },
            ],
            [{ text: '🔔 Toggle Notifications', callback_data: 'toggle_notify' }],
          ],
        },
      });
      return;
    }

    // Direct KYC deep-link — suppress prompt if already verified or admin
    if (param.startsWith('kyc_')) {
      if (isVerified) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `✅ <b>Already Verified!</b>\n\nYour identity is verified with full access to P2P trading. Use /trade or open the Mini App to trade USDT:`,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚀 Open Fetan Mini App', web_app: { url: MINIAPP_URL } }],
              [{ text: '💱 Browse P2P Offers', callback_data: 'browse_offers' }],
            ],
          },
        });
        return;
      }

      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `🪪 <b>Fetan P2P Identity Verification (KYC)</b>\n\nVerify your ID before buying or selling USDT.\n\nReply with:\n<code>/kyc &lt;Fayda or Passport Number&gt;</code>`,
        reply_markup: {
          inline_keyboard: [[{ text: '📱 Verify in Mini App', web_app: { url: MINIAPP_URL } }]],
        },
      });
      return;
    }

    // Admin & Verified Trader dual control menu
    if (isAdmin) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `🛡️ <b>Fetan P2P Admin & Trading Desk</b>\n\n` +
          `Welcome back! You have full access to both <b>trade P2P USDT</b> and manage live platform operations:\n` +
          `• Available: <code>${Number(user.usdtBalance || 0).toFixed(2)} USDT</code> • Locked: <code>${Number(user.usdtLocked || 0).toFixed(2)} USDT</code>`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Open Fetan App & Admin', web_app: { url: MINIAPP_URL } }],
            [
              { text: '💱 Browse P2P Offers', callback_data: 'browse_offers' },
              { text: '📋 My Active Orders', callback_data: 'my_orders' },
            ],
            [
              { text: '⚠️ Appeals & Orders', callback_data: 'admin_view_appeals' },
              { text: '📢 Manage Ads', callback_data: 'admin_view_offers' },
            ],
            [
              { text: '👥 Users & Ban', callback_data: 'admin_view_users' },
              { text: '🪪 Pending KYCs', callback_data: 'admin_view_kycs' },
            ],
            [
              { text: '🏪 Merchants', callback_data: 'admin_view_merchants' },
              { text: '📤 Withdrawals', callback_data: 'admin_view_withdrawals' },
            ],
            [
              { text: '🎫 Support Tickets', callback_data: 'admin_view_tickets' },
              { text: '📜 Audit Logs', callback_data: 'admin_view_audit' },
            ],
          ],
        },
      });
      return;
    }

    // Verified vs unverified trader menu — NO Submit KYC button once verified
    const traderKeyboard = [
      [{ text: '📱 Open Fetan P2P Mini App', web_app: { url: MINIAPP_URL } }],
      [
        { text: '💱 Browse P2P Offers', callback_data: 'browse_offers' },
        { text: '📋 My Active Orders', callback_data: 'my_orders' },
      ],
    ];

    if (!isVerified) {
      traderKeyboard.push([
        { text: '🪪 Submit KYC', callback_data: 'start_kyc' },
        { text: '💬 Support Desk', callback_data: 'open_support' },
      ]);
    } else {
      traderKeyboard.push([
        { text: '💬 Support Desk', callback_data: 'open_support' },
        { text: '🔔 Notifications', callback_data: 'toggle_notify' },
      ]);
    }

    await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text:
        `🏛️ <b>Welcome to Fetan P2P</b>\n\n` +
        `Buy & Sell USDT in Ethiopia safely with Telebirr, CBE, Abyssinia, Awash & Dashen.\n\n` +
        `• <b>ID Status:</b> ${isVerified ? '✅ Verified (Trading Enabled)' : '⚠️ Unverified (KYC Required)'}\n` +
        `• <b>Available:</b> <code>${Number(user.usdtBalance || 0).toFixed(2)} USDT</code>\n` +
        `• <b>Notifications:</b> ${user.telegramNotifications ? '🔔 Enabled' : '🔕 Disabled'}\n\n` +
        `Tap below to trade directly or launch the Mini App:`,
      reply_markup: { inline_keyboard: traderKeyboard },
    });
    return;
  }

  // /trade or /market command — live offers directly from shared Neon PostgreSQL
  if (rawText.startsWith('/trade') || rawText.startsWith('/market')) {
    const offRes = await queryNeon(
      `SELECT * FROM "P2POffer"
       WHERE "isActive" = true AND "totalAvailable" > 0
       ORDER BY "createdAt" DESC
       LIMIT 6`
    );
    const offers = offRes.rows;

    if (offers.length === 0) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `💱 <b>Fetan P2P Market</b>\n\nNo active offers at this moment. Open the Mini App to check or post an offer:`,
        reply_markup: {
          inline_keyboard: [[{ text: '🚀 Open Market Mini App', web_app: { url: MINIAPP_URL } }]],
        },
      });
      return;
    }

      const lines = offers.map((o, idx) => {
        const side = o.offerType === 'SELL' ? '🟢 BUY USDT' : '🔵 SELL USDT';
        return `${idx + 1}. <b>${side}</b> @ <code>${Number(o.pricePerUsdtEtb).toFixed(2)} ETB</code>\n   • Merchant: ${o.merchantName} • Avail: <code>${Number(o.totalAvailable).toFixed(2)} USDT</code>`;
      });
    const buttons = offers.map((o) => [
        {
          text: `${o.offerType === 'SELL' ? '🟢 Buy' : '🔵 Sell'} @ ${Number(o.pricePerUsdtEtb).toFixed(2)} ETB (${o.merchantName})`,
          callback_data: `trade_offer:${o.id}`,
        },
      ]);
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `💱 <b>Live P2P Market Offers</b>\n\n${lines.join('\n\n')}`,
        reply_markup: { inline_keyboard: buttons },
      });
      return;
    }

  // /buy <offerId> <usdtAmount>
  if (rawText.startsWith('/buy')) {
      if (user.isSuspended) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `🚫 <b>Account Suspended</b>\n${user.suspendReason || 'Trading access disabled by Fetan Compliance.'}`,
        });
        return;
      }
      if (!isVerified) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `⚠️ Complete identity verification before trading.`,
        });
        return;
      }
      const parts = rawText.split(/\s+/);
      const offerId = parts[1];
      const usdtAmount = Number(parts[2]);
      if (!offerId || !Number.isFinite(usdtAmount) || usdtAmount <= 0) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `Usage: <code>/buy &lt;offerId&gt; &lt;usdtAmount&gt;</code>\nUse /trade to browse offers first.`,
        });
        return;
      }
      try {
          const res = await createNeonEscrowOrder({ actor: user, offerId, usdtAmount });
          const o = res.order;
          const isBuyer = o.buyerId === user.id;

          await api.sendMessage({
            chat_id: chatId,
            parse_mode: 'HTML',
            text:
              `🔒 <b>Escrow Order #${o.id} Created</b>\n` +
              `• Amount: <code>${o.usdtAmount.toFixed(2)} USDT</code>\n` +
              `• Total ETB: <b>${o.etbAmount.toLocaleString()} ETB</b>\n` +
              `• Account: <code>${o.paymentDetails?.accountNumber || 'See Mini App'}</code> (${o.paymentDetails?.accountName || ''})`,
            reply_markup: {
              inline_keyboard: isBuyer
                ? [[
                  { text: '✅ Mark Paid', callback_data: `user_paid:${o.id}` },
                  { text: '❌ Cancel', callback_data: `user_cancel:${o.id}` },
                ]]
                : [[{ text: '📋 View My Orders', callback_data: 'my_orders' }]],
            },
          });

            const counterpartyChat = isBuyer ? res.sellerChatId : res.buyerChatId;
            if (counterpartyChat) {
              await api.sendMessage({
                chat_id: counterpartyChat,
                parse_mode: 'HTML',
              text: `🔔 <b>New P2P Order #${o.id}</b>\n• Counterparty: <b>${user.name}</b>\n• Amount: <b>${o.usdtAmount.toFixed(2)} USDT</b> (${o.etbAmount.toLocaleString()} ETB)`,
        }).catch(() => { });
      }

      const adminChatIds = await getNeonAdminChatIds();
      for (const admId of adminChatIds) {
        if (admId !== res.sellerChatId && admId !== res.buyerChatId) {
          await api.sendMessage({
            chat_id: admId,
            parse_mode: 'HTML',
            text: `🛡️ <b>[Admin Monitor] New Order #${o.id} (Bot)</b>\n• Buyer: <b>${o.buyerName}</b> → Seller: <b>${o.sellerName}</b>\n• Amount: <b>${o.usdtAmount.toFixed(2)} USDT</b> (${o.etbAmount.toLocaleString()} ETB)`,
          }).catch(() => { });
        }
      }
    } catch (err) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `❌ <b>Trade Error:</b> ${err instanceof Error ? err.message : 'Could not open order'}`,
      });
    }
    return;
  }

  // /orders command
  if (rawText.startsWith('/orders')) {
    const ordRes = await queryNeon(
      `SELECT * FROM "P2POrder"
       WHERE "buyerId" = $1 OR "sellerId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 5`,
      [user.id]
    );
    const myOrders = ordRes.rows;
    if (myOrders.length === 0) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `📋 <b>My Orders</b>\n\nNo active orders yet. Run /trade to browse offers.`,
      });
      return;
    }
    for (const o of myOrders) {
      const isBuyer = o.buyerId === user.id;
      const buttons = [];
      if (o.status === 'PENDING_PAYMENT' && isBuyer) {
        buttons.push([
          { text: '✅ Mark Paid', callback_data: `user_paid:${o.id}` },
          { text: '❌ Cancel', callback_data: `user_cancel:${o.id}` },
        ]);
      } else if (o.status === 'PAYMENT_SENT' && !isBuyer) {
        buttons.push([{ text: '🔓 Confirm & Release USDT', callback_data: `user_release:${o.id}` }]);
      }
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `🧾 <b>Order #${o.id}</b>\n• Side: <b>${isBuyer ? 'Buy' : 'Sell'}</b> • Status: <b>${o.status}</b>\n• Amount: <code>${Number(o.usdtAmount).toFixed(2)} USDT</code> (${Number(o.etbAmount).toLocaleString()} ETB)`,
        reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
      });
    }
    return;
  }

  // /wallet command
  if (rawText.startsWith('/wallet')) {
    await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text:
        `💰 <b>Fetan P2P Wallet</b>\n\n` +
        `• Account: <b>${user.name}</b>\n` +
        `• Available: <code>${Number(user.usdtBalance || 0).toFixed(2)} USDT</code>\n` +
        `• In Escrow: <code>${Number(user.usdtLocked || 0).toFixed(2)} USDT</code>\n` +
        `• Status: ${isVerified ? '✅ Verified' : `⚠️ ${user.kycStatus}`}`,
      reply_markup: {
        inline_keyboard: [[{ text: '📱 Open Mini App Wallet', web_app: { url: MINIAPP_URL } }]],
      },
    });
    return;
  }

  // /kyc <docNumber>
  if (rawText.startsWith('/kyc')) {
    if (isVerified) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `✅ <b>Already Verified!</b>\n\nYour account is verified. Use /trade or open the Mini App to trade USDT.`,
        reply_markup: {
          inline_keyboard: [[{ text: '💱 Browse P2P Offers', callback_data: 'browse_offers' }]],
        },
      });
      return;
    }

    const docNumber = rawText.replace('/kyc', '').trim();
    if (!docNumber) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `🪪 <b>Submit ID for Verification</b>\n\nPlease enter your Fayda or Passport number after /kyc:\n\n<code>/kyc FAYDA-1234-5678</code>`,
      });
      return;
    }

    const subId = makeId('kyc-tg');
    await queryNeon(
      `INSERT INTO "KycSubmission" (
         "id", "userId", "userEmail", "userName", "telegramHandle",
         "source", "kycDocType", "kycDocNumber", "status", "submittedAt"
       ) VALUES ($1, $2, $3, $4, $5, 'TELEGRAM_BOT', 'NATIONAL_ID', $6, 'PENDING'::"KycStatus", NOW())`,
      [subId, user.id, user.email, user.name, user.telegramHandle || null, docNumber]
    );
    await queryNeon(
      `UPDATE "User"
       SET "kycStatus" = 'PENDING'::"KycStatus",
           "kycDocType" = 'NATIONAL_ID',
           "kycDocNumber" = $2,
           "kycSubmittedAt" = NOW(),
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [user.id, docNumber]
    );

    const adminChatIds = await getNeonAdminChatIds();
    for (const admId of adminChatIds) {
      await api.sendMessage({
        chat_id: admId,
        parse_mode: 'HTML',
        text: `🪪 <b>NEW KYC SUBMISSION via Telegram</b>\n\n• User: <b>${user.name}</b> (${user.telegramHandle || user.email})\n• ID Number: <code>${docNumber}</code>\n• Type: NATIONAL_ID`,
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve KYC', callback_data: `kyc_approve:${subId}` },
            { text: '❌ Reject KYC', callback_data: `kyc_reject:${subId}` },
          ]],
        },
      }).catch(() => { });
    }

    await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `✅ <b>KYC Submitted!</b>\n\nYour ID number <code>${docNumber}</code> was sent to <b>Fetan Compliance Desk</b>. You will be notified here as soon as it is reviewed.`,
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
        text: `💬 <b>Fetan Private Support Desk</b>\n\nType your message after /support:\n<code>/support Order #ord-... issue details</code>`,
      });
      return;
    }

    const ticketId = makeId('sup-tg');
    await queryNeon(
      `INSERT INTO "SupportTicket" (
         "id", "userId", "userName", "userEmail", "telegramHandle",
         "category", "subject", "message", "status", "source", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, 'ORDER_COMPLAINT', $6, $7, 'OPEN', 'TELEGRAM_BOT', NOW())`,
      [
        ticketId,
        user.id,
        user.name,
        user.email,
        user.telegramHandle || null,
        `Telegram Support from ${user.name}`,
        textContent,
      ]
    );

    const adminChatIds = await getNeonAdminChatIds();
    for (const admId of adminChatIds) {
      await api.sendMessage({
        chat_id: admId,
        parse_mode: 'HTML',
        text: `🚨 <b>NEW ORDER COMPLAINT / SUPPORT TICKET</b>\n\n• From: <b>${user.name}</b> (${user.telegramHandle || user.email})\n• Message:\n"${textContent}"`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Mark Resolved', callback_data: `ticket_resolve:${ticketId}` }],
            [{ text: '🛡️ Open Admin Mini App', web_app: { url: MINIAPP_URL } }],
          ],
        },
      }).catch(() => { });
    }

    await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `✅ <b>Message Sent to Fetan Support Desk</b>\n\nOur operations team received your message privately and will respond promptly.`,
    });
    return;
  }

  // /admin command — reads live counts from shared Neon PostgreSQL
  if (isAdmin && rawText === '/admin') {
    const [kycRes, appealRes, merchRes, wdrRes, tktRes, offRes] = await Promise.all([
      queryNeon(`SELECT COUNT(*)::int AS c FROM "KycSubmission" WHERE "status" = 'PENDING'::"KycStatus"`),
      queryNeon(`SELECT COUNT(*)::int AS c FROM "P2POrder" WHERE "status" = 'DISPUTED'::"OrderStatus"`),
      queryNeon(`SELECT COUNT(*)::int AS c FROM "MerchantApplication" WHERE "status" = 'PENDING'`),
      queryNeon(`SELECT COUNT(*)::int AS c FROM "WalletTransaction" WHERE "type" = 'WITHDRAW' AND "status" = 'PENDING'::"WalletTxStatus"`),
      queryNeon(`SELECT COUNT(*)::int AS c FROM "SupportTicket" WHERE "status" = 'OPEN'`),
      queryNeon(`SELECT COUNT(*)::int AS c FROM "P2POffer"`),
    ]);
    const kycCount = Number(kycRes.rows[0]?.c || 0);
    const appealCount = Number(appealRes.rows[0]?.c || 0);
    const merchCount = Number(merchRes.rows[0]?.c || 0);
    const wdrCount = Number(wdrRes.rows[0]?.c || 0);
    const tktCount = Number(tktRes.rows[0]?.c || 0);
    const offCount = Number(offRes.rows[0]?.c || 0);

    await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text:
        `🛡️ <b>Fetan Admin & Trading Console</b>\n\n` +
        `• Open Appeals: <b>${appealCount}</b> • Ads: <b>${offCount}</b>\n` +
        `• Pending KYCs: <b>${kycCount}</b> • Merchants: <b>${merchCount}</b>\n` +
        `• Withdrawals: <b>${wdrCount}</b> • Support Tickets: <b>${tktCount}</b>\n\n` +
        `<b>Quick Commands:</b>\n` +
        `<code>/ban &lt;email_or_id&gt; [reason]</code>\n` +
        `<code>/unban &lt;email_or_id&gt;</code>\n` +
        `<code>/approve_wdr &lt;txId&gt; &lt;txHash&gt;</code>\n` +
        `<code>/reject_wdr &lt;txId&gt; [reason]</code>`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Open Admin & Trading App', web_app: { url: MINIAPP_URL } }],
          [
            { text: '💱 Browse P2P Offers', callback_data: 'browse_offers' },
            { text: '📋 My Orders', callback_data: 'my_orders' },
          ],
          [
            { text: `⚠️ Appeals (${appealCount})`, callback_data: 'admin_view_appeals' },
            { text: `📢 Ads (${offCount})`, callback_data: 'admin_view_offers' },
          ],
          [
            { text: '👥 Users & Ban', callback_data: 'admin_view_users' },
            { text: `🪪 KYCs (${kycCount})`, callback_data: 'admin_view_kycs' },
          ],
          [
            { text: `🏪 Merchants (${merchCount})`, callback_data: 'admin_view_merchants' },
            { text: `📤 Withdrawals (${wdrCount})`, callback_data: 'admin_view_withdrawals' },
          ],
          [
            { text: `🎫 Support (${tktCount})`, callback_data: 'admin_view_tickets' },
            { text: '📜 Audit Logs', callback_data: 'admin_view_audit' },
          ],
        ],
      },
    });
    return;
  }

  // /ban or /unban <email_or_userId> [reason]
  if (isAdmin && (rawText.startsWith('/ban ') || rawText.startsWith('/unban '))) {
    const isUnban = rawText.startsWith('/unban ');
    const parts = rawText.split(/\s+/);
    const identifier = (parts[1] || '').trim();
    const reason = parts.slice(2).join(' ').trim();
    if (!identifier) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `Usage: <code>/${isUnban ? 'unban' : 'ban'} &lt;email_or_userId&gt; ${isUnban ? '' : '[reason]'}</code>`,
      });
      return;
    }

    try {
      const lookup = await queryNeon(
        `SELECT * FROM "User" WHERE "id" = $1 OR LOWER("email") = LOWER($1) OR LOWER("telegramHandle") = LOWER($2) LIMIT 1`,
        [identifier, `@${identifier.replace(/^@/, '')}`]
      );
      const target = lookup.rows[0];
      if (!target) {
        await api.sendMessage({ chat_id: chatId, text: `❌ User "${identifier}" not found.` });
        return;
      }

      const wantSuspended = !isUnban;
      if (Boolean(target.isSuspended) === wantSuspended) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `ℹ️ <b>${target.name}</b> is already ${wantSuspended ? 'SUSPENDED' : 'ACTIVE'}.`,
        });
        return;
      }

      const updated = await adminManageUserNeon({
        actor: user,
        targetUserId: target.id,
        subAction: 'TOGGLE_SUSPEND',
        reason: reason || 'Suspended via Telegram Admin',
      });

      if (updated?.telegramChatId) {
        await api.sendMessage({
          chat_id: updated.telegramChatId,
          parse_mode: 'HTML',
          text: updated.isSuspended
            ? `🚫 <b>Account Suspended</b>\nYour Fetan P2P account was suspended.\nReason: ${updated.suspendReason || 'Compliance review'}`
            : `✅ <b>Account Reactivated</b>\nYour Fetan P2P trading access has been restored.`,
        }).catch(() => {});
      }

      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: updated.isSuspended
          ? `🚫 <b>User Suspended:</b> ${updated.name} (${updated.email})\nAll active ads paused.`
          : `✅ <b>User Unbanned:</b> ${updated.name} (${updated.email})`,
      });
    } catch (err) {
      await api.sendMessage({
        chat_id: chatId,
        text: `❌ ${err instanceof Error ? err.message : 'Unable to update user'}`,
      });
    }
    return;
  }

  // /approve_wdr <txId> <txHash> & /reject_wdr <txId> [reason]
  if (isAdmin && (rawText.startsWith('/approve_wdr ') || rawText.startsWith('/reject_wdr '))) {
    const approved = rawText.startsWith('/approve_wdr ');
    const parts = rawText.split(/\s+/);
    const txId = (parts[1] || '').trim();
    const arg2 = parts[2] ? parts[2].trim() : '';
    const rest = parts.slice(2).join(' ').trim();

    if (!txId || (approved && !arg2)) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: approved
          ? `Usage: <code>/approve_wdr &lt;txId&gt; &lt;txHash&gt;</code>`
          : `Usage: <code>/reject_wdr &lt;txId&gt; [reason]</code>`,
      });
      return;
    }

    try {
      const wRes = await adminReviewWithdrawalNeon({
        actor: user,
        txId,
        approved,
        txHash: approved ? arg2 : undefined,
        note: !approved ? rest : undefined,
      });

      if (wRes?.targetChatId) {
        await api.sendMessage({
          chat_id: wRes.targetChatId,
          parse_mode: 'HTML',
          text: approved
            ? `✅ <b>USDT Withdrawal Dispatched</b>\n• Amount: <code>${Number(wRes.tx.amount || 0).toFixed(2)} USDT</code>\n• TxHash: <code>${wRes.tx.txHash || ''}</code>`
            : `↩️ <b>Withdrawal Rejected & Refunded</b>\n• Amount: <code>${Number(wRes.tx.amount || 0).toFixed(2)} USDT</code> returned to your wallet.\n• Reason: ${wRes.tx.note || 'Compliance review'}`,
        }).catch(() => {});
      }

      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: approved
          ? `✅ Withdrawal <code>${txId}</code> marked COMPLETED.`
          : `↩️ Withdrawal <code>${txId}</code> REJECTED and refunded to user.`,
      });
    } catch (err) {
      await api.sendMessage({
        chat_id: chatId,
        text: `❌ ${err instanceof Error ? err.message : 'Withdrawal update failed'}`,
      });
    }
    return;
  }

  // Default fallback — hide /kyc prompt once verified
  const helpLines = [
    '• <code>/trade</code> — Browse live USDT offers & trade',
    '• <code>/orders</code> — View & settle active orders',
    '• <code>/wallet</code> — Check available & locked USDT',
  ];
  if (!isVerified) {
    helpLines.push('• <code>/kyc &lt;id_number&gt;</code> — Submit ID verification');
  }
  helpLines.push('• <code>/support &lt;message&gt;</code> — Contact Fetan Support Desk');
  if (isAdmin) {
    helpLines.push('• <code>/admin</code> — Full Admin Console (Ads, Users, Withdrawals)');
    helpLines.push('• <code>/ban &lt;email_or_id&gt; [reason]</code> / <code>/unban</code>');
    helpLines.push('• <code>/approve_wdr &lt;txId&gt; &lt;txHash&gt;</code> / <code>/reject_wdr</code>');
  }
  helpLines.push('• <code>/start</code> — Main menu');

  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `🏛️ <b>Fetan P2P Assistant</b>\n\nCommands:\n${helpLines.join('\n')}`,
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Open Fetan P2P Mini App', web_app: { url: MINIAPP_URL } }],
        [{ text: '💱 Browse P2P Offers', callback_data: 'browse_offers' }],
      ],
    },
  });
}
