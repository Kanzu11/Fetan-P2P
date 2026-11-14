import fs from 'node:fs';
import path from 'node:path';
import { Context, Markup, Telegraf } from 'telegraf';
import { db } from './database/store';
import { prisma } from './database/prisma';
import { validateTxHash } from './security/sanitize';
import { wsGateway } from './websocket-gateway';
import { emailService } from './email-service';
import {
  MerchantApplication,
  KycSubmission,
  P2POrder,
  SupportTicket,
  PaymentMethod,
  WalletTransaction,
  PAYMENT_METHODS_META,
  User,
  displayName,
  isAdminRole,
} from '../client/types';

export interface TelegramLog {
  id: string;
  timestamp: string;
  type: 'MERCHANT_REQUEST' | 'KYC_REQUEST' | 'DISPUTE_ALERT' | 'ORDER_ALERT' | 'SUPPORT_TICKET';
  recipient: string;
  text: string;
  buttons: { text: string; callbackData: string }[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RESOLVED' | 'DELIVERED';
}

class TelegramBotManager {
  private bot: Telegraf | null = null;
  private recentLogs: TelegramLog[] = [];

  constructor() {
    const token = this.getBotToken();
    if (token) {
      this.initBot(token);
    }
  }

  getBotUsername(): string {
    return process.env.TELEGRAM_BOT_USERNAME || 'fetanp2probot';
  }

  getMiniAppUrl(): string {
    return process.env.TELEGRAM_MINIAPP_URL || '';
  }

  private getBotToken(): string {
    return process.env.TELEGRAM_BOT_TOKEN || '';
  }

  private getTgCloudToken(): string {
    return process.env.TGCLOUD_TOKEN || '';
  }

  private async isAuthorizedAdminTelegramActor(
    tgId?: number,
    username?: string
  ): Promise<{ authorized: boolean; label: string }> {
    const cleanUser = (username || '').replace(/^@/, '').toLowerCase();
    const superTg = (process.env.ADMIN_TELEGRAM_USERNAME || '').replace(/^@/, '').toLowerCase();

    if (superTg && cleanUser && cleanUser === superTg) {
      return { authorized: true, label: 'Fetan Compliance Admin' };
    }

    if (tgId) {
      const user = await db.getUserByTelegram(String(tgId));
      if (user && isAdminRole(user.role)) {
        return { authorized: true, label: 'Fetan Compliance Admin' };
      }
    }

    return { authorized: false, label: '' };
  }

  private async resolveActorUser(from?: {
    id?: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  }): Promise<{ user: User | null; isAdmin: boolean; isVerified: boolean }> {
    if (!from?.id) {
      return { user: null, isAdmin: false, isVerified: false };
    }
    const adminCheck = await this.isAuthorizedAdminTelegramActor(from.id, from.username);
    const fullName =
      [from.first_name, from.last_name].filter(Boolean).join(' ') ||
      from.username ||
      `Trader ${from.id}`;

    const user = await db.createOrGetTelegramUser({
      tgId: String(from.id),
      username: from.username,
      name: fullName,
    });

    const isAdmin = isAdminRole(user.role) || adminCheck.authorized;
    const isVerified = user.kycStatus === 'VERIFIED' || isAdmin;
    return { user, isAdmin, isVerified };
  }

  private buildStartKeyboard(isVerified: boolean, isAdmin: boolean) {
    const miniAppUrl = this.getMiniAppUrl();
    const rows: ReturnType<typeof Markup.button.callback | typeof Markup.button.webApp>[][] = [];

    if (miniAppUrl) {
      rows.push([
        Markup.button.webApp(
          isAdmin ? '🚀 Open Fetan App & Admin' : '📱 Open Fetan P2P App',
          miniAppUrl
        ),
      ]);
    }

    // Verified users and admins can trade directly inside Telegram
    rows.push([
      Markup.button.callback('💱 Browse Market & Trade', 'bot_market'),
      Markup.button.callback('📋 My Orders', 'bot_orders'),
    ]);

    if (!isVerified) {
      rows.push([
        Markup.button.callback('🪪 Complete ID Verification', 'bot_kyc_info'),
        Markup.button.callback('🎫 Support Desk', 'bot_support'),
      ]);
    } else {
      rows.push([
        Markup.button.callback('💰 Wallet Balance', 'bot_wallet'),
        Markup.button.callback('🎫 Support Desk', 'bot_support'),
      ]);
    }

    if (isAdmin) {
      rows.push([
        Markup.button.callback('⚠️ Open Appeals', 'admin_open_disputes'),
        Markup.button.callback('📢 Manage Ads', 'admin_view_offers'),
      ]);
      rows.push([
        Markup.button.callback('👥 Users & Ban', 'admin_view_users'),
        Markup.button.callback('🛡️ Pending KYCs', 'admin_pending_kyc'),
      ]);
      rows.push([
        Markup.button.callback('🏪 Merchants', 'admin_pending_merchants'),
        Markup.button.callback('📤 Withdrawals', 'admin_view_withdrawals'),
      ]);
      rows.push([
        Markup.button.callback('🎫 Support Tickets', 'admin_view_tickets'),
        Markup.button.callback('📜 Audit Logs', 'admin_view_audit'),
      ]);
    }

    return Markup.inlineKeyboard(rows);
  }

  private async replyMarketOffers(ctx: {
    replyWithHTML: (html: string, extra?: Parameters<Context['replyWithHTML']>[1]) => Promise<unknown>;
  }) {
    const allOffers = await db.getOffers();
    const active = allOffers.filter((o) => o.isActive && o.totalAvailable > 0).slice(0, 6);

    if (active.length === 0) {
      await ctx.replyWithHTML(
        `📊 <b>Fetan P2P Market</b>\n\nNo active offers right now. Open the Mini App or check back shortly.`
      );
      return;
    }

    const lines = active.map((o, idx) => {
      const side = o.offerType === 'SELL' ? '🟢 BUY USDT' : '🔵 SELL USDT';
      const rails = o.paymentMethods
        .map((m) => PAYMENT_METHODS_META[m]?.shortName || m)
        .join(', ');
      return `${idx + 1}. <b>${side}</b> @ <code>${o.pricePerUsdtEtb.toFixed(2)} ETB</code>\n   • Merchant: ${displayName(o.merchantName)} • Avail: <code>${o.totalAvailable.toFixed(2)} USDT</code>\n   • Limits: ${o.minLimitEtb.toLocaleString()}–${o.maxLimitEtb.toLocaleString()} ETB (${rails})`;
    });

    const buttons = active.map((o) => [
      Markup.button.callback(
        `${o.offerType === 'SELL' ? '🟢 Buy' : '🔵 Sell'} @ ${o.pricePerUsdtEtb.toFixed(2)} ETB (${displayName(o.merchantName)})`,
        `bot_offer:${o.id}`
      ),
    ]);

    await ctx.replyWithHTML(
      `💱 <b>Live P2P Market Offers</b>\n\nSelect an offer below to trade via Fetan Escrow:\n\n${lines.join('\n\n')}`,
      Markup.inlineKeyboard(buttons)
    );
  }

  private async replyUserOrders(
    ctx: { replyWithHTML: (html: string, extra?: Parameters<Context['replyWithHTML']>[1]) => Promise<unknown> },
    user: User
  ) {
    const orders = (await db.getOrdersForUser(user.id)).slice(0, 5);
    if (orders.length === 0) {
      await ctx.replyWithHTML(
        `📋 <b>My P2P Orders</b>\n\nYou have no orders yet. Use /trade to open your first escrow order.`
      );
      return;
    }

    for (const o of orders) {
      const isBuyer = o.buyerId === user.id;
      const isSeller = o.sellerId === user.id;
      const roleSide = isBuyer ? 'Buy USDT' : 'Sell USDT';
      const actionRows: ReturnType<typeof Markup.button.callback>[][] = [];

      if (o.status === 'PENDING_PAYMENT' && isBuyer) {
        actionRows.push([
          Markup.button.callback('✅ Mark Paid', `bot_paid:${o.id}`),
          Markup.button.callback('❌ Cancel', `bot_cancel:${o.id}`),
        ]);
      } else if (o.status === 'PAYMENT_SENT' && isSeller) {
        actionRows.push([
          Markup.button.callback('🔓 Release USDT', `bot_release:${o.id}`),
          Markup.button.callback('⚠️ Dispute', `bot_dispute:${o.id}`),
        ]);
      } else if (o.status === 'PAYMENT_SENT' && isBuyer) {
        actionRows.push([Markup.button.callback('⚠️ Open Dispute', `bot_dispute:${o.id}`)]);
      }

      await ctx.replyWithHTML(
        `🧾 <b>Order #${o.id}</b> (${roleSide})\n` +
          `• Status: <b>${o.status}</b>\n` +
          `• Amount: <code>${o.usdtAmount.toFixed(2)} USDT</code> / <b>${o.etbAmount.toLocaleString()} ETB</b>\n` +
          `• Rail: ${PAYMENT_METHODS_META[o.paymentMethod]?.shortName || o.paymentMethod}`,
        actionRows.length > 0 ? Markup.inlineKeyboard(actionRows) : undefined
      );
    }
  }

  private initBot(token: string) {
    try {
      this.bot = new Telegraf(token);
      void this.setupBotMenuButton();

      this.bot.start(async (ctx) => {
        const startPayload = (ctx.startPayload || '').trim();
        if (startPayload.startsWith('link_') || startPayload.startsWith('FETAN-')) {
          const code = startPayload.replace(/^link_/, '');
          const linked = await db.linkTelegramAccount(
            code,
            String(ctx.chat.id),
            ctx.from?.username
          );
          if (linked) {
            const isAdmin = isAdminRole(linked.role);
            const isVerified = linked.kycStatus === 'VERIFIED' || isAdmin;
            await ctx.replyWithHTML(
              `✅ <b>Account Linked Successfully!</b>\n\nWelcome, <b>${displayName(linked.name)}</b>.\nYour Fetan P2P notifications and Telegram trading are now active.`,
              this.buildStartKeyboard(isVerified, isAdmin)
            );
            return;
          }
        }

        const { user, isAdmin, isVerified } = await this.resolveActorUser(ctx.from);
        if (startPayload.startsWith('kyc_') && isVerified) {
          await ctx.replyWithHTML(
            `✅ <b>Already Verified!</b>\n\nYour identity is verified with full access to P2P trading. Tap below to start:`,
            this.buildStartKeyboard(true, isAdmin)
          );
          return;
        }

        if (startPayload.startsWith('kyc_') && !isVerified) {
          await ctx.replyWithHTML(
            `🪪 <b>Identity Verification</b>\n\nOpen the Fetan P2P Mini App to upload your Fayda / National ID or Passport photo securely.`
          );
          return;
        }

        const statusLine = isAdmin
          ? '🛡️ <b>Admin & Verified Trader Mode</b>'
          : isVerified
          ? '✅ <b>Verified Trader</b>'
          : '⏳ <b>Verification Required to Trade</b>';

        const balanceLine = user
          ? `💰 Available: <code>${user.usdtBalance.toFixed(2)} USDT</code> • Locked: <code>${user.usdtLocked.toFixed(2)} USDT</code>`
          : '';

        await ctx.replyWithHTML(
          `🏛️ <b>Fetan P2P — Sovereign Ethiopian Escrow</b>\n\n${statusLine}\n${balanceLine}\n\nTrade USDT directly here with Telebirr, CBE, Awash & Bank of Abyssinia.`,
          this.buildStartKeyboard(isVerified, isAdmin)
        );
      });

      this.bot.command('app', async (ctx) => {
        const { isAdmin, isVerified } = await this.resolveActorUser(ctx.from);
        await ctx.replyWithHTML(
          `📱 Launch the <b>Fetan P2P Liquid Glass App</b> directly below:`,
          this.buildStartKeyboard(isVerified, isAdmin)
        );
      });

      this.bot.command(['trade', 'market'], async (ctx) => {
        await this.replyMarketOffers(ctx);
      });

      this.bot.action('bot_market', async (ctx) => {
        await ctx.answerCbQuery();
        await this.replyMarketOffers(ctx);
      });

      this.bot.action(/^bot_offer:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const offerId = ctx.match[1];
        const offer = await db.getOffer(offerId);
        if (!offer || !offer.isActive || offer.totalAvailable <= 0) {
          await ctx.replyWithHTML('❌ This offer is no longer active.');
          return;
        }

        const { isVerified } = await this.resolveActorUser(ctx.from);
        if (!isVerified) {
          await ctx.replyWithHTML(
            '⚠️ Please complete ID verification in the Mini App before opening escrow orders.'
          );
          return;
        }

        const minUsdt = Math.max(5, Math.ceil(offer.minLimitEtb / offer.pricePerUsdtEtb));
        const maxUsdt = Math.min(
          offer.totalAvailable,
          Math.floor(offer.maxLimitEtb / offer.pricePerUsdtEtb)
        );
        const presets = [25, 50, 100, 250].filter((amt) => amt >= minUsdt && amt <= maxUsdt);
        if (presets.length === 0 && maxUsdt >= minUsdt) {
          presets.push(Number(Math.min(maxUsdt, minUsdt).toFixed(2)));
        }

        const amountButtons = presets.map((amt) =>
          Markup.button.callback(`${amt} USDT`, `bot_trade:${offer.id}:${amt}`)
        );
        const sideLabel = offer.offerType === 'SELL' ? 'Buy USDT' : 'Sell USDT';
        const rails = offer.paymentMethods
          .map((m) => PAYMENT_METHODS_META[m]?.shortName || m)
          .join(', ');

        await ctx.replyWithHTML(
          `💱 <b>${sideLabel} with ${displayName(offer.merchantName)}</b>\n\n` +
            `• Rate: <code>${offer.pricePerUsdtEtb.toFixed(2)} ETB / USDT</code>\n` +
            `• Available: <code>${offer.totalAvailable.toFixed(2)} USDT</code>\n` +
            `• Limits: <code>${minUsdt}–${maxUsdt} USDT</code> (${offer.minLimitEtb.toLocaleString()}–${offer.maxLimitEtb.toLocaleString()} ETB)\n` +
            `• Methods: ${rails}\n\n` +
            `Tap a quick amount or run:\n<code>/buy ${offer.id} 50</code>`,
          amountButtons.length > 0 ? Markup.inlineKeyboard([amountButtons]) : undefined
        );
      });

      const handleTradeExecution = async (
        ctx: {
          from?: { id?: number; username?: string; first_name?: string; last_name?: string };
          replyWithHTML: (html: string, extra?: Parameters<Context['replyWithHTML']>[1]) => Promise<unknown>;
        },
        offerId: string,
        usdtAmount: number
      ) => {
        const { user, isVerified } = await this.resolveActorUser(ctx.from);
        if (!user) {
          await ctx.replyWithHTML('⚠️ Could not identify your Telegram account.');
          return;
        }
        if (user.isSuspended) {
          await ctx.replyWithHTML(
            `🚫 <b>Account Suspended</b>\n${user.suspendReason || 'Trading access disabled by Compliance.'}`
          );
          return;
        }
        if (!isVerified) {
          await ctx.replyWithHTML('⚠️ Identity verification is required before trading.');
          return;
        }

        const offer = await db.getOffer(offerId);
        if (!offer) {
          await ctx.replyWithHTML('❌ Offer not found.');
          return;
        }

        try {
          const { escrowController } = await import('./escrow-controller');
          const order = await escrowController.lockEscrow({
            offerId: offer.id,
            buyerId: user.id,
            usdtAmount,
            paymentMethod: (offer.paymentMethods[0] || 'TELEBIRR') as PaymentMethod,
          });
          const isBuyer = order.buyerId === user.id;
          const acctInfo = order.paymentDetails?.accountNumber
            ? `<code>${order.paymentDetails.accountNumber}</code> (${order.paymentDetails.accountName || ''})`
            : 'See Fetan Web/Mini App trade room';

          await ctx.replyWithHTML(
            `🔒 <b>Escrow Order #${order.id} Opened</b>\n\n` +
              `• Amount: <code>${order.usdtAmount.toFixed(2)} USDT</code>\n` +
              `• Total ETB: <b>${order.etbAmount.toLocaleString()} ETB</b> @ <code>${order.unitPriceEtb.toFixed(2)}</code>\n` +
              `• Payment Method: <b>${PAYMENT_METHODS_META[order.paymentMethod]?.shortName || order.paymentMethod}</b>\n` +
              `• Account: ${acctInfo}\n\n` +
              (isBuyer
                ? 'Transfer the exact ETB amount within 15 minutes and tap <b>Mark Paid</b> below.'
                : 'Wait for the buyer to transfer ETB and mark payment sent.'),
            isBuyer
              ? Markup.inlineKeyboard([
                  [
                    Markup.button.callback('✅ Mark Paid', `bot_paid:${order.id}`),
                    Markup.button.callback('❌ Cancel', `bot_cancel:${order.id}`),
                  ],
                ])
              : Markup.inlineKeyboard([
                  [Markup.button.callback('📋 View My Orders', 'bot_orders')],
                ])
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unable to open order';
          await ctx.replyWithHTML(`❌ <b>Trade Error:</b> ${msg}`);
        }
      };

      this.bot.command('buy', async (ctx) => {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length < 3) {
          await ctx.replyWithHTML(
            `Usage: <code>/buy &lt;offerId&gt; &lt;usdtAmount&gt;</code>\nUse /trade to browse offers interactively.`
          );
          return;
        }
        const offerId = parts[1];
        const amount = Number(parts[2]);
        if (!Number.isFinite(amount) || amount <= 0) {
          await ctx.replyWithHTML('❌ Please specify a valid positive USDT amount.');
          return;
        }
        await handleTradeExecution(ctx, offerId, amount);
      });

      this.bot.action(/^bot_trade:([^:]+):(\d+(?:\.\d+)?)$/, async (ctx) => {
        await ctx.answerCbQuery('Locking escrow...');
        await handleTradeExecution(ctx, ctx.match[1], Number(ctx.match[2]));
      });

      this.bot.command('orders', async (ctx) => {
        const { user } = await this.resolveActorUser(ctx.from);
        if (!user) return;
        await this.replyUserOrders(ctx, user);
      });

      this.bot.action('bot_orders', async (ctx) => {
        await ctx.answerCbQuery();
        const { user } = await this.resolveActorUser(ctx.from);
        if (!user) return;
        await this.replyUserOrders(ctx, user);
      });

      this.bot.action(/^bot_(paid|release|cancel|dispute):(.+)$/, async (ctx) => {
        const actionType = ctx.match[1];
        const orderId = ctx.match[2];
        const { user } = await this.resolveActorUser(ctx.from);
        if (!user) {
          await ctx.answerCbQuery('Account not linked', { show_alert: true });
          return;
        }

        try {
          const { escrowController } = await import('./escrow-controller');
          if (actionType === 'paid') {
            await escrowController.confirmPayment(orderId, user.id);
            await ctx.answerCbQuery('Marked Paid');
            await ctx.replyWithHTML(`✅ Order <code>#${orderId}</code> marked as paid. Seller notified.`);
          } else if (actionType === 'release') {
            await escrowController.releaseEscrow(orderId, user.id, 'Released via Telegram Bot');
            await ctx.answerCbQuery('USDT Released');
            await ctx.replyWithHTML(`🔓 Order <code>#${orderId}</code> completed! USDT released to buyer.`);
          } else if (actionType === 'cancel') {
            await escrowController.cancelEscrow(orderId, user.id, 'Cancelled via Telegram Bot');
            await ctx.answerCbQuery('Order Cancelled');
            await ctx.replyWithHTML(`↩️ Order <code>#${orderId}</code> cancelled and escrow unlocked.`);
          } else if (actionType === 'dispute') {
            await escrowController.disputeTrade(
              orderId,
              user.id,
              'Appeal opened via Telegram Bot'
            );
            await ctx.answerCbQuery('Appeal Opened');
            await ctx.replyWithHTML(
              `⚠️ Appeal opened for Order <code>#${orderId}</code>. Fetan Escrow Compliance will review shortly.`
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Action failed';
          await ctx.answerCbQuery(msg.slice(0, 180), { show_alert: true });
        }
      });

      this.bot.command('wallet', async (ctx) => {
        const { user, isVerified, isAdmin } = await this.resolveActorUser(ctx.from);
        if (!user) return;
        await ctx.replyWithHTML(
          `💰 <b>Fetan P2P Wallet</b>\n\n` +
            `• Available USDT: <code>${user.usdtBalance.toFixed(2)} USDT</code>\n` +
            `• In Escrow: <code>${user.usdtLocked.toFixed(2)} USDT</code>\n` +
            `• Completed Trades: <b>${user.completedTrades || 0}</b>\n` +
            `• Status: ${isAdmin ? '🛡️ Admin & Trader' : isVerified ? '✅ Verified' : '⏳ Unverified'}`,
          this.buildStartKeyboard(isVerified, isAdmin)
        );
      });

      this.bot.action('bot_wallet', async (ctx) => {
        await ctx.answerCbQuery();
        const { user, isVerified, isAdmin } = await this.resolveActorUser(ctx.from);
        if (!user) return;
        await ctx.replyWithHTML(
          `💰 <b>Fetan P2P Wallet</b>\n\n` +
            `• Available USDT: <code>${user.usdtBalance.toFixed(2)} USDT</code>\n` +
            `• In Escrow: <code>${user.usdtLocked.toFixed(2)} USDT</code>\n` +
            `• Completed Trades: <b>${user.completedTrades || 0}</b>`,
          this.buildStartKeyboard(isVerified, isAdmin)
        );
      });

      this.bot.command('kyc', async (ctx) => {
        const { isVerified, isAdmin } = await this.resolveActorUser(ctx.from);
        if (isVerified) {
          await ctx.replyWithHTML(
            `✅ <b>Your account is already verified!</b>\n\nYou don't need to submit ID again — use /trade or open the Fetan App to buy and sell USDT.`,
            this.buildStartKeyboard(true, isAdmin)
          );
          return;
        }
        await ctx.replyWithHTML(
          `🪪 <b>Identity Verification</b>\n\nPlease open the Fetan P2P Mini App to upload your Fayda / National ID photo securely.`,
          this.buildStartKeyboard(false, false)
        );
      });

      this.bot.action('bot_kyc_info', async (ctx) => {
        await ctx.answerCbQuery();
        const { isVerified, isAdmin } = await this.resolveActorUser(ctx.from);
        if (isVerified) {
          await ctx.replyWithHTML(
            `✅ <b>Your account is already verified!</b> Use /trade to buy or sell USDT.`,
            this.buildStartKeyboard(true, isAdmin)
          );
          return;
        }
        await ctx.replyWithHTML(
          `🪪 Open the Fetan P2P Mini App using the button below to upload your ID document:`,
          this.buildStartKeyboard(false, false)
        );
      });

      this.bot.action('bot_support', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.replyWithHTML(
          `🎫 <b>Fetan Private Support Desk</b>\n\nSend:\n<code>/support &lt;Your message or Order #&gt;</code>\n\nYour message goes privately to our Operations & Compliance team.`
        );
      });

      this.bot.command(['support', 'complaint'], async (ctx) => {
        const msgText = ctx.message.text.replace(/^\/(support|complaint)\s*/i, '').trim();
        if (!msgText) {
          await ctx.replyWithHTML(
            `🎫 Usage: <code>/support &lt;order # and details&gt;</code>\nOur Fetan Support Desk will reply promptly.`
          );
          return;
        }
        const { user } = await this.resolveActorUser(ctx.from);
        if (!user) return;
        const now = new Date().toISOString();
        const ticket: SupportTicket = {
          id: `sup-tg-${Date.now().toString(36)}`,
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          telegramHandle: user.telegramHandle,
          category: 'ORDER_COMPLAINT',
          subject: `Telegram Support from ${displayName(user.name)}`,
          message: msgText.slice(0, 1800),
          status: 'OPEN',
          source: 'TELEGRAM_BOT',
          createdAt: now,
          updatedAt: now,
        };
        await db.saveSupportTicket(ticket);
        await this.sendSupportTicketAlert(ticket);
        await ctx.replyWithHTML(
          `✅ <b>Support Ticket #${ticket.id} Received</b>\n\nRouted privately to the <b>Fetan Support Desk</b>. We will respond shortly.`
        );
      });

      this.bot.command('admin', async (ctx) => {
        const { isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin) {
          await ctx.replyWithHTML('❌ Admin authorization required.');
          return;
        }
        const [kycs, apps, allOrders, allOffers, wdrs, tickets] = await Promise.all([
          db.getKycSubmissions(),
          db.getMerchantApplications(),
          db.getAllOrders(),
          db.getOffers(undefined, undefined, true),
          db.getWalletTransactions(),
          db.getSupportTickets(),
        ]);
        const pendingKycs = kycs.filter((k) => k.status === 'PENDING').length;
        const pendingMerchants = apps.filter((a) => a.status === 'PENDING').length;
        const disputes = allOrders.filter((o) => o.status === 'DISPUTED').length;
        const pendingWdrs = wdrs.filter((w) => w.type === 'WITHDRAW' && w.status === 'PENDING').length;
        const openTickets = tickets.filter((t) => t.status === 'OPEN').length;

        await ctx.replyWithHTML(
          `🛡️ <b>Fetan Admin Operations & Trading</b>\n\n` +
            `• Open Disputes: <b>${disputes}</b> • Ads: <b>${allOffers.length}</b>\n` +
            `• Pending KYCs: <b>${pendingKycs}</b> • Merchants: <b>${pendingMerchants}</b>\n` +
            `• Withdrawals: <b>${pendingWdrs}</b> • Tickets: <b>${openTickets}</b>\n\n` +
            `<b>Quick Commands:</b>\n` +
            `<code>/ban &lt;email_or_id&gt; [reason]</code>\n` +
            `<code>/unban &lt;email_or_id&gt;</code>\n` +
            `<code>/approve_wdr &lt;txId&gt; &lt;txHash&gt;</code>\n` +
            `<code>/reject_wdr &lt;txId&gt; [reason]</code>`,
          this.buildStartKeyboard(true, true)
        );
      });

      this.bot.command(['ban', 'unban'], async (ctx) => {
        const { user: actor, isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin || !actor) {
          await ctx.replyWithHTML('❌ Admin authorization required.');
          return;
        }
        const raw = ctx.message.text.trim();
        const isUnban = raw.startsWith('/unban');
        const parts = raw.split(/\s+/);
        const identifier = (parts[1] || '').trim();
        const reason = parts.slice(2).join(' ').trim();
        if (!identifier) {
          await ctx.replyWithHTML(
            `Usage: <code>/${isUnban ? 'unban' : 'ban'} &lt;email_or_userId&gt; ${isUnban ? '' : '[reason]'}</code>`
          );
          return;
        }
        const allUsers = await db.getAllUsers();
        const lower = identifier.toLowerCase();
        const target = allUsers.find(
          (u) =>
            u.id === identifier ||
            u.email.toLowerCase() === lower ||
            (u.telegramHandle && u.telegramHandle.toLowerCase() === `@${lower.replace(/^@/, '')}`)
        );
        if (!target) {
          await ctx.replyWithHTML(`❌ User <code>${identifier}</code> not found.`);
          return;
        }
        if (target.role === 'SUPERADMIN' || target.id === actor.id) {
          await ctx.replyWithHTML('❌ Cannot suspend Superadmin or your own account.');
          return;
        }
        if (target.role === 'ADMIN' && actor.role !== 'SUPERADMIN') {
          await ctx.replyWithHTML('❌ Only Superadmin can suspend/unban an Admin.');
          return;
        }
        const nextSuspended = !isUnban;
        const cleanReason = nextSuspended ? reason || 'Suspended via Telegram Admin' : '';
        await db.updateUser(target.id, {
          isSuspended: nextSuspended,
          suspendReason: cleanReason,
        });
        if (nextSuspended) {
          const owned = await db.getOffers(undefined, undefined, true, target.id);
          for (const o of owned) {
            if (o.isActive) await db.updateOffer(o.id, { isActive: false });
          }
        }
        await db.logAudit({
          actorId: actor.id,
          actorRole: actor.role,
          action: nextSuspended ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED',
          targetType: 'User',
          targetId: target.id,
          details: { source: 'TELEGRAM_BOT', suspendReason: cleanReason || null },
        });
        if (target.telegramChatId) {
          void this.sendTelegramMessage(
            target.telegramChatId,
            nextSuspended
              ? `🚫 <b>Account Suspended</b>\nReason: ${cleanReason}`
              : `✅ <b>Account Reactivated</b>\nYour trading access has been restored.`
          );
        }
        await ctx.replyWithHTML(
          nextSuspended
            ? `🚫 <b>Suspended:</b> ${displayName(target.name)} (${target.email})`
            : `✅ <b>Unbanned:</b> ${displayName(target.name)} (${target.email})`
        );
      });

      this.bot.command(['approve_wdr', 'reject_wdr'], async (ctx) => {
        const { user: actor, isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin || !actor) {
          await ctx.replyWithHTML('❌ Admin authorization required.');
          return;
        }
        const raw = ctx.message.text.trim();
        const approved = raw.startsWith('/approve_wdr');
        const parts = raw.split(/\s+/);
        const txId = (parts[1] || '').trim();
        const arg2 = (parts[2] || '').trim();
        const rest = parts.slice(2).join(' ').trim();
        if (!txId || (approved && !arg2)) {
          await ctx.replyWithHTML(
            approved
              ? `Usage: <code>/approve_wdr &lt;txId&gt; &lt;txHash&gt;</code>`
              : `Usage: <code>/reject_wdr &lt;txId&gt; [reason]</code>`
          );
          return;
        }
        const existing = await db.getWalletTransaction(txId);
        if (!existing || existing.type !== 'WITHDRAW' || existing.status !== 'PENDING') {
          await ctx.replyWithHTML('❌ Pending withdrawal not found.');
          return;
        }
        if (approved) {
          const check = validateTxHash(arg2, existing.network);
          if (!check.valid) {
            await ctx.replyWithHTML(`❌ ${check.error || 'Invalid TxHash format.'}`);
            return;
          }
        }
        const owner = await db.withUserLock(existing.userId, async (locked) => {
          if (!approved) {
            await db.updateUser(locked.id, {
              usdtBalance: Number((locked.usdtBalance + existing.amount).toFixed(6)),
            });
          }
          await db.saveWalletTransaction({
            ...existing,
            status: approved ? 'COMPLETED' : 'REJECTED',
            txHash: approved ? arg2 : existing.txHash,
            reviewedBy: actor.id,
            note: approved
              ? `Approved via Telegram Admin (${displayName(actor.name)})`
              : rest || `Rejected & refunded via Telegram Admin`,
          });
          return locked;
        });
        await db.logAudit({
          actorId: actor.id,
          actorRole: actor.role,
          action: approved ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
          targetType: 'WalletTransaction',
          targetId: txId,
          details: { source: 'TELEGRAM_BOT', txHash: approved ? arg2 : null },
        });
        if (owner.telegramChatId) {
          void this.sendTelegramMessage(
            owner.telegramChatId,
            approved
              ? `✅ <b>USDT Withdrawal Dispatched</b>\n• Amount: <code>${existing.amount.toFixed(2)} USDT</code>\n• TxHash: <code>${arg2}</code>`
              : `↩️ <b>Withdrawal Rejected & Refunded</b>\n• Amount: <code>${existing.amount.toFixed(2)} USDT</code> returned to your wallet.`
          );
        }
        await ctx.replyWithHTML(
          approved
            ? `✅ Withdrawal <code>${txId}</code> marked COMPLETED.`
            : `↩️ Withdrawal <code>${txId}</code> REJECTED & refunded.`
        );
      });

      this.bot.action('admin_pending_kyc', async (ctx) => {
        const { isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        await ctx.answerCbQuery();
        const pending = (await db.getKycSubmissions())
          .filter((k) => k.status === 'PENDING')
          .slice(0, 5);
        if (pending.length === 0) {
          await ctx.replyWithHTML('✅ No pending KYC verifications.');
          return;
        }
        for (const k of pending) {
          await ctx.replyWithHTML(
            `🪪 <b>KYC #${k.id}</b>\n• User: <b>${k.userName}</b>\n• Type: ${k.kycDocType}\n• Number: <code>${k.kycDocNumber}</code>`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Approve', `kyc_approve:${k.id}`),
                Markup.button.callback('❌ Reject', `kyc_reject:${k.id}`),
              ],
            ])
          );
        }
      });

      this.bot.action('admin_pending_merchants', async (ctx) => {
        const { isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        await ctx.answerCbQuery();
        const pending = (await db.getMerchantApplications())
          .filter((a) => a.status === 'PENDING')
          .slice(0, 5);
        if (pending.length === 0) {
          await ctx.replyWithHTML('✅ No pending merchant applications.');
          return;
        }
        for (const a of pending) {
          await ctx.replyWithHTML(
            `🏪 <b>Merchant #${a.id}</b>\n• User: <b>${a.userName}</b>\n• Balance: <code>${a.usdtBalance.toFixed(2)} USDT</code>`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Approve', `merchant_approve:${a.id}`),
                Markup.button.callback('❌ Reject', `merchant_reject:${a.id}`),
              ],
            ])
          );
        }
      });

      this.bot.action('admin_open_disputes', async (ctx) => {
        const { isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        await ctx.answerCbQuery();
        const disputed = (await db.getAllOrders())
          .filter((o) => o.status === 'DISPUTED')
          .slice(0, 5);
        if (disputed.length === 0) {
          await ctx.replyWithHTML('✅ No open trade disputes.');
          return;
        }
        for (const d of disputed) {
          await ctx.replyWithHTML(
            `⚠️ <b>Dispute Order #${d.id}</b>\n• Amount: <code>${d.usdtAmount.toFixed(2)} USDT</code> (${d.etbAmount.toLocaleString()} ETB)\n• Buyer: ${displayName(d.buyerName)}\n• Seller: ${displayName(d.sellerName)}\n• Reason: ${d.disputeReason || 'No reason provided'}`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback('🔓 Release to Buyer', `admin_release:${d.id}`),
                Markup.button.callback('↩️ Refund Seller', `admin_refund:${d.id}`),
              ],
            ])
          );
        }
      });

      this.bot.action(/^(?:admin_release|order_release):(.+)$/, async (ctx) => {
        const check = await this.isAuthorizedAdminTelegramActor(ctx.from?.id, ctx.from?.username);
        if (!check.authorized) {
          await ctx.answerCbQuery('Unauthorized: Admin access required', { show_alert: true });
          return;
        }
        const { user } = await this.resolveActorUser(ctx.from);
        try {
          const { escrowController } = await import('./escrow-controller');
          await escrowController.releaseEscrow(
            ctx.match[1],
            user?.id || 'ADMIN_TELEGRAM',
            'Resolved to buyer via Fetan Admin Telegram'
          );
          await ctx.answerCbQuery('Released to Buyer');
          await ctx.replyWithHTML(`🔓 Order <code>#${ctx.match[1]}</code> released to buyer.`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to release';
          await ctx.answerCbQuery(msg.slice(0, 180), { show_alert: true });
        }
      });

      this.bot.action(/^(?:admin_refund|order_cancel):(.+)$/, async (ctx) => {
        const check = await this.isAuthorizedAdminTelegramActor(ctx.from?.id, ctx.from?.username);
        if (!check.authorized) {
          await ctx.answerCbQuery('Unauthorized: Admin access required', { show_alert: true });
          return;
        }
        const { user } = await this.resolveActorUser(ctx.from);
        try {
          const { escrowController } = await import('./escrow-controller');
          await escrowController.cancelEscrow(
            ctx.match[1],
            user?.id || 'ADMIN_TELEGRAM',
            'Refunded to seller via Fetan Admin Telegram'
          );
          await ctx.answerCbQuery('Refunded to Seller');
          await ctx.replyWithHTML(`↩️ Order <code>#${ctx.match[1]}</code> cancelled & refunded to seller.`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to refund';
          await ctx.answerCbQuery(msg.slice(0, 180), { show_alert: true });
        }
      });

      this.bot.action(/^(?:approve_merchant|merchant_approve):(.+)$/, async (ctx) => {
        const check = await this.isAuthorizedAdminTelegramActor(ctx.from?.id, ctx.from?.username);
        if (!check.authorized) {
          await ctx.answerCbQuery('Unauthorized: Admin access required', { show_alert: true });
          return;
        }
        await this.handleMerchantApproval(ctx.match[1], check.label, true);
        await ctx.answerCbQuery('Merchant Approved');
      });

      this.bot.action(/^(?:reject_merchant|merchant_reject):(.+)$/, async (ctx) => {
        const check = await this.isAuthorizedAdminTelegramActor(ctx.from?.id, ctx.from?.username);
        if (!check.authorized) {
          await ctx.answerCbQuery('Unauthorized: Admin access required', { show_alert: true });
          return;
        }
        await this.handleMerchantApproval(ctx.match[1], check.label, false);
        await ctx.answerCbQuery('Merchant Rejected');
      });

      this.bot.action(/^(?:approve_kyc|kyc_approve):(.+)$/, async (ctx) => {
        const check = await this.isAuthorizedAdminTelegramActor(ctx.from?.id, ctx.from?.username);
        if (!check.authorized) {
          await ctx.answerCbQuery('Unauthorized: Admin access required', { show_alert: true });
          return;
        }
        await this.handleKycApproval(ctx.match[1], check.label, true);
        await ctx.answerCbQuery('KYC Approved');
      });

      this.bot.action(/^(?:reject_kyc|kyc_reject):(.+)$/, async (ctx) => {
        const check = await this.isAuthorizedAdminTelegramActor(ctx.from?.id, ctx.from?.username);
        if (!check.authorized) {
          await ctx.answerCbQuery('Unauthorized: Admin access required', { show_alert: true });
          return;
        }
        await this.handleKycApproval(ctx.match[1], check.label, false);
        await ctx.answerCbQuery('KYC Rejected');
      });

      this.bot.action('admin_view_offers', async (ctx) => {
        const { isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        await ctx.answerCbQuery();
        const offers = (await db.getOffers(undefined, undefined, true)).slice(0, 8);
        if (offers.length === 0) {
          await ctx.replyWithHTML('✅ No marketplace ads found.');
          return;
        }
        for (const o of offers) {
          await ctx.replyWithHTML(
            `📢 <b>Ad #${o.id}</b> (${o.isActive ? '🟢 ACTIVE' : '⏸ PAUSED'})\n` +
              `• Merchant: <b>${displayName(o.merchantName)}</b> (${o.offerType})\n` +
              `• Rate: <code>${o.pricePerUsdtEtb.toFixed(2)} ETB</code> • Avail: <code>${o.totalAvailable.toFixed(2)} USDT</code>`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  o.isActive ? '⏸ Pause Ad' : '▶️ Activate Ad',
                  `offer_toggle:${o.id}`
                ),
                Markup.button.callback('🗑 Delete Ad', `offer_delete:${o.id}`),
              ],
            ])
          );
        }
      });

      this.bot.action(/^(offer_toggle|offer_delete):(.+)$/, async (ctx) => {
        const { user: actor, isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin || !actor) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        const isDelete = ctx.match[1] === 'offer_delete';
        const offerId = ctx.match[2];
        const offer = await db.getOffer(offerId);
        if (!offer) {
          await ctx.answerCbQuery('Ad not found', { show_alert: true });
          return;
        }
        if (isDelete) {
          const openOrders = await db.getOpenOrdersForOffer(offerId);
          if (openOrders.length > 0) {
            await ctx.answerCbQuery('Cannot delete ad with active open orders', { show_alert: true });
            return;
          }
          try {
            await db.deleteOffer(offerId);
          } catch {
            await db.updateOffer(offerId, { isActive: false, totalAvailable: 0 });
          }
          await ctx.answerCbQuery('Ad removed');
          await ctx.replyWithHTML(`🗑 Ad <code>#${offerId}</code> removed from marketplace.`);
        } else {
          const updated = await db.updateOffer(offerId, { isActive: !offer.isActive });
          await ctx.answerCbQuery(updated.isActive ? 'Ad activated' : 'Ad paused');
          await ctx.replyWithHTML(
            `${updated.isActive ? '▶️ Activated' : '⏸ Paused'} Ad <code>#${offerId}</code>.`
          );
        }
      });

      this.bot.action('admin_view_users', async (ctx) => {
        const { user: actor, isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin || !actor) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        await ctx.answerCbQuery();
        const users = (await db.getAllUsers())
          .filter((u) => u.role !== 'SUPERADMIN' && u.id !== actor.id)
          .slice(0, 8);
        const canAdminToggle = actor.role === 'SUPERADMIN';
        for (const u of users) {
          const rows = [
            [
              Markup.button.callback(u.isSuspended ? '✅ Unban' : '🚫 Ban / Suspend', `user_suspend:${u.id}`),
              Markup.button.callback(
                u.kycStatus === 'VERIFIED' ? '❌ Reset ID' : '🪪 Verify ID',
                `user_kyc:${u.id}`
              ),
            ],
            [
              Markup.button.callback(
                u.role === 'MERCHANT' ? 'Revoke Merchant' : '🏪 Make Merchant',
                `user_merch:${u.id}`
              ),
              ...(canAdminToggle
                ? [
                    Markup.button.callback(
                      u.role === 'ADMIN' ? 'Remove Admin' : '🛡️ Make Admin',
                      `user_admin:${u.id}`
                    ),
                  ]
                : []),
            ],
          ];
          await ctx.replyWithHTML(
            `👤 <b>${displayName(u.name)}</b> ${u.isSuspended ? '🚫 [SUSPENDED]' : ''}\n` +
              `• ${u.email}\n` +
              `• Role: <b>${u.role}</b> • KYC: <b>${u.kycStatus}</b> • Bal: <code>${u.usdtBalance.toFixed(2)} USDT</code>`,
            Markup.inlineKeyboard(rows)
          );
        }
      });

      this.bot.action(/^(user_suspend|user_kyc|user_merch|user_admin):(.+)$/, async (ctx) => {
        const { user: actor, isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin || !actor) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        const prefix = ctx.match[1];
        const targetId = ctx.match[2];
        const target = await db.getUser(targetId);
        if (!target || target.role === 'SUPERADMIN' || target.id === actor.id) {
          await ctx.answerCbQuery('Cannot modify this account', { show_alert: true });
          return;
        }
        if ((prefix === 'user_admin' || (prefix === 'user_suspend' && target.role === 'ADMIN')) && actor.role !== 'SUPERADMIN') {
          await ctx.answerCbQuery('Superadmin required', { show_alert: true });
          return;
        }
        if (prefix === 'user_suspend') {
          const next = !Boolean(target.isSuspended);
          await db.updateUser(target.id, {
            isSuspended: next,
            suspendReason: next ? 'Suspended via Telegram Admin' : '',
          });
          if (next) {
            const owned = await db.getOffers(undefined, undefined, true, target.id);
            for (const o of owned) if (o.isActive) await db.updateOffer(o.id, { isActive: false });
          }
          await ctx.answerCbQuery(next ? 'User suspended' : 'User reactivated');
          await ctx.replyWithHTML(
            next
              ? `🚫 Suspended <b>${displayName(target.name)}</b> and paused active ads.`
              : `✅ Unbanned <b>${displayName(target.name)}</b>.`
          );
        } else if (prefix === 'user_kyc') {
          const next = target.kycStatus === 'VERIFIED' ? 'REJECTED' : 'VERIFIED';
          await db.updateUser(target.id, { kycStatus: next });
          await ctx.answerCbQuery(`KYC -> ${next}`);
        } else if (prefix === 'user_merch') {
          const isMerch = target.role === 'MERCHANT' || target.merchantStatus === 'APPROVED';
          const next = !isMerch;
          if (next && target.kycStatus !== 'VERIFIED') {
            await ctx.answerCbQuery('User must pass KYC first', { show_alert: true });
            return;
          }
          await db.updateUser(target.id, {
            merchantStatus: next ? 'APPROVED' : 'NONE',
            role: isAdminRole(target.role) ? target.role : next ? 'MERCHANT' : 'USER',
          });
          await ctx.answerCbQuery(next ? 'Merchant granted' : 'Merchant revoked');
        } else if (prefix === 'user_admin') {
          const nextRole = target.role === 'ADMIN' ? 'USER' : 'ADMIN';
          await db.updateUser(target.id, { role: nextRole });
          await ctx.answerCbQuery(`Role -> ${nextRole}`);
        }
      });

      this.bot.action('admin_view_withdrawals', async (ctx) => {
        const { isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        await ctx.answerCbQuery();
        const pending = (await db.getWalletTransactions())
          .filter((w) => w.type === 'WITHDRAW' && w.status === 'PENDING')
          .slice(0, 8);
        if (pending.length === 0) {
          await ctx.replyWithHTML('✅ No pending USDT withdrawals.');
          return;
        }
        for (const w of pending) {
          await ctx.replyWithHTML(
            `📤 <b>Withdrawal #${w.id}</b>\n` +
              `• Amount: <code>${w.amount.toFixed(2)} USDT</code> (${w.network})\n` +
              `• To: <code>${w.address || 'N/A'}</code>\n` +
              `To approve:\n<code>/approve_wdr ${w.id} &lt;txHash&gt;</code>`,
            Markup.inlineKeyboard([
              [Markup.button.callback('❌ Reject & Refund', `wdr_reject:${w.id}`)],
            ])
          );
        }
      });

      this.bot.action(/^wdr_reject:(.+)$/, async (ctx) => {
        const { user: actor, isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin || !actor) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        const txId = ctx.match[1];
        const existing = await db.getWalletTransaction(txId);
        if (!existing || existing.status !== 'PENDING') {
          await ctx.answerCbQuery('Already processed', { show_alert: true });
          return;
        }
        await db.withUserLock(existing.userId, async (locked) => {
          await db.updateUser(locked.id, {
            usdtBalance: Number((locked.usdtBalance + existing.amount).toFixed(6)),
          });
          await db.saveWalletTransaction({
            ...existing,
            status: 'REJECTED',
            reviewedBy: actor.id,
            note: 'Rejected & refunded via Telegram Admin',
          });
        });
        await ctx.answerCbQuery('Rejected & Refunded');
        await ctx.replyWithHTML(`↩️ Withdrawal <code>#${txId}</code> rejected and refunded.`);
      });

      this.bot.action('admin_view_tickets', async (ctx) => {
        const { isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        await ctx.answerCbQuery();
        const open = (await db.getSupportTickets()).filter((t) => t.status === 'OPEN').slice(0, 8);
        if (open.length === 0) {
          await ctx.replyWithHTML('✅ No open support tickets.');
          return;
        }
        for (const t of open) {
          await ctx.replyWithHTML(
            `🎫 <b>Ticket #${t.id}</b>\n• From: <b>${displayName(t.userName)}</b>\n• ${t.subject}\n• "${t.message}"`,
            Markup.inlineKeyboard([
              [Markup.button.callback('✅ Mark Resolved', `ticket_resolve:${t.id}`)],
            ])
          );
        }
      });

      this.bot.action(/^ticket_resolve:(.+)$/, async (ctx) => {
        const { user: actor, isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin || !actor) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        const existing = await db.getSupportTicket(ctx.match[1]);
        if (!existing) {
          await ctx.answerCbQuery('Ticket not found', { show_alert: true });
          return;
        }
        await db.saveSupportTicket({
          ...existing,
          status: 'RESOLVED',
          adminReply: 'Resolved via Telegram Admin',
          resolvedBy: actor.id,
          updatedAt: new Date().toISOString(),
        });
        await ctx.answerCbQuery('Ticket resolved');
        await ctx.replyWithHTML(`✅ Support Ticket <code>#${existing.id}</code> marked resolved.`);
      });

      this.bot.action('admin_view_audit', async (ctx) => {
        const { isAdmin } = await this.resolveActorUser(ctx.from);
        if (!isAdmin) {
          await ctx.answerCbQuery('Unauthorized', { show_alert: true });
          return;
        }
        await ctx.answerCbQuery();
        const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
        const lines = logs.map(
          (l, idx) =>
            `${idx + 1}. <code>${l.action}</code> • ${l.actorRole || 'SYS'} • ${l.targetType || ''}:${l.targetId || ''}`
        );
        await ctx.replyWithHTML(
          `📜 <b>Latest Security Audit Events</b>\n\n${lines.join('\n') || 'No audit entries yet.'}`
        );
      });
    } catch (err) {
      console.error('Failed to initialize Telegram Bot:', err);
    }
  }

  async setupBotMenuButton(): Promise<boolean> {
    const token = this.getBotToken();
    const miniAppUrl = this.getMiniAppUrl();
    if (!token || !miniAppUrl) return false;

    try {
      await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menu_button: {
            type: 'web_app',
            text: 'Open Fetan P2P',
            web_app: { url: miniAppUrl },
          },
        }),
      });

      await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'start', description: 'Open Fetan P2P & Menu' },
            { command: 'trade', description: 'Browse & Trade USDT Offers' },
            { command: 'orders', description: 'Manage My Active Orders' },
            { command: 'wallet', description: 'Check USDT Balance' },
            { command: 'app', description: 'Launch Liquid Glass App' },
            { command: 'support', description: 'Contact Support Desk' },
            { command: 'admin', description: 'Admin Operations Panel' },
          ],
        }),
      });
      return true;
    } catch (e) {
      console.warn('Could not set telegram menu button:', e);
      return false;
    }
  }

  async sendTelegramMessage(
    chatId: string | number | undefined,
    text: string,
    inlineKeyboard: Array<
      Array<{ text: string; callback_data?: string; web_app?: { url: string }; url?: string }>
    > = []
  ): Promise<boolean> {
    if (!chatId) return false;
    const token = this.getBotToken();
    if (!token) return false;

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async broadcastAdminAlert(
    message: string,
    inlineKeyboard: Array<
      Array<{ text: string; callback_data?: string; web_app?: { url: string }; url?: string }>
    > = []
  ): Promise<boolean> {
    return this.sendToAllAdmins(message, inlineKeyboard);
  }

  async sendMessage(chatId: string | number, message: string): Promise<boolean> {
    return this.sendTelegramMessage(chatId, message);
  }

  async syncWithTelegramCloud(action: string, payload: Record<string, unknown> = {}) {
    const cloudToken = this.getTgCloudToken();
    if (!cloudToken) return null;
    const appId = cloudToken.split(':')[0];

    try {
      const schemaPath = path.join(process.cwd(), 'telegram', 'tgcloud', 'schema.js');
      const syncPath = path.join(process.cwd(), 'telegram', 'tgcloud', 'endpoints', 'syncWeb.js');
      if (!fs.existsSync(schemaPath) || !fs.existsSync(syncPath)) {
        return null;
      }

      const schemaCode = fs.readFileSync(schemaPath, 'utf8');
      const syncWebCode = fs.readFileSync(syncPath, 'utf8');

      const res = await fetch(`https://cloud.telegram.org/${appId}/manage/run`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cloudToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          module: 'endpoints/syncWeb',
          sources: {
            schema: schemaCode,
            'endpoints/syncWeb': syncWebCode,
          },
          args: {
            secret: cloudToken,
            action,
            payload,
          },
          ctx: {},
        }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Non-blocking sync
    }
    return null;
  }

  private async getAdminChatIds(): Promise<string[]> {
    const ids = new Set<string>();
    try {
      const users = await db.getAllUsers();
      for (const u of users) {
        if (isAdminRole(u.role) && u.telegramChatId) {
          ids.add(String(u.telegramChatId).trim());
        }
      }
    } catch {
      // Non-fatal DB lookup error
    }
    const envChatId = (process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();
    if (envChatId) ids.add(envChatId);
    return Array.from(ids);
  }

  private async sendToAllAdmins(
    text: string,
    inlineKeyboard: Array<
      Array<{ text: string; callback_data?: string; web_app?: { url: string }; url?: string }>
    > = []
  ): Promise<boolean> {
    const adminChatIds = await this.getAdminChatIds();
    if (adminChatIds.length === 0) return false;
    const results = await Promise.all(
      adminChatIds.map((chatId) => this.sendTelegramMessage(chatId, text, inlineKeyboard))
    );
    return results.some(Boolean);
  }

  async sendOrderNotification(
    order: P2POrder,
    event: 'CREATED' | 'PAID' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED'
  ) {
    const [buyer, seller] = await Promise.all([
      db.getUser(order.buyerId),
      db.getUser(order.sellerId),
    ]);
    const miniAppUrl = this.getMiniAppUrl();
    const adminChatIds = await this.getAdminChatIds();

    if (event === 'CREATED') {
      await emailService.notifyOrderCreated(order, buyer, seller);
      void this.syncWithTelegramCloud('UPSERT_ORDER', { order });

      const textForSeller =
        `<b>New P2P Order #${order.id}</b>\n\n` +
        `• Buyer: <b>${order.buyerName}</b>\n` +
        `• Amount: <b>${order.usdtAmount.toFixed(2)} USDT</b> (${order.etbAmount.toLocaleString()} ETB)\n` +
        `• Method: <b>${order.paymentMethod}</b> (${order.paymentDetails.accountNumber})\n` +
        `• Status: Waiting for buyer to send Birr`;

      this.logEvent({
        id: `tg-${Date.now()}-ord`,
        timestamp: new Date().toISOString(),
        type: 'ORDER_ALERT',
        recipient: seller?.telegramHandle || order.sellerName,
        text: textForSeller.replace(/<[^>]+>/g, ''),
        buttons: [{ text: 'Open Order in Mini App', callbackData: `order_view:${order.id}` }],
        status: 'DELIVERED',
      });

      if (seller?.telegramChatId && seller.telegramNotifications !== false) {
        await this.sendTelegramMessage(seller.telegramChatId, textForSeller, [
          miniAppUrl ? [{ text: 'Open in Mini App', web_app: { url: miniAppUrl } }] : [],
        ].filter((row) => row.length > 0));
      }

      if (buyer?.telegramChatId && buyer.telegramNotifications !== false) {
        const textForBuyer =
          `<b>Order #${order.id} Created</b>\n\n` +
          `<b>${order.usdtAmount.toFixed(2)} USDT</b> is locked in escrow.\n` +
          `Send <b>${order.etbAmount.toLocaleString()} ETB</b> via <b>${order.paymentMethod}</b> to:\n` +
          `• Account: <code>${order.paymentDetails.accountNumber}</code>\n` +
          `• Name: <b>${order.paymentDetails.accountName}</b>`;
        await this.sendTelegramMessage(
          buyer.telegramChatId,
          textForBuyer,
          miniAppUrl ? [[{ text: 'Open in Mini App', web_app: { url: miniAppUrl } }]] : []
        );
      }

      const adminOtherIds = adminChatIds.filter(
        (id) => id !== seller?.telegramChatId && id !== buyer?.telegramChatId
      );
      if (adminOtherIds.length > 0) {
        const adminText =
          `🛡️ <b>[Admin Monitor] New Order #${order.id}</b>\n` +
          `• Buyer: <b>${order.buyerName}</b> → Seller: <b>${order.sellerName}</b>\n` +
          `• Escrow: <b>${order.usdtAmount.toFixed(2)} USDT</b> (${order.etbAmount.toLocaleString()} ETB via ${order.paymentMethod})`;
        await Promise.all(
          adminOtherIds.map((id) =>
            this.sendTelegramMessage(
              id,
              adminText,
              miniAppUrl ? [[{ text: '🚀 Open Mini App & Admin', web_app: { url: miniAppUrl } }]] : []
            )
          )
        );
      }
    } else if (event === 'PAID') {
      await emailService.notifyOrderPaid(order, seller);
      void this.syncWithTelegramCloud('UPSERT_ORDER', { order });

      const textForSeller =
        `<b>Buyer Marked Order #${order.id} as Paid</b>\n\n` +
        `• Buyer: <b>${order.buyerName}</b>\n` +
        `• Amount: <b>${order.etbAmount.toLocaleString()} ETB</b> (${order.usdtAmount.toFixed(2)} USDT)\n` +
        `• Method: <b>${order.paymentMethod}</b>\n\n` +
        `Check your bank/Telebirr balance first, then release the USDT.`;

      if (seller?.telegramChatId && seller.telegramNotifications !== false) {
        await this.sendTelegramMessage(
          seller.telegramChatId,
          textForSeller,
          miniAppUrl ? [[{ text: 'Open in Mini App', web_app: { url: miniAppUrl } }]] : []
        );
      }

      const adminOtherIds = adminChatIds.filter((id) => id !== seller?.telegramChatId);
      if (adminOtherIds.length > 0) {
        const adminText =
          `💳 <b>[Admin Monitor] Order #${order.id} Marked Paid</b>\n` +
          `• Buyer: <b>${order.buyerName}</b> • Seller: <b>${order.sellerName}</b>\n` +
          `• Amount: <b>${order.etbAmount.toLocaleString()} ETB</b> (${order.usdtAmount.toFixed(2)} USDT)`;
        await Promise.all(
          adminOtherIds.map((id) =>
            this.sendTelegramMessage(
              id,
              adminText,
              miniAppUrl ? [[{ text: '🚀 Open Mini App & Admin', web_app: { url: miniAppUrl } }]] : []
            )
          )
        );
      }
    } else if (event === 'COMPLETED') {
      await emailService.notifyOrderCompleted(order, buyer, seller);
      void this.syncWithTelegramCloud('UPSERT_ORDER', { order });

      const msg =
        `<b>Order #${order.id} Completed</b>\n\n` +
        `<b>${order.usdtAmount.toFixed(2)} USDT</b> has been released to <b>${order.buyerName}</b>.`;

      if (buyer?.telegramChatId && buyer.telegramNotifications !== false) {
        await this.sendTelegramMessage(buyer.telegramChatId, msg);
      }
      if (seller?.telegramChatId && seller.telegramNotifications !== false) {
        await this.sendTelegramMessage(seller.telegramChatId, msg);
      }
    } else if (event === 'CANCELLED') {
      void this.syncWithTelegramCloud('UPSERT_ORDER', { order });
      const msg =
        `<b>Order #${order.id} Cancelled</b>\n\n` +
        `Locked <b>${order.usdtAmount.toFixed(2)} USDT</b> was returned to <b>${order.sellerName}</b>.`;

      if (buyer?.telegramChatId && buyer.telegramNotifications !== false) {
        await this.sendTelegramMessage(buyer.telegramChatId, msg);
      }
      if (seller?.telegramChatId && seller.telegramNotifications !== false) {
        await this.sendTelegramMessage(seller.telegramChatId, msg);
      }
    }
  }

  async sendMerchantApplicationAlert(app: MerchantApplication) {
    await emailService.notifyMerchantApplication(app);
    void this.syncWithTelegramCloud('UPSERT_MERCHANT_APP', { app });

    const miniAppUrl = this.getMiniAppUrl();
    const text =
      `<b>NEW MERCHANT APPLICATION</b>\n` +
      `• User: <b>${app.userName}</b> (${app.userEmail})\n` +
      `• Telegram: ${app.telegramHandle || 'N/A'}\n` +
      `• Wallet: <b>${app.usdtBalance.toFixed(2)} USDT</b>\n` +
      `• ID: ${app.kycDocType} (<code>${app.kycDocNumber}</code>)`;

    this.logEvent({
      id: `tg-${Date.now()}-mch`,
      timestamp: new Date().toISOString(),
      type: 'MERCHANT_REQUEST',
      recipient: process.env.ADMIN_TELEGRAM_USERNAME || 'superadmin',
      text: text.replace(/<[^>]+>/g, ''),
      buttons: [
        { text: 'Approve Merchant', callbackData: `merchant_approve:${app.id}` },
        { text: 'Reject', callbackData: `merchant_reject:${app.id}` },
      ],
      status: 'PENDING',
    });

    const buttons: Array<
      Array<{ text: string; callback_data?: string; web_app?: { url: string }; url?: string }>
    > = [
      [
        { text: '✅ Approve Merchant', callback_data: `merchant_approve:${app.id}` },
        { text: '❌ Reject', callback_data: `merchant_reject:${app.id}` },
      ],
    ];
    if (miniAppUrl) {
      buttons.push([{ text: '🚀 Review in Mini App Admin', web_app: { url: miniAppUrl } }]);
    }

    await this.sendToAllAdmins(text, buttons);
  }

  async sendKycSubmissionAlert(kyc: KycSubmission) {
    await emailService.notifyKycSubmitted(kyc);
    void this.syncWithTelegramCloud('UPSERT_KYC', { kyc });

    const miniAppUrl = this.getMiniAppUrl();
    const text =
      `<b>NEW KYC IDENTITY VERIFICATION</b>\n` +
      `• User: <b>${kyc.userName}</b> (${kyc.userEmail})\n` +
      `• Telegram: ${kyc.telegramHandle || 'N/A'}\n` +
      `• ID Type: <b>${kyc.kycDocType}</b>\n` +
      `• ID Number: <code>${kyc.kycDocNumber}</code>`;

    this.logEvent({
      id: `tg-${Date.now()}-kyc`,
      timestamp: new Date().toISOString(),
      type: 'KYC_REQUEST',
      recipient: process.env.ADMIN_TELEGRAM_USERNAME || 'superadmin',
      text: text.replace(/<[^>]+>/g, ''),
      buttons: [
        { text: 'Approve KYC', callbackData: `kyc_approve:${kyc.id}` },
        { text: 'Reject KYC', callbackData: `kyc_reject:${kyc.id}` },
      ],
      status: 'PENDING',
    });

    const buttons: Array<
      Array<{ text: string; callback_data?: string; web_app?: { url: string }; url?: string }>
    > = [
      [
        { text: '✅ Approve KYC', callback_data: `kyc_approve:${kyc.id}` },
        { text: '❌ Reject KYC', callback_data: `kyc_reject:${kyc.id}` },
      ],
    ];
    if (miniAppUrl) {
      buttons.push([{ text: '🚀 Review in Mini App Admin', web_app: { url: miniAppUrl } }]);
    }

    await this.sendToAllAdmins(text, buttons);
  }

  async sendDisputeAlert(order: P2POrder) {
    await emailService.notifyOrderDisputed(order);
    void this.syncWithTelegramCloud('UPSERT_ORDER', { order });

    const miniAppUrl = this.getMiniAppUrl();
    const targetUserId = order.appealedBy === 'SELLER' ? order.sellerId : order.buyerId;
    const targetUser = await db.getUser(targetUserId);

    const complaintTicket: SupportTicket = {
      id: `sup-ord-${order.id}`,
      userId: targetUserId,
      userName: order.appealedBy === 'SELLER' ? order.sellerName : order.buyerName,
      userEmail: targetUser?.email || '',
      orderId: order.id,
      category: 'ORDER_COMPLAINT',
      subject: `Order #${order.id} Appeal (${order.usdtAmount.toFixed(2)} USDT)`,
      message: order.disputeReason || 'Order complaint opened for admin review.',
      status: 'OPEN',
      source: 'WEB',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.saveSupportTicket(complaintTicket);

    const text =
      `<b>ORDER COMPLAINT / APPEAL #${order.id}</b>\n` +
      `• Buyer: <b>${order.buyerName}</b>\n` +
      `• Seller: <b>${order.sellerName}</b>\n` +
      `• Locked Escrow: <b>${order.usdtAmount.toFixed(2)} USDT</b> (${order.etbAmount.toLocaleString()} ETB)\n` +
      `• Opened By: <b>${order.appealedBy || 'BUYER'}</b>\n` +
      `• Reason: "${order.disputeReason || 'No reason provided'}"`;

    const buttons: Array<
      Array<{ text: string; callback_data?: string; web_app?: { url: string }; url?: string }>
    > = [
      [
        { text: '🔓 Release to Buyer', callback_data: `order_release:${order.id}` },
        { text: '↩️ Refund Seller', callback_data: `order_cancel:${order.id}` },
      ],
    ];
    if (miniAppUrl) {
      buttons.push([{ text: '🚀 Open Mini App Admin', web_app: { url: miniAppUrl } }]);
    }

    await this.sendToAllAdmins(text, buttons);
  }

  async sendSupportTicketAlert(ticket: SupportTicket) {
    await emailService.notifySupportTicket(ticket);
    void this.syncWithTelegramCloud('UPSERT_TICKET', { ticket });

    const miniAppUrl = this.getMiniAppUrl();
    const text =
      `<b>NEW SUPPORT TICKET</b>\n` +
      `• Ticket: <code>${ticket.id}</code>\n` +
      `• From: <b>${ticket.userName}</b> (${ticket.userEmail})\n` +
      `• Order ID: ${ticket.orderId ? `<code>${ticket.orderId}</code>` : 'General'}\n` +
      `• Message: "${ticket.message}"`;

    const buttons: Array<
      Array<{ text: string; callback_data?: string; web_app?: { url: string }; url?: string }>
    > = [];
    if (miniAppUrl) {
      buttons.push([{ text: '🚀 Open Mini App Admin', web_app: { url: miniAppUrl } }]);
    }

    await this.sendToAllAdmins(text, buttons);
  }

  async sendWithdrawalAlert(tx: WalletTransaction, user: User) {
    const miniAppUrl = this.getMiniAppUrl();
    const text =
      `📤 <b>NEW WITHDRAWAL REQUEST</b>\n\n` +
      `• User: <b>${user.name}</b> (${user.email})\n` +
      `• Amount: <b>${tx.amount.toFixed(2)} USDT</b>\n` +
      `• Network: <b>${tx.network}</b>\n` +
      `• Destination: <code>${tx.address || 'N/A'}</code>\n\n` +
      `Review and approve or reject in Admin Console.`;

    const buttons: Array<
      Array<{ text: string; callback_data?: string; web_app?: { url: string }; url?: string }>
    > = [];
    if (miniAppUrl) {
      buttons.push([{ text: '🚀 Open Mini App Admin', web_app: { url: miniAppUrl } }]);
    }

    await this.sendToAllAdmins(text, buttons);
    try {
      const adminEmail = process.env.SUPERADMIN_EMAIL || process.env.ADMIN_EMAIL;
      if (adminEmail) {
        await emailService.sendEmail(
          adminEmail,
          `[Fetan P2P] Withdrawal Request — ${tx.amount.toFixed(2)} USDT (${tx.network})`,
          `<p><strong>${user.name}</strong> (${user.email}) requested a withdrawal of <strong>${tx.amount.toFixed(2)} USDT</strong> via <strong>${tx.network}</strong> to <code>${tx.address || 'N/A'}</code>.</p>`
        );
      }
    } catch {
      // Non-blocking email alert
    }
  }

  async handleMerchantApproval(
    applicationId: string,
    reviewedBy: string,
    approved: boolean
  ): Promise<MerchantApplication> {
    const app = await db.getMerchantApplication(applicationId);
    if (!app) throw new Error('Application not found');

    const newStatus = approved ? 'APPROVED' : 'REJECTED';
    const updatedApp = await db.saveMerchantApplication({
      ...app,
      status: newStatus,
      reviewedBy,
    });

    const user = await db.getUser(app.userId);
    if (approved) {
      await db.updateUser(app.userId, {
        role: user?.role === 'SUPERADMIN' || user?.role === 'ADMIN' ? user.role : 'MERCHANT',
        merchantStatus: 'APPROVED',
        kycStatus: 'VERIFIED',
      });

      wsGateway.emitToUser(app.userId, 'merchant_status_updated', {
        role: 'MERCHANT',
        message: 'Your merchant application is approved! You can now post Buy & Sell ads.',
      });
    } else {
      await db.updateUser(app.userId, { merchantStatus: 'REJECTED' });
    }

    if (user?.telegramChatId) {
      await this.sendTelegramMessage(
        user.telegramChatId,
        approved
          ? `<b>Merchant Status Approved!</b>\nYou can now post Buy & Sell USDT ads on Fetan P2P.`
          : `<b>Merchant Application Update</b>\nYour merchant application was not approved at this time.`
      );
    }

    void this.syncWithTelegramCloud('UPSERT_MERCHANT_APP', { app: updatedApp });
    wsGateway.emitToRoom('admin:dashboard', 'merchant_reviewed', {
      applicationId,
      status: newStatus,
      reviewedBy,
    });

    return updatedApp;
  }

  async handleKycApproval(
    kycId: string,
    reviewedBy: string,
    approved: boolean
  ): Promise<KycSubmission> {
    const kyc = await db.getKycSubmission(kycId);
    if (!kyc) throw new Error('KYC submission not found');

    const newStatus = approved ? 'VERIFIED' : 'REJECTED';
    const updatedKyc = await db.saveKycSubmission({
      ...kyc,
      status: newStatus,
      reviewedBy,
    });

    const user = await db.updateUser(kyc.userId, { kycStatus: newStatus });

    await emailService.notifyKycReviewed(updatedKyc, approved);
    void this.syncWithTelegramCloud('UPSERT_KYC', { kyc: updatedKyc });

    if (user.telegramChatId) {
      await this.sendTelegramMessage(
        user.telegramChatId,
        approved
          ? `<b>Identity Verified (KYC Approved)!</b>\nYour Fetan P2P account is now verified.`
          : `<b>KYC Verification Rejected</b>\nPlease resubmit a clear ID document via the website.`
      );
    }

    wsGateway.emitToUser(kyc.userId, 'kyc_status_updated', {
      status: newStatus,
      message: approved
        ? 'Identity verification approved! You can now trade on Fetan P2P.'
        : 'Identity verification rejected.',
    });

    wsGateway.emitToRoom('admin:dashboard', 'kyc_reviewed', {
      kycId,
      status: newStatus,
      reviewedBy,
    });

    return updatedKyc;
  }

  private logEvent(log: TelegramLog) {
    this.recentLogs.unshift(log);
    if (this.recentLogs.length > 40) this.recentLogs.pop();
  }

  getRecentLogs(): TelegramLog[] {
    return this.recentLogs;
  }

  async handleWebhookUpdate(update: unknown) {
    if (this.bot) {
      await this.bot.handleUpdate(update as Parameters<Telegraf['handleUpdate']>[0]);
    }
  }
}

const globalForTg = global as unknown as { telegramBot?: TelegramBotManager };
export const telegramBot = globalForTg.telegramBot || new TelegramBotManager();
if (process.env.NODE_ENV !== 'production') globalForTg.telegramBot = telegramBot;
