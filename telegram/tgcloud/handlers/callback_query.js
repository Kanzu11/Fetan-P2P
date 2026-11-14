import { api } from 'sdk';
import {
  ensureNeonTelegramUser,
  queryNeon,
  getNeonAdminChatIds,
  createNeonEscrowOrder,
  performNeonOrderAction,
  reviewNeonKyc,
  reviewNeonMerchant,
  adminManageUserNeon,
  adminManageOfferNeon,
  adminReviewWithdrawalNeon,
} from '../lib/neon.js';

const MINIAPP_URL = 'https://app9136159373.tgcloud.ai/';

export default async function (callbackQuery, ctx) {
  const queryId = callbackQuery.id;
  const data = callbackQuery.data || '';
  const message = callbackQuery.message;
  const chatId = message?.chat?.id;
  const fromUser = callbackQuery.from || {};

  const user = await ensureNeonTelegramUser(fromUser);
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPERADMIN';
  const isVerified = user.kycStatus === 'VERIFIED' || isAdmin;

  // Toggle order notifications for user/merchant
  if (data === 'toggle_notify') {
    const nextVal = !Boolean(user.telegramNotifications);
    await queryNeon(
      `UPDATE "User" SET "telegramNotifications" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
      [nextVal, user.id]
    );

    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: nextVal ? 'Order notifications enabled!' : 'Order notifications paused.',
    });

    if (chatId) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `🔔 <b>Order Notifications:</b> <b>${nextVal ? 'ENABLED' : 'PAUSED'}</b>\n\n${nextVal ? 'You will receive immediate alerts for new orders, payments, and releases.' : 'You will not receive bot messages for new orders.'}`,
      });
    }
    return;
  }

  // Browse live market offers directly from shared Neon PostgreSQL
  if (data === 'browse_offers') {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const offRes = await queryNeon(
      `SELECT * FROM "P2POffer"
       WHERE "isActive" = true AND "totalAvailable" > 0
       ORDER BY "createdAt" DESC
       LIMIT 6`
    );
    const offers = offRes.rows;

    if (chatId) {
      if (offers.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `💱 <b>Fetan P2P Market</b>\n\nNo active offers right now. Open the Liquid Glass Mini App to check or post offers:`,
          reply_markup: {
            inline_keyboard: [[{ text: '🚀 Open P2P Market App', web_app: { url: MINIAPP_URL } }]],
          },
        });
      } else {
        const lines = offers.map((o, idx) => {
          const side = o.offerType === 'SELL' ? '🟢 BUY' : '🔵 SELL';
          return `${idx + 1}. <b>${side}</b> @ <code>${Number(o.pricePerUsdtEtb).toFixed(2)} ETB</code> • Avail: <code>${Number(o.totalAvailable).toFixed(2)} USDT</code> (${o.merchantName})`;
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
          text: `💱 <b>Live P2P Market Offers</b>\n\n${lines.join('\n')}`,
          reply_markup: { inline_keyboard: buttons },
        });
      }
    }
    return;
  }

  if (data.startsWith('trade_offer:')) {
    const offerId = data.split(':')[1];
    await api.answerCallbackQuery({ callback_query_id: queryId });
    if (user.isSuspended) {
      if (chatId) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `🚫 Your account is currently suspended.`,
        });
      }
      return;
    }
    if (!isVerified) {
      if (chatId) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `⚠️ Complete identity verification before opening P2P trades.`,
          reply_markup: {
            inline_keyboard: [[{ text: '📱 Open Mini App', web_app: { url: MINIAPP_URL } }]],
          },
        });
      }
      return;
    }

    const offRes = await queryNeon(`SELECT * FROM "P2POffer" WHERE "id" = $1 LIMIT 1`, [offerId]);
    const o = offRes.rows[0];
    if (!o || !o.isActive || Number(o.totalAvailable) <= 0) {
      if (chatId) {
        await api.sendMessage({ chat_id: chatId, text: '❌ This offer is no longer active.' });
      }
      return;
    }

    const price = Number(o.pricePerUsdtEtb || 158);
    const minUsdt = Math.max(5, Math.ceil(Number(o.minLimitEtb || 500) / price));
    const maxUsdt = Math.min(Number(o.totalAvailable), Math.floor(Number(o.maxLimitEtb || 500000) / price));
    const presets = [25, 50, 100, 250].filter((amt) => amt >= minUsdt && amt <= maxUsdt);
    if (presets.length === 0 && maxUsdt >= minUsdt) {
      presets.push(Number(Math.min(maxUsdt, minUsdt).toFixed(2)));
    }
    const quickButtons = presets.map((amt) => ({
      text: `${amt} USDT`,
      callback_data: `quick_buy:${o.id}:${amt}`,
    }));

    if (chatId) {
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `💱 <b>${o.offerType === 'SELL' ? 'Buy' : 'Sell'} USDT with ${o.merchantName}</b>\n` +
          `• Rate: <code>${price.toFixed(2)} ETB / USDT</code>\n` +
          `• Available: <code>${Number(o.totalAvailable).toFixed(2)} USDT</code>\n` +
          `• Limits: <code>${minUsdt}–${maxUsdt} USDT</code>\n\n` +
          `Select a preset amount or run:\n<code>/buy ${o.id} 50</code>`,
        reply_markup: {
          inline_keyboard: [
            ...(quickButtons.length > 0 ? [quickButtons] : []),
            [{ text: '🚀 Custom Amount in Mini App', web_app: { url: MINIAPP_URL } }],
          ],
        },
      });
    }
    return;
  }

  if (data.startsWith('quick_buy:')) {
    const [, offerId, amtStr] = data.split(':');
    const amount = Number(amtStr);
    try {
      const res = await createNeonEscrowOrder({ actor: user, offerId, usdtAmount: amount });
      const o = res.order;
      await api.answerCallbackQuery({ callback_query_id: queryId, text: `Order #${o.id} opened!` });
      if (chatId) {
        const isBuyer = o.buyerId === user.id;
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `🔒 <b>Escrow Order #${o.id} Opened</b>\n\n` +
            `• Amount: <code>${o.usdtAmount.toFixed(2)} USDT</code>\n` +
            `• Total ETB: <b>${o.etbAmount.toLocaleString()} ETB</b>\n` +
            `• Account: <code>${o.paymentDetails?.accountNumber || 'See Mini App'}</code>`,
          reply_markup: {
            inline_keyboard: isBuyer
              ? [[
                  { text: '✅ Mark Paid', callback_data: `user_paid:${o.id}` },
                  { text: '❌ Cancel', callback_data: `user_cancel:${o.id}` },
                ]]
              : [[{ text: '📋 View My Orders', callback_data: 'my_orders' }]],
          },
        });
      }
      const counterpartyChat = o.buyerId === user.id ? res.sellerChatId : res.buyerChatId;
      if (counterpartyChat) {
        await api.sendMessage({
          chat_id: counterpartyChat,
          parse_mode: 'HTML',
          text: `🔔 <b>New P2P Order #${o.id}</b>\n• Counterparty: <b>${user.name}</b>\n• Amount: <b>${o.usdtAmount.toFixed(2)} USDT</b> (${o.etbAmount.toLocaleString()} ETB)`,
        }).catch(() => {});
      }
      const adminChatIds = await getNeonAdminChatIds();
      for (const admId of adminChatIds) {
        if (admId !== res.sellerChatId && admId !== res.buyerChatId) {
          await api.sendMessage({
            chat_id: admId,
            parse_mode: 'HTML',
            text: `🛡️ <b>[Admin Monitor] New Order #${o.id} (Bot)</b>\n• Buyer: <b>${o.buyerName}</b> → Seller: <b>${o.sellerName}</b>\n• Amount: <b>${o.usdtAmount.toFixed(2)} USDT</b> (${o.etbAmount.toLocaleString()} ETB)`,
          }).catch(() => {});
        }
      }
    } catch (err) {
      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: err instanceof Error ? err.message : 'Trade unavailable',
        show_alert: true,
      });
    }
    return;
  }

  if (data === 'my_orders') {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const ordRes = await queryNeon(
      `SELECT * FROM "P2POrder"
       WHERE "buyerId" = $1 OR "sellerId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 5`,
      [user.id]
    );
    const myOrders = ordRes.rows;
    if (chatId) {
      if (myOrders.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `📋 <b>My Orders</b>\n\nNo active orders found. Use /trade or open the Mini App.`,
          reply_markup: {
            inline_keyboard: [[{ text: '🚀 Open Mini App', web_app: { url: MINIAPP_URL } }]],
          },
        });
      } else {
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
      }
    }
    return;
  }

  if (data.startsWith('user_paid:') || data.startsWith('user_release:') || data.startsWith('user_cancel:')) {
    const [prefix, orderId] = data.split(':');
    const action = prefix === 'user_paid' ? 'MARK_PAID' : prefix === 'user_release' ? 'RELEASE' : 'CANCEL';
    try {
      const updated = await performNeonOrderAction({ actor: user, orderId, action });
      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: `Order #${orderId} updated (${updated.status})`,
      });
      if (chatId) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `✅ Order <code>#${orderId}</code> is now <b>${updated.status}</b>.`,
        });
      }
    } catch (err) {
      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: err instanceof Error ? err.message : 'Unable to update order',
        show_alert: true,
      });
    }
    return;
  }

  // Conditional KYC prompt
  if (data === 'start_kyc') {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    if (chatId) {
      if (isVerified) {
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `✅ <b>Already Verified!</b>\n\nYour identity is already verified. Use /trade or open the Mini App to trade USDT.`,
        });
        return;
      }
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
        text: `💬 <b>Fetan Private Support Desk</b>\n\nTo file a support request or order complaint privately, send:\n<code>/support &lt;Your order ID & details&gt;</code>`,
      });
    }
    return;
  }

  // Admin queues in bot — read live shared Neon PostgreSQL queues!
  if (data === 'admin_view_kycs' && isAdmin) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const kycRes = await queryNeon(
      `SELECT * FROM "KycSubmission" WHERE "status" = 'PENDING'::"KycStatus" ORDER BY "submittedAt" DESC LIMIT 8`
    );
    const pending = kycRes.rows;
    if (chatId) {
      if (pending.length === 0) {
        await api.sendMessage({ chat_id: chatId, text: '✅ No pending KYC submissions.' });
      } else {
        for (const k of pending) {
          await api.sendMessage({
            chat_id: chatId,
            parse_mode: 'HTML',
            text:
              `🪪 <b>KYC #${k.id}</b>\n` +
              `• User: <b>${k.userName}</b> (${k.userEmail})\n` +
              `• Type: <b>${k.kycDocType}</b>\n` +
              `• ID Number: <code>${k.kycDocNumber}</code>`,
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve KYC', callback_data: `kyc_approve:${k.id}` },
                { text: '❌ Reject KYC', callback_data: `kyc_reject:${k.id}` },
              ]],
            },
          });
        }
      }
    }
    return;
  }

  if (data === 'admin_view_merchants' && isAdmin) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const merchRes = await queryNeon(
      `SELECT * FROM "MerchantApplication" WHERE "status" = 'PENDING' ORDER BY "submittedAt" DESC LIMIT 8`
    );
    const pending = merchRes.rows;
    if (chatId) {
      if (pending.length === 0) {
        await api.sendMessage({ chat_id: chatId, text: '✅ No pending merchant applications.' });
      } else {
        for (const m of pending) {
          await api.sendMessage({
            chat_id: chatId,
            parse_mode: 'HTML',
            text: `🏪 <b>Merchant #${m.id}</b>\n• User: <b>${m.userName}</b> (${m.userEmail})\n• Balance: <code>${Number(m.usdtBalance || 0).toFixed(2)} USDT</code>`,
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve Merchant', callback_data: `merchant_approve:${m.id}` },
                { text: '❌ Reject', callback_data: `merchant_reject:${m.id}` },
              ]],
            },
          });
        }
      }
    }
    return;
  }

  if (data === 'admin_view_appeals' && isAdmin) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const dispRes = await queryNeon(
      `SELECT * FROM "P2POrder" WHERE "status" = 'DISPUTED'::"OrderStatus" ORDER BY "updatedAt" DESC LIMIT 8`
    );
    const disputes = dispRes.rows;
    if (chatId) {
      if (disputes.length === 0) {
        await api.sendMessage({ chat_id: chatId, text: '✅ No open trade appeals.' });
      } else {
        for (const d of disputes) {
          await api.sendMessage({
            chat_id: chatId,
            parse_mode: 'HTML',
            text:
              `⚠️ <b>Appeal Order #${d.id}</b>\n` +
              `• Buyer: <b>${d.buyerName}</b> • Seller: <b>${d.sellerName}</b>\n` +
              `• Amount: <code>${Number(d.usdtAmount).toFixed(2)} USDT</code>\n` +
              `• Reason: ${d.disputeReason || 'Disputed'}`,
            reply_markup: {
              inline_keyboard: [[
                { text: '🔓 Release to Buyer', callback_data: `order_release:${d.id}` },
                { text: '↩️ Refund Seller', callback_data: `order_cancel:${d.id}` },
              ]],
            },
          });
        }
      }
    }
    return;
  }

  // ADMIN ACTIONS: KYC Approve / Reject in shared Neon PostgreSQL
  if ((data.startsWith('kyc_approve:') || data.startsWith('kyc_reject:')) && isAdmin) {
    const isApprove = data.startsWith('kyc_approve:');
    const kycId = data.split(':')[1];
    const reviewed = await reviewNeonKyc({
      kycId,
      approved: isApprove,
      reviewerLabel: `${user.name} (Telegram Compliance Desk)`,
    });

    if (reviewed?.targetChatId) {
      await api.sendMessage({
        chat_id: reviewed.targetChatId,
        parse_mode: 'HTML',
        text: isApprove
          ? `🎉 <b>Identity Verification Approved!</b>\nYour Fetan P2P account is verified. Use /trade or open the Mini App to buy & sell USDT.`
          : `❌ <b>Identity Verification Rejected</b>\nPlease submit clear ID details using <code>/kyc</code>.`,
      }).catch(() => {});
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
        text: `${message.text}\n\n<b>STATUS:</b> ${isApprove ? '✅ APPROVED by Fetan Compliance Desk' : '❌ REJECTED by Fetan Compliance Desk'}`,
      }).catch(() => {});
    }
    return;
  }

  // ADMIN ACTIONS: Merchant Approve / Reject in shared Neon PostgreSQL
  if ((data.startsWith('merchant_approve:') || data.startsWith('merchant_reject:')) && isAdmin) {
    const isApprove = data.startsWith('merchant_approve:');
    const appId = data.split(':')[1];
    const reviewed = await reviewNeonMerchant({
      applicationId: appId,
      approved: isApprove,
      reviewerLabel: `${user.name} (Fetan Admin)`,
    });

    if (reviewed?.targetChatId) {
      await api.sendMessage({
        chat_id: reviewed.targetChatId,
        parse_mode: 'HTML',
        text: isApprove
          ? `🎉 <b>Merchant Status Approved!</b>\nYou can now post Buy and Sell ads on Fetan P2P.`
          : `❌ <b>Merchant Application Update</b>\nYour application was not approved at this time.`,
      }).catch(() => {});
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
        text: `${message.text}\n\n<b>STATUS:</b> ${isApprove ? '✅ APPROVED by Fetan Admin' : '❌ REJECTED by Fetan Admin'}`,
      }).catch(() => {});
    }
    return;
  }

  // ADMIN ACTIONS: Order Release / Cancel in shared Neon PostgreSQL
  if ((data.startsWith('order_release:') || data.startsWith('order_cancel:')) && isAdmin) {
    const isRelease = data.startsWith('order_release:');
    const orderId = data.split(':')[1];
    try {
      await performNeonOrderAction({
        actor: user,
        orderId,
        action: isRelease ? 'RELEASE' : 'CANCEL',
        reason: 'Resolved via Fetan Admin Desk',
      });
      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: isRelease ? `Order #${orderId} Released to Buyer` : `Order #${orderId} Cancelled & Refunded`,
      });
      if (chatId && message?.message_id) {
        await api.editMessageText({
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: 'HTML',
          text: `${message.text}\n\n<b>RESOLUTION:</b> ${isRelease ? '🔓 Released to Buyer' : '↩️ Cancelled & Refunded to Seller'} by Fetan Admin`,
        }).catch(() => {});
      }
    } catch (err) {
      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: err instanceof Error ? err.message : 'Unable to resolve order',
        show_alert: true,
      });
    }
    return;
  }

  // Resolve support ticket in shared Neon PostgreSQL
  if (data.startsWith('ticket_resolve:') && isAdmin) {
    const ticketId = data.split(':')[1];
    await queryNeon(
      `UPDATE "SupportTicket"
       SET "status" = 'RESOLVED', "adminReply" = 'Resolved by Fetan Support Desk', "resolvedBy" = $2, "updatedAt" = NOW()
       WHERE "id" = $1`,
      [ticketId, user.id]
    );

    await api.answerCallbackQuery({
      callback_query_id: queryId,
      text: 'Support Ticket Marked Resolved',
    });

    if (chatId && message?.message_id) {
      await api.editMessageText({
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: 'HTML',
        text: `${message.text}\n\n<b>STATUS:</b> ✅ RESOLVED by Fetan Support Desk`,
      }).catch(() => {});
    }
    return;
  }

  // ADMIN VIEWS & ACTIONS: Manage Ads (Offers)
  if (data === 'admin_view_offers' && isAdmin) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const offRes = await queryNeon(`SELECT * FROM "P2POffer" ORDER BY "createdAt" DESC LIMIT 8`);
    const list = offRes.rows;
    if (chatId) {
      if (list.length === 0) {
        await api.sendMessage({ chat_id: chatId, text: '✅ No marketplace ads found.' });
      } else {
        for (const o of list) {
          await api.sendMessage({
            chat_id: chatId,
            parse_mode: 'HTML',
            text:
              `📢 <b>Ad #${o.id}</b> (${o.isActive ? '🟢 ACTIVE' : '⏸ PAUSED'})\n` +
              `• Merchant: <b>${o.merchantName}</b> (${o.offerType})\n` +
              `• Rate: <code>${Number(o.pricePerUsdtEtb).toFixed(2)} ETB</code> • Avail: <code>${Number(o.totalAvailable).toFixed(2)} USDT</code>`,
            reply_markup: {
              inline_keyboard: [[
                { text: o.isActive ? '⏸ Pause Ad' : '▶️ Activate Ad', callback_data: `offer_toggle:${o.id}` },
                { text: '🗑 Delete Ad', callback_data: `offer_delete:${o.id}` },
              ]],
            },
          });
        }
      }
    }
    return;
  }

  if ((data.startsWith('offer_toggle:') || data.startsWith('offer_delete:')) && isAdmin) {
    const isDelete = data.startsWith('offer_delete:');
    const offerId = data.split(':')[1];
    try {
      const res = await adminManageOfferNeon({
        actor: user,
        offerId,
        subAction: isDelete ? 'DELETE' : 'TOGGLE_ACTIVE',
      });
      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: isDelete ? 'Ad removed' : `Ad is now ${res.isActive ? 'ACTIVE' : 'PAUSED'}`,
      });
      if (chatId && message?.message_id) {
        await api.editMessageText({
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: 'HTML',
          text: isDelete
            ? `${message.text}\n\n<b>STATUS:</b> 🗑 ${res.archived ? 'ARCHIVED' : 'DELETED'} by Admin`
            : `${message.text}\n\n<b>STATUS:</b> ${res.isActive ? '🟢 ACTIVATED' : '⏸ PAUSED'} by Admin`,
        }).catch(() => {});
      }
    } catch (err) {
      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: err instanceof Error ? err.message : 'Offer update failed',
        show_alert: true,
      });
    }
    return;
  }

  // ADMIN VIEWS & ACTIONS: Users & Ban / Suspend / KYC / Merchant / Admin
  if (data === 'admin_view_users' && isAdmin) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const uRes = await queryNeon(
      `SELECT "id", "name", "email", "role", "isSuspended", "kycStatus", "merchantStatus", "usdtBalance"
       FROM "User" ORDER BY "createdAt" DESC LIMIT 8`
    );
    const users = uRes.rows;
    const canAdminToggle = user.role === 'SUPERADMIN';
    if (chatId) {
      for (const u of users) {
        if (u.role === 'SUPERADMIN' || u.id === user.id) continue;
        const buttons = [
          [
            { text: u.isSuspended ? '✅ Unban' : '🚫 Ban / Suspend', callback_data: `user_suspend:${u.id}` },
            { text: u.kycStatus === 'VERIFIED' ? '❌ Reset ID' : '🪪 Verify ID', callback_data: `user_kyc:${u.id}` },
          ],
          [
            { text: u.role === 'MERCHANT' ? 'Revoke Merchant' : '🏪 Make Merchant', callback_data: `user_merch:${u.id}` },
            ...(canAdminToggle ? [{ text: u.role === 'ADMIN' ? 'Remove Admin' : '🛡️ Make Admin', callback_data: `user_admin:${u.id}` }] : []),
          ],
        ];
        await api.sendMessage({
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `👤 <b>${u.name}</b> ${u.isSuspended ? '🚫 [SUSPENDED]' : ''}\n` +
            `• ${u.email}\n` +
            `• Role: <b>${u.role}</b> • KYC: <b>${u.kycStatus}</b> • Bal: <code>${Number(u.usdtBalance || 0).toFixed(2)} USDT</code>`,
          reply_markup: { inline_keyboard: buttons },
        });
      }
    }
    return;
  }

  if (
    (data.startsWith('user_suspend:') ||
      data.startsWith('user_kyc:') ||
      data.startsWith('user_merch:') ||
      data.startsWith('user_admin:')) &&
    isAdmin
  ) {
    const [prefix, targetUserId] = data.split(':');
    try {
      const targetRow = (await queryNeon(`SELECT * FROM "User" WHERE "id" = $1 LIMIT 1`, [targetUserId])).rows[0];
      if (!targetRow) throw new Error('User not found');

      const subAction =
        prefix === 'user_suspend'
          ? 'TOGGLE_SUSPEND'
          : prefix === 'user_merch'
          ? 'TOGGLE_MERCHANT'
          : prefix === 'user_admin'
          ? 'TOGGLE_ADMIN'
          : targetRow.kycStatus === 'VERIFIED'
          ? 'REJECT_KYC'
          : 'VERIFY_KYC';

      const updated = await adminManageUserNeon({
        actor: user,
        targetUserId,
        subAction,
        reason: 'Action via Telegram Admin Panel',
      });

      if (prefix === 'user_suspend' && updated?.telegramChatId) {
        await api.sendMessage({
          chat_id: updated.telegramChatId,
          parse_mode: 'HTML',
          text: updated.isSuspended
            ? `🚫 <b>Account Suspended</b>\nYour Fetan P2P account was suspended by Compliance.`
            : `✅ <b>Account Reactivated</b>\nYour Fetan P2P trading access is restored.`,
        }).catch(() => {});
      }

      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: `Updated ${updated.name} (${updated.isSuspended ? 'SUSPENDED' : updated.role + ' / ' + updated.kycStatus})`,
      });
      if (chatId && message?.message_id) {
        await api.editMessageText({
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: 'HTML',
          text: `${message.text}\n\n<b>UPDATED:</b> ${updated.isSuspended ? '🚫 SUSPENDED' : `✅ ${updated.role} • ${updated.kycStatus}`}`,
        }).catch(() => {});
      }
    } catch (err) {
      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: err instanceof Error ? err.message : 'Action failed',
        show_alert: true,
      });
    }
    return;
  }

  // ADMIN VIEWS & ACTIONS: Withdrawals
  if (data === 'admin_view_withdrawals' && isAdmin) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const wRes = await queryNeon(
      `SELECT w.*, u."name" AS "userName", u."email" AS "userEmail"
       FROM "WalletTransaction" w
       LEFT JOIN "User" u ON u."id" = w."userId"
       WHERE w."type" = 'WITHDRAW' AND w."status" = 'PENDING'::"WalletTxStatus"
       ORDER BY w."createdAt" DESC LIMIT 8`
    );
    const list = wRes.rows;
    if (chatId) {
      if (list.length === 0) {
        await api.sendMessage({ chat_id: chatId, text: '✅ No pending USDT withdrawals.' });
      } else {
        for (const w of list) {
          await api.sendMessage({
            chat_id: chatId,
            parse_mode: 'HTML',
            text:
              `📤 <b>Pending Withdrawal #${w.id}</b>\n` +
              `• User: <b>${w.userName || w.userId}</b> (${w.userEmail || ''})\n` +
              `• Amount: <code>${Number(w.amount || 0).toFixed(2)} USDT</code> (${w.network})\n` +
              `• To: <code>${w.address || 'N/A'}</code>\n\n` +
              `To approve with payout TxHash:\n<code>/approve_wdr ${w.id} &lt;txHash&gt;</code>`,
            reply_markup: {
              inline_keyboard: [[
                { text: '📋 Approve in Mini App', web_app: { url: MINIAPP_URL } },
                { text: '❌ Reject & Refund', callback_data: `wdr_reject:${w.id}` },
              ]],
            },
          });
        }
      }
    }
    return;
  }

  if (data.startsWith('wdr_reject:') && isAdmin) {
    const txId = data.split(':')[1];
    try {
      const wRes = await adminReviewWithdrawalNeon({
        actor: user,
        txId,
        approved: false,
        note: 'Rejected & refunded via Telegram Admin',
      });
      if (wRes?.targetChatId) {
        await api.sendMessage({
          chat_id: wRes.targetChatId,
          parse_mode: 'HTML',
          text: `↩️ <b>Withdrawal Rejected & Refunded</b>\n• Amount: <code>${Number(wRes.tx.amount || 0).toFixed(2)} USDT</code> returned to your wallet.`,
        }).catch(() => {});
      }
      await api.answerCallbackQuery({ callback_query_id: queryId, text: 'Rejected & Refunded USDT' });
      if (chatId && message?.message_id) {
        await api.editMessageText({
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: 'HTML',
          text: `${message.text}\n\n<b>STATUS:</b> ↩️ REJECTED & REFUNDED by Admin`,
        }).catch(() => {});
      }
    } catch (err) {
      await api.answerCallbackQuery({
        callback_query_id: queryId,
        text: err instanceof Error ? err.message : 'Unable to reject withdrawal',
        show_alert: true,
      });
    }
    return;
  }

  // ADMIN VIEWS: Support Tickets & Audit Logs
  if (data === 'admin_view_tickets' && isAdmin) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const tRes = await queryNeon(
      `SELECT * FROM "SupportTicket" WHERE "status" = 'OPEN' ORDER BY "createdAt" DESC LIMIT 8`
    );
    const list = tRes.rows;
    if (chatId) {
      if (list.length === 0) {
        await api.sendMessage({ chat_id: chatId, text: '✅ No open support tickets.' });
      } else {
        for (const t of list) {
          await api.sendMessage({
            chat_id: chatId,
            parse_mode: 'HTML',
            text:
              `🎫 <b>Ticket #${t.id}</b>\n` +
              `• From: <b>${t.userName}</b> (${t.userEmail})\n` +
              `• Subject: <b>${t.subject}</b>\n` +
              `• Message: "${t.message}"`,
            reply_markup: {
              inline_keyboard: [[{ text: '✅ Mark Resolved', callback_data: `ticket_resolve:${t.id}` }]],
            },
          });
        }
      }
    }
    return;
  }

  if (data === 'admin_view_audit' && isAdmin) {
    await api.answerCallbackQuery({ callback_query_id: queryId });
    const aRes = await queryNeon(`SELECT * FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 10`);
    const logs = aRes.rows;
    if (chatId) {
      const lines = logs.map((l, idx) =>
        `${idx + 1}. <code>${l.action}</code> • ${l.actorRole || 'SYS'} • ${l.targetType || ''}:${l.targetId || ''}`
      );
      await api.sendMessage({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `📜 <b>Latest Security Audit Events</b>\n\n${lines.join('\n') || 'No audit entries yet.'}`,
      });
    }
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: queryId });
}
