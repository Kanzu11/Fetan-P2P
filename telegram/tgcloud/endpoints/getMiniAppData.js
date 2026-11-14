import { api, EndpointError } from 'sdk';
import {
  ensureNeonTelegramUser,
  queryNeon,
  getNeonAdminChatIds,
  normalizeOfferRow,
  normalizeOrderRow,
  createNeonEscrowOrder,
  performNeonOrderAction,
  reviewNeonKyc,
  reviewNeonMerchant,
  adminManageUserNeon,
  adminManageOfferNeon,
  adminReviewWithdrawalNeon,
  makeId,
} from '../lib/neon.js';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user || input?.user || {};
  let user = await ensureNeonTelegramUser(tgUser);
  let isAdmin = user.role === 'ADMIN' || user.role === 'SUPERADMIN';
  let isSuperadmin = user.role === 'SUPERADMIN';
  let isVerified = user.kycStatus === 'VERIFIED' || isAdmin;

  let actionResult = null;

  try {
    // Handle User Actions directly against shared Neon PostgreSQL
    if (input?.userAction) {
      const ua = input.userAction;
      if (user.isSuspended) {
        throw new Error(
          user.suspendReason
            ? `Account suspended: ${user.suspendReason}`
            : 'Your account has been suspended by Fetan Compliance.'
        );
      }
      if (ua === 'CREATE_ORDER') {
        const res = await createNeonEscrowOrder({
          actor: user,
          offerId: input.offerId,
          usdtAmount: input.usdtAmount,
          paymentMethod: input.paymentMethod,
        });
        actionResult = { order: res.order };

        const sellerMsg =
          `🔔 <b>New P2P Order #${res.order.id} (Mini App)</b>\n` +
          `• Buyer: <b>${res.order.buyerName}</b>\n` +
          `• Amount: <b>${res.order.usdtAmount.toFixed(2)} USDT</b> (${res.order.etbAmount.toLocaleString()} ETB)\n` +
          `• Method: <b>${res.order.paymentMethod}</b>`;
        if (res.sellerChatId) {
          await api.sendMessage({ chat_id: res.sellerChatId, parse_mode: 'HTML', text: sellerMsg }).catch(() => {});
        }
        const adminChatIds = await getNeonAdminChatIds();
        for (const admId of adminChatIds) {
          if (admId !== res.sellerChatId && admId !== res.buyerChatId) {
            await api.sendMessage({
              chat_id: admId,
              parse_mode: 'HTML',
              text: `🛡️ <b>[Admin Monitor] New Order #${res.order.id}</b>\n• Buyer: <b>${res.order.buyerName}</b> → Seller: <b>${res.order.sellerName}</b>\n• Amount: <b>${res.order.usdtAmount.toFixed(2)} USDT</b> (${res.order.etbAmount.toLocaleString()} ETB)`,
            }).catch(() => {});
          }
        }
      } else if (ua === 'MARK_PAID' || ua === 'RELEASE' || ua === 'CANCEL' || ua === 'DISPUTE') {
        const updatedOrder = await performNeonOrderAction({
          actor: user,
          orderId: input.orderId,
          action: ua,
          reason: input.reason || input.note,
        });
        actionResult = { order: updatedOrder };

        if (ua === 'DISPUTE') {
          const adminChatIds = await getNeonAdminChatIds();
          for (const admId of adminChatIds) {
            await api.sendMessage({
              chat_id: admId,
              parse_mode: 'HTML',
              text: `🚨 <b>ORDER APPEAL #${updatedOrder.id}</b>\n• Amount: <b>${updatedOrder.usdtAmount.toFixed(2)} USDT</b>\n• Reason: "${updatedOrder.disputeReason || 'Disputed via Mini App'}"`,
              reply_markup: {
                inline_keyboard: [[
                  { text: '🔓 Release to Buyer', callback_data: `order_release:${updatedOrder.id}` },
                  { text: '↩️ Refund Seller', callback_data: `order_cancel:${updatedOrder.id}` },
                ]],
              },
            }).catch(() => {});
          }
        }
      } else if (ua === 'CREATE_OFFER') {
        if (user.role !== 'MERCHANT' && !isAdmin) {
          throw new Error('Only approved Merchants or Admins can post P2P offers.');
        }
        const offerId = makeId('ofr');
        const offerType = input.offerType === 'BUY' ? 'BUY' : 'SELL';
        const price = Number(input.pricePerUsdtEtb);
        const total = Number(input.totalAvailable);
        const minEtb = Number(input.minLimitEtb);
        const maxEtb = Number(input.maxLimitEtb);
        const methods = Array.isArray(input.paymentMethods) && input.paymentMethods.length > 0
          ? input.paymentMethods
          : ['TELEBIRR'];
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(total) || total <= 0) {
          throw new Error('Enter valid positive offer price and USDT liquidity.');
        }

        const inserted = await queryNeon(
          `INSERT INTO "P2POffer" (
             "id", "merchantId", "merchantName", "completedTrades", "completionRate",
             "merchantRating", "avgReleaseTimeMins", "offerType",
             "pricePerUsdtEtb", "minLimitEtb", "maxLimitEtb", "totalAvailable",
             "paymentMethods", "terms", "isActive", "isOnline", "isVerifiedMerchant", "updatedAt"
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, 2, $7,
             $8, $9, $10, $11,
             $12::text[], $13, true, true, true, NOW()
           ) RETURNING *`,
          [
            offerId,
            user.id,
            user.nickname || user.name,
            user.completedTrades || 0,
            user.completionRate || 100,
            user.rating || 5,
            offerType,
            price,
            minEtb,
            maxEtb,
            total,
            methods,
            input.terms || 'Fast settlement via Ethiopian mobile money / bank',
          ]
        );
        actionResult = { offer: normalizeOfferRow(inserted.rows[0]) };
      } else if (ua === 'APPLY_MERCHANT') {
        const appId = makeId('mch');
        await queryNeon(
          `INSERT INTO "MerchantApplication" (
             "id", "userId", "userEmail", "userName", "telegramHandle",
             "kycDocType", "kycDocNumber", "usdtBalance", "terms", "status", "submittedAt"
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', NOW())`,
          [
            appId,
            user.id,
            user.email,
            user.name,
            user.telegramHandle || '',
            user.kycDocType || 'NATIONAL_ID',
            user.kycDocNumber || 'VERIFIED',
            Number(user.usdtBalance || 0),
            input.reason || 'Applied via Fetan Mini App',
          ]
        );
        await queryNeon(
          `UPDATE "User" SET "merchantStatus" = 'PENDING'::"MerchantStatus", "updatedAt" = NOW() WHERE "id" = $1`,
          [user.id]
        );
        const adminChatIds = await getNeonAdminChatIds();
        for (const admId of adminChatIds) {
          await api.sendMessage({
            chat_id: admId,
            parse_mode: 'HTML',
            text: `🏪 <b>NEW MERCHANT APPLICATION (Mini App)</b>\n• User: <b>${user.name}</b> (${user.email})\n• Wallet: <b>${Number(user.usdtBalance || 0).toFixed(2)} USDT</b>`,
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve Merchant', callback_data: `merchant_approve:${appId}` },
                { text: '❌ Reject', callback_data: `merchant_reject:${appId}` },
              ]],
            },
          }).catch(() => {});
        }
        actionResult = { applicationId: appId };
      }
    }

    // Handle Admin Actions directly against shared Neon PostgreSQL
    if (isAdmin && input?.adminAction) {
      const aa = input.adminAction;
      const reviewer = `${user.name} (Telegram Admin)`;

      if (aa === 'APPROVE_KYC' || aa === 'REJECT_KYC') {
        const approved = aa === 'APPROVE_KYC';
        const res = await reviewNeonKyc({ kycId: input.kycId, approved, reviewerLabel: reviewer });
        if (res?.targetChatId) {
          await api.sendMessage({
            chat_id: res.targetChatId,
            parse_mode: 'HTML',
            text: approved
              ? `🎉 <b>Identity Verified!</b>\nYour Fetan P2P account is approved. Use /trade or the Mini App to buy & sell USDT.`
              : `❌ <b>KYC Rejected</b>\nPlease resubmit clear ID details via the Fetan P2P App.`,
          }).catch(() => {});
        }
        actionResult = { kycReviewed: input.kycId };
      } else if (aa === 'APPROVE_MERCHANT' || aa === 'REJECT_MERCHANT') {
        const approved = aa === 'APPROVE_MERCHANT';
        const res = await reviewNeonMerchant({
          applicationId: input.applicationId,
          approved,
          reviewerLabel: reviewer,
        });
        if (res?.targetChatId) {
          await api.sendMessage({
            chat_id: res.targetChatId,
            parse_mode: 'HTML',
            text: approved
              ? `🎉 <b>Merchant Status Approved!</b>\nYou can now post Buy & Sell USDT ads on Fetan P2P.`
              : `❌ <b>Merchant Application Rejected</b>`,
          }).catch(() => {});
        }
        actionResult = { merchantReviewed: input.applicationId };
      } else if (aa === 'RESOLVE_RELEASE' || aa === 'RESOLVE_CANCEL') {
        const order = await performNeonOrderAction({
          actor: user,
          orderId: input.orderId,
          action: aa === 'RESOLVE_RELEASE' ? 'RELEASE' : 'CANCEL',
          reason: input.note || 'Resolved via Fetan Mini App Admin',
        });
        actionResult = { order };
      } else if (aa === 'RESOLVE_TICKET') {
        await queryNeon(
          `UPDATE "SupportTicket"
           SET "status" = 'RESOLVED',
               "adminReply" = $2,
               "resolvedBy" = $3,
               "updatedAt" = NOW()
           WHERE "id" = $1`,
          [input.ticketId, input.adminReply || 'Resolved by Fetan Support Desk', reviewer]
        );
        actionResult = { ticketResolved: input.ticketId };
      } else if (aa === 'TOGGLE_USER_SUSPEND' || aa === 'TOGGLE_USER_MERCHANT' || aa === 'SET_USER_KYC' || aa === 'TOGGLE_USER_ADMIN') {
        const subAction =
          aa === 'SET_USER_KYC'
            ? input.newKycStatus === 'VERIFIED'
              ? 'VERIFY_KYC'
              : 'REJECT_KYC'
            : aa === 'TOGGLE_USER_SUSPEND'
            ? 'TOGGLE_SUSPEND'
            : aa === 'TOGGLE_USER_MERCHANT'
            ? 'TOGGLE_MERCHANT'
            : 'TOGGLE_ADMIN';
        const updatedUser = await adminManageUserNeon({
          actor: user,
          targetUserId: input.targetUserId,
          subAction,
          reason: input.reason || input.suspendReason,
        });
        if (updatedUser?.telegramChatId && aa === 'TOGGLE_USER_SUSPEND') {
          await api.sendMessage({
            chat_id: updatedUser.telegramChatId,
            parse_mode: 'HTML',
            text: updatedUser.isSuspended
              ? `🚫 <b>Account Suspended</b>\nYour Fetan P2P account was suspended.\nReason: ${updatedUser.suspendReason || 'Suspended by Compliance Admin'}`
              : `✅ <b>Account Reactivated</b>\nYour Fetan P2P trading access has been restored.`,
          }).catch(() => {});
        }
        actionResult = { updatedUser };
      } else if (aa === 'TOGGLE_OFFER' || aa === 'DELETE_OFFER') {
        const offerRes = await adminManageOfferNeon({
          actor: user,
          offerId: input.offerId,
          subAction: aa === 'TOGGLE_OFFER' ? 'TOGGLE_ACTIVE' : 'DELETE',
        });
        actionResult = { offerRes };
      } else if (aa === 'APPROVE_WITHDRAWAL' || aa === 'REJECT_WITHDRAWAL') {
        const approved = aa === 'APPROVE_WITHDRAWAL';
        const wRes = await adminReviewWithdrawalNeon({
          actor: user,
          txId: input.txId,
          approved,
          txHash: input.txHash,
          note: input.note,
        });
        if (wRes?.targetChatId) {
          await api.sendMessage({
            chat_id: wRes.targetChatId,
            parse_mode: 'HTML',
            text: approved
              ? `✅ <b>USDT Withdrawal Dispatched</b>\n• Amount: <code>${Number(wRes.tx.amount || 0).toFixed(2)} USDT</code> (${wRes.tx.network})\n• TxHash: <code>${wRes.tx.txHash || ''}</code>`
              : `↩️ <b>Withdrawal Rejected & Refunded</b>\n• Amount: <code>${Number(wRes.tx.amount || 0).toFixed(2)} USDT</code> returned to your wallet.\n• Note: ${wRes.tx.note || 'Review failed'}`,
          }).catch(() => {});
        }
        actionResult = { withdrawal: wRes.tx };
      }
    }
  } catch (err) {
    throw new EndpointError(err instanceof Error ? err.message : 'Action failed', {
      code: 'NEON_ACTION_ERROR',
    });
  }

  // Re-fetch user and live shared Neon PostgreSQL state
  user = await ensureNeonTelegramUser(tgUser);
  isAdmin = user.role === 'ADMIN' || user.role === 'SUPERADMIN';
  isSuperadmin = user.role === 'SUPERADMIN';
  isVerified = user.kycStatus === 'VERIFIED' || isAdmin;

  const [offersRes, userOrdersRes] = await Promise.all([
    queryNeon(
      `SELECT * FROM "P2POffer"
       WHERE "isActive" = true AND "totalAvailable" > 0
       ORDER BY "createdAt" DESC
       LIMIT 30`
    ),
    user.id !== 'usr-tg-guest'
      ? queryNeon(
          `SELECT * FROM "P2POrder"
           WHERE "buyerId" = $1 OR "sellerId" = $1
           ORDER BY "createdAt" DESC
           LIMIT 30`,
          [user.id]
        )
      : Promise.resolve({ rows: [] }),
  ]);

  const offers = offersRes.rows.map(normalizeOfferRow);
  const userOrders = userOrdersRes.rows.map(normalizeOrderRow);

  const sellPrices = offers.filter((o) => o.offerType === 'SELL').map((o) => o.pricePerUsdtEtb);
  const buyPrices = offers.filter((o) => o.offerType === 'BUY').map((o) => o.pricePerUsdtEtb);
  const usdtBuyPrice = sellPrices.length > 0 ? Math.min(...sellPrices) : 158.35;
  const usdtSellPrice = buyPrices.length > 0 ? Math.max(...buyPrices) : 157.4;

  let adminStats = null;
  let adminData = null;

  if (isAdmin) {
    const [kycRes, merchRes, allOrdRes, allUsersRes, ticketRes, allOffersRes, wdrRes, auditRes] = await Promise.all([
      queryNeon(`SELECT * FROM "KycSubmission" ORDER BY "submittedAt" DESC LIMIT 50`),
      queryNeon(`SELECT * FROM "MerchantApplication" ORDER BY "submittedAt" DESC LIMIT 50`),
      queryNeon(`SELECT * FROM "P2POrder" ORDER BY "createdAt" DESC LIMIT 60`),
      queryNeon(
        `SELECT "id", "email", "name", "nickname", "telegramHandle", "role", "isSuspended", "suspendReason", "kycStatus", "merchantStatus", "usdtBalance", "usdtLocked", "createdAt"
         FROM "User" ORDER BY "createdAt" DESC LIMIT 60`
      ),
      queryNeon(`SELECT * FROM "SupportTicket" ORDER BY "createdAt" DESC LIMIT 50`),
      queryNeon(`SELECT * FROM "P2POffer" ORDER BY "createdAt" DESC LIMIT 60`),
      queryNeon(
        `SELECT w.*, u."name" AS "userName", u."email" AS "userEmail"
         FROM "WalletTransaction" w
         LEFT JOIN "User" u ON u."id" = w."userId"
         WHERE w."type" = 'WITHDRAW'
         ORDER BY w."createdAt" DESC
         LIMIT 40`
      ),
      queryNeon(`SELECT * FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 40`),
    ]);

    const kycs = kycRes.rows;
    const merchants = merchRes.rows.map((m) => ({
      ...m,
      usdtBalance: Number(m.usdtBalance || 0),
    }));
    const orders = allOrdRes.rows.map(normalizeOrderRow);
    const usersList = allUsersRes.rows.map((u) => ({
      ...u,
      isSuspended: Boolean(u.isSuspended),
      suspendReason: u.suspendReason || null,
      usdtBalance: Number(u.usdtBalance || 0),
      usdtLocked: Number(u.usdtLocked || 0),
    }));
    const tickets = ticketRes.rows;
    const allOffers = allOffersRes.rows.map(normalizeOfferRow);
    const withdrawals = wdrRes.rows.map((w) => ({
      ...w,
      amount: Number(w.amount || 0),
    }));
    const auditLogs = auditRes.rows;

    adminStats = {
      pendingKycs: kycs.filter((k) => k.status === 'PENDING').length,
      openDisputes: orders.filter((o) => o.status === 'DISPUTED').length,
      openTickets: tickets.filter((t) => t.status === 'OPEN').length,
      pendingMerchants: merchants.filter((m) => m.status === 'PENDING').length,
      pendingWithdrawals: withdrawals.filter((w) => w.status === 'PENDING').length,
      totalOffers: allOffers.length,
    };
    adminData = {
      kycs,
      merchants,
      orders,
      users: usersList,
      tickets,
      offers: allOffers,
      withdrawals,
      auditLogs,
    };
  }

  return {
    ok: true,
    actionResult,
    user,
    isAdmin,
    isSuperadmin,
    isVerified,
    offers,
    orders: userOrders,
    adminStats,
    adminData,
    marketStats: {
      usdtBuyPrice,
      usdtSellPrice,
      methods: ['Telebirr', 'CBE', 'Abyssinia', 'Awash', 'Dashen'],
    },
  };
}
