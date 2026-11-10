import { Telegraf } from 'telegraf';
import { db } from './database/store';
import { wsGateway } from './websocket-gateway';
import { emailService } from './email-service';
import {
  MerchantApplication,
  KycSubmission,
  P2POrder,
  SupportTicket,
  User,
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

  private initBot(token: string) {
    try {
      this.bot = new Telegraf(token);

      this.bot.action(/^approve_merchant:(.+)$/, async (ctx) => {
        const applicationId = ctx.match[1];
        await this.handleMerchantApproval(applicationId, '@kanzedin', true);
        await ctx.answerCbQuery('Merchant Approved');
      });

      this.bot.action(/^reject_merchant:(.+)$/, async (ctx) => {
        const applicationId = ctx.match[1];
        await this.handleMerchantApproval(applicationId, '@kanzedin', false);
        await ctx.answerCbQuery('Merchant Rejected');
      });

      this.bot.action(/^approve_kyc:(.+)$/, async (ctx) => {
        const kycId = ctx.match[1];
        await this.handleKycApproval(kycId, '@kanzedin', true);
        await ctx.answerCbQuery('KYC Approved');
      });

      this.bot.action(/^reject_kyc:(.+)$/, async (ctx) => {
        const kycId = ctx.match[1];
        await this.handleKycApproval(kycId, '@kanzedin', false);
        await ctx.answerCbQuery('KYC Rejected');
      });
    } catch (err) {
      console.error('Failed to initialize Telegram Bot:', err);
    }
  }

  /**
   * Direct Telegram Bot API message sender with Inline Buttons & Mini App link
   */
  async sendTelegramMessage(
    chatId: string | number | undefined,
    text: string,
    inlineKeyboard: Array<Array<{ text: string; callback_data?: string; web_app?: { url: string }; url?: string }>> = []
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

  /**
   * Sync shared database state & notifications with Telegram Serverless Cloud (TGCloud)
   */
  async syncWithTelegramCloud(action: string, payload: Record<string, unknown> = {}) {
    const cloudToken = this.getTgCloudToken();
    if (!cloudToken) return null;
    const appId = cloudToken.split(':')[0];
    const miniAppHost = `https://${appId}.tgcloud.ai`;

    try {
      const res = await fetch(`${miniAppHost}/api/syncWeb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: cloudToken,
          action,
          payload,
        }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Cloud sync is non-blocking so local web operations remain instant
    }
    return null;
  }

  private getSuperadminChatId(): string | undefined {
    const superUser = db.getSuperadminUser();
    return superUser?.telegramChatId || process.env.TELEGRAM_ADMIN_CHAT_ID;
  }

  /**
   * Notify Merchant & Buyer on Telegram when a new Order is created (if they enabled notifications)
   */
  async sendOrderNotification(
    order: P2POrder,
    event: 'CREATED' | 'PAID' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED'
  ) {
    const buyer = db.getUser(order.buyerId);
    const seller = db.getUser(order.sellerId);
    const miniAppUrl = this.getMiniAppUrl();

    if (event === 'CREATED') {
      await emailService.notifyOrderCreated(order, buyer, seller);
      // Sync order to Telegram Serverless DB
      void this.syncWithTelegramCloud('UPSERT_ORDER', { order });

      const textForSeller =
        `🔔 <b>New P2P Order #${order.id}</b>\n\n` +
        `• Buyer: <b>${order.buyerName}</b>\n` +
        `• Amount: <b>${order.usdtAmount.toFixed(2)} USDT</b> (${order.etbAmount.toLocaleString()} ETB)\n` +
        `• Method: <b>${order.paymentMethod}</b> (${order.paymentDetails.accountNumber})\n` +
        `• Status: Waiting for buyer to send Birr`;

      const buttons = [
        { text: 'Open Order in Mini App', callbackData: `order_view:${order.id}` },
      ];

      this.logEvent({
        id: `tg-${Date.now()}-ord`,
        timestamp: new Date().toISOString(),
        type: 'ORDER_ALERT',
        recipient: seller?.telegramHandle || order.sellerName,
        text: textForSeller.replace(/<[^>]+>/g, ''),
        buttons,
        status: 'DELIVERED',
      });

      if (seller?.telegramChatId && seller.telegramNotifications !== false) {
        await this.sendTelegramMessage(seller.telegramChatId, textForSeller, [
          [{ text: '📱 Open in Mini App', web_app: { url: miniAppUrl } }],
          [{ text: '📋 View Order Status', callback_data: `order_view:${order.id}` }],
        ]);
      }

      if (buyer?.telegramChatId && buyer.telegramNotifications !== false) {
        const textForBuyer =
          `✅ <b>Order #${order.id} Created</b>\n\n` +
          `<b>${order.usdtAmount.toFixed(2)} USDT</b> is locked in escrow.\n` +
          `Send <b>${order.etbAmount.toLocaleString()} ETB</b> via <b>${order.paymentMethod}</b> to:\n` +
          `• Account: <code>${order.paymentDetails.accountNumber}</code>\n` +
          `• Name: <b>${order.paymentDetails.accountName}</b>`;
        await this.sendTelegramMessage(buyer.telegramChatId, textForBuyer, [
          [
            { text: '✅ I Have Paid', callback_data: `order_paid:${order.id}` },
            { text: '❌ Cancel Order', callback_data: `order_cancel:${order.id}` },
          ],
          [{ text: '📱 Open in Mini App', web_app: { url: miniAppUrl } }],
        ]);
      }
    } else if (event === 'PAID') {
      await emailService.notifyOrderPaid(order, seller);
      void this.syncWithTelegramCloud('UPSERT_ORDER', { order });

      const textForSeller =
        `💸 <b>Buyer Marked Order #${order.id} as Paid!</b>\n\n` +
        `• Buyer: <b>${order.buyerName}</b>\n` +
        `• Amount: <b>${order.etbAmount.toLocaleString()} ETB</b> (${order.usdtAmount.toFixed(2)} USDT)\n` +
        `• Method: <b>${order.paymentMethod}</b>\n\n` +
        `Check your bank/Telebirr balance first, then release the USDT.`;

      this.logEvent({
        id: `tg-${Date.now()}-paid`,
        timestamp: new Date().toISOString(),
        type: 'ORDER_ALERT',
        recipient: seller?.telegramHandle || order.sellerName,
        text: textForSeller.replace(/<[^>]+>/g, ''),
        buttons: [
          { text: '🔓 Release USDT', callbackData: `order_release:${order.id}` },
          { text: '⚠️ Open Complaint', callbackData: `order_appeal:${order.id}` },
        ],
        status: 'PENDING',
      });

      if (seller?.telegramChatId && seller.telegramNotifications !== false) {
        await this.sendTelegramMessage(seller.telegramChatId, textForSeller, [
          [
            { text: '🔓 Confirm & Release USDT', callback_data: `order_release:${order.id}` },
            { text: '⚠️ Appeal', callback_data: `order_appeal:${order.id}` },
          ],
          [{ text: '📱 Open in Mini App', web_app: { url: miniAppUrl } }],
        ]);
      }
    } else if (event === 'COMPLETED') {
      await emailService.notifyOrderCompleted(order, buyer, seller);
      void this.syncWithTelegramCloud('UPSERT_ORDER', { order });

      const msg =
        `🎉 <b>Order #${order.id} Completed</b>\n\n` +
        `<b>${order.usdtAmount.toFixed(2)} USDT</b> has been released to <b>${order.buyerName}</b>.`;

      if (buyer?.telegramChatId && buyer.telegramNotifications !== false) {
        await this.sendTelegramMessage(buyer.telegramChatId, msg, [
          [{ text: '📱 Open Wallet in Mini App', web_app: { url: miniAppUrl } }],
        ]);
      }
      if (seller?.telegramChatId && seller.telegramNotifications !== false) {
        await this.sendTelegramMessage(seller.telegramChatId, msg);
      }
    } else if (event === 'CANCELLED') {
      void this.syncWithTelegramCloud('UPSERT_ORDER', { order });
      const msg =
        `↩️ <b>Order #${order.id} Cancelled</b>\n\n` +
        `Locked <b>${order.usdtAmount.toFixed(2)} USDT</b> was returned to <b>${order.sellerName}</b>.`;

      if (buyer?.telegramChatId && buyer.telegramNotifications !== false) {
        await this.sendTelegramMessage(buyer.telegramChatId, msg);
      }
      if (seller?.telegramChatId && seller.telegramNotifications !== false) {
        await this.sendTelegramMessage(seller.telegramChatId, msg);
      }
    }
  }

  /**
   * Send Merchant Application Alert with Inline Buttons to Superadmin (@kanzedin)
   */
  async sendMerchantApplicationAlert(app: MerchantApplication) {
    await emailService.notifyMerchantApplication(app);
    void this.syncWithTelegramCloud('UPSERT_MERCHANT_APP', { app });

    const text =
      `🏪 <b>NEW MERCHANT APPLICATION</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• User: <b>${app.userName}</b> (${app.userEmail})\n` +
      `• Telegram: ${app.telegramHandle || 'N/A'}\n` +
      `• Wallet: <b>${app.usdtBalance.toFixed(2)} USDT</b>\n` +
      `• ID: ${app.kycDocType} (<code>${app.kycDocNumber}</code>)`;

    const buttons = [
      { text: '✅ Approve Merchant', callbackData: `approve_merchant:${app.id}` },
      { text: '❌ Reject', callbackData: `reject_merchant:${app.id}` },
    ];

    this.logEvent({
      id: `tg-${Date.now()}-mch`,
      timestamp: new Date().toISOString(),
      type: 'MERCHANT_REQUEST',
      recipient: '@kanzedin',
      text: text.replace(/<[^>]+>/g, ''),
      buttons,
      status: 'PENDING',
    });

    const superChatId = this.getSuperadminChatId();
    if (superChatId) {
      await this.sendTelegramMessage(superChatId, text, [
        [
          { text: '✅ Approve Merchant', callback_data: `merchant_approve:${app.id}` },
          { text: '❌ Reject', callback_data: `merchant_reject:${app.id}` },
        ],
        [{ text: '🛡️ Open Superadmin Mini App', web_app: { url: this.getMiniAppUrl() } }],
      ]);
    }
  }

  /**
   * Send KYC Submission Alert with Inline Buttons to Superadmin (@kanzedin)
   */
  async sendKycSubmissionAlert(kyc: KycSubmission) {
    await emailService.notifyKycSubmitted(kyc);
    void this.syncWithTelegramCloud('UPSERT_KYC', { kyc });

    const text =
      `🪪 <b>NEW KYC IDENTITY VERIFICATION</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• User: <b>${kyc.userName}</b> (${kyc.userEmail})\n` +
      `• Telegram: ${kyc.telegramHandle || 'N/A'}\n` +
      `• ID Type: <b>${kyc.kycDocType}</b>\n` +
      `• ID Number: <code>${kyc.kycDocNumber}</code>\n` +
      `• Source: ${kyc.source || 'WEB'}`;

    const buttons = [
      { text: '✅ Approve KYC', callbackData: `approve_kyc:${kyc.id}` },
      { text: '❌ Reject KYC', callbackData: `reject_kyc:${kyc.id}` },
    ];

    this.logEvent({
      id: `tg-${Date.now()}-kyc`,
      timestamp: new Date().toISOString(),
      type: 'KYC_REQUEST',
      recipient: '@kanzedin',
      text: text.replace(/<[^>]+>/g, ''),
      buttons,
      status: 'PENDING',
    });

    const superChatId = this.getSuperadminChatId();
    if (superChatId) {
      await this.sendTelegramMessage(superChatId, text, [
        [
          { text: '✅ Approve KYC', callback_data: `kyc_approve:${kyc.id}` },
          { text: '❌ Reject KYC', callback_data: `kyc_reject:${kyc.id}` },
        ],
        [{ text: '🛡️ Open Superadmin Mini App', web_app: { url: this.getMiniAppUrl() } }],
      ]);
    }
  }

  /**
   * Send Order Complaint / Dispute Alert to Superadmin (@kanzedin) with Direct Action Buttons
   */
  async sendDisputeAlert(order: P2POrder) {
    await emailService.notifyOrderDisputed(order);
    void this.syncWithTelegramCloud('UPSERT_ORDER', { order });

    // Also create a support ticket record for the complaint
    const complaintTicket: SupportTicket = {
      id: `sup-ord-${order.id}`,
      userId: order.appealedBy === 'SELLER' ? order.sellerId : order.buyerId,
      userName: order.appealedBy === 'SELLER' ? order.sellerName : order.buyerName,
      userEmail: db.getUser(order.appealedBy === 'SELLER' ? order.sellerId : order.buyerId)?.email || '',
      orderId: order.id,
      category: 'ORDER_COMPLAINT',
      subject: `Order #${order.id} Appeal (${order.usdtAmount.toFixed(2)} USDT)`,
      message: order.disputeReason || 'Order complaint opened for admin review.',
      status: 'OPEN',
      source: 'WEB',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.saveSupportTicket(complaintTicket);

    const text =
      `🚨 <b>ORDER COMPLAINT / APPEAL #${order.id}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• Buyer: <b>${order.buyerName}</b>\n` +
      `• Seller: <b>${order.sellerName}</b>\n` +
      `• Locked Escrow: <b>${order.usdtAmount.toFixed(2)} USDT</b> (${order.etbAmount.toLocaleString()} ETB)\n` +
      `• Opened By: <b>${order.appealedBy || 'BUYER'}</b>\n` +
      `• Reason: "${order.disputeReason || 'No reason provided'}"`;

    const buttons = [
      { text: '🔓 Release USDT to Buyer', callbackData: `admin_release:${order.id}` },
      { text: '↩️ Cancel & Refund Seller', callbackData: `admin_cancel:${order.id}` },
    ];

    this.logEvent({
      id: `tg-${Date.now()}-disp`,
      timestamp: new Date().toISOString(),
      type: 'DISPUTE_ALERT',
      recipient: '@kanzedin',
      text: text.replace(/<[^>]+>/g, ''),
      buttons,
      status: 'PENDING',
    });

    const superChatId = this.getSuperadminChatId();
    if (superChatId) {
      await this.sendTelegramMessage(superChatId, text, [
        [
          { text: '🔓 Release to Buyer', callback_data: `order_release:${order.id}` },
          { text: '↩️ Cancel & Return to Seller', callback_data: `order_cancel:${order.id}` },
        ],
        [{ text: '🛡️ Open Superadmin Mini App', web_app: { url: this.getMiniAppUrl() } }],
      ]);
    }
  }

  /**
   * Send General Support / Order Complaint Ticket Alert to Superadmin (@kanzedin)
   */
  async sendSupportTicketAlert(ticket: SupportTicket) {
    await emailService.notifySupportTicket(ticket);
    void this.syncWithTelegramCloud('UPSERT_TICKET', { ticket });

    const text =
      `💬 <b>NEW SUPPORT / COMPLAINT TICKET</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• Ticket: <code>${ticket.id}</code>\n` +
      `• From: <b>${ticket.userName}</b> (${ticket.userEmail})\n` +
      `• Telegram: ${ticket.telegramHandle || 'N/A'}\n` +
      `• Order ID: ${ticket.orderId ? `<code>${ticket.orderId}</code>` : 'General'}\n` +
      `• Category: <b>${ticket.category}</b>\n` +
      `• Message: "${ticket.message}"`;

    const buttons = ticket.orderId
      ? [
        { text: '🔓 Release Order to Buyer', callbackData: `admin_release:${ticket.orderId}` },
        { text: '↩️ Cancel Order for Seller', callbackData: `admin_cancel:${ticket.orderId}` },
      ]
      : [{ text: '✅ Mark Ticket Resolved', callbackData: `resolve_ticket:${ticket.id}` }];

    this.logEvent({
      id: `tg-${Date.now()}-sup`,
      timestamp: new Date().toISOString(),
      type: 'SUPPORT_TICKET',
      recipient: '@kanzedin',
      text: text.replace(/<[^>]+>/g, ''),
      buttons,
      status: 'PENDING',
    });

    const superChatId = this.getSuperadminChatId();
    if (superChatId) {
      await this.sendTelegramMessage(superChatId, text, [
        ticket.orderId
          ? [
            { text: '🔓 Release to Buyer', callback_data: `order_release:${ticket.orderId}` },
            { text: '↩️ Cancel Order', callback_data: `order_cancel:${ticket.orderId}` },
          ]
          : [{ text: '✅ Mark Resolved', callback_data: `ticket_resolve:${ticket.id}` }],
        [{ text: '🛡️ Open Superadmin Mini App', web_app: { url: this.getMiniAppUrl() } }],
      ]);
    }
  }

  /**
   * Universal Handlers for both Web Dashboard & Telegram Bot Callbacks
   */
  async handleMerchantApproval(
    applicationId: string,
    reviewedBy: string,
    approved: boolean
  ): Promise<MerchantApplication> {
    const app = db.getMerchantApplication(applicationId);
    if (!app) throw new Error('Application not found');

    const newStatus = approved ? 'APPROVED' : 'REJECTED';
    app.status = newStatus;
    app.reviewedBy = reviewedBy;
    db.saveMerchantApplication(app);

    const user = db.getUser(app.userId);
    if (approved) {
      db.updateUser(app.userId, { role: 'MERCHANT', kycStatus: 'VERIFIED' });

      wsGateway.emitToUser(app.userId, 'merchant_status_updated', {
        role: 'MERCHANT',
        message: 'Your merchant application is approved! You can now post Buy & Sell ads.',
      });
    }

    if (user?.telegramChatId) {
      await this.sendTelegramMessage(
        user.telegramChatId,
        approved
          ? `🎉 <b>Merchant Status Approved!</b>\nYou can now post Buy & Sell USDT ads on Fetan P2P and receive instant order alerts here.`
          : `❌ <b>Merchant Application Update</b>\nYour merchant application was not approved at this time.`
      );
    }

    void this.syncWithTelegramCloud('UPSERT_MERCHANT_APP', { app });

    wsGateway.emitToRoom('admin:dashboard', 'merchant_reviewed', {
      applicationId,
      status: newStatus,
      reviewedBy,
    });

    return app;
  }

  async handleKycApproval(
    kycId: string,
    reviewedBy: string,
    approved: boolean
  ): Promise<KycSubmission> {
    const kyc = db.getKycSubmission(kycId);
    if (!kyc) throw new Error('KYC submission not found');

    const newStatus = approved ? 'VERIFIED' : 'REJECTED';
    kyc.status = newStatus;
    kyc.reviewedBy = reviewedBy;
    db.saveKycSubmission(kyc);

    db.updateUser(kyc.userId, { kycStatus: newStatus });

    await emailService.notifyKycReviewed(kyc, approved);
    void this.syncWithTelegramCloud('UPSERT_KYC', { kyc });

    const user = db.getUser(kyc.userId);
    if (user?.telegramChatId) {
      await this.sendTelegramMessage(
        user.telegramChatId,
        approved
          ? `✅ <b>Identity Verified (KYC Approved)!</b>\nYour Fetan P2P account is now verified. You can buy and sell USDT anytime.`
          : `❌ <b>KYC Verification Rejected</b>\nPlease submit a clear ID number and document via the website or type <code>/kyc</code> here.`
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

    return kyc;
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
