import { Telegraf } from 'telegraf';
import { db } from './database/store';
import { wsGateway } from './websocket-gateway';
import { emailService } from './email-service';
import {
  MerchantApplication,
  KycSubmission,
  P2POrder,
  SupportTicket,
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
      return { authorized: true, label: `@${cleanUser}` };
    }

    if (tgId) {
      const user = await db.getUserByTelegram(String(tgId));
      if (user && isAdminRole(user.role)) {
        return { authorized: true, label: user.telegramHandle || user.name };
      }
    }

    return { authorized: false, label: '' };
  }

  private initBot(token: string) {
    try {
      this.bot = new Telegraf(token);
      void this.setupBotMenuButton();

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
            { command: 'start', description: 'Open Fetan P2P Platform' },
            { command: 'app', description: 'Launch Mini App' },
            { command: 'kyc', description: 'Verify Your Identity' },
            { command: 'merchant', description: 'Apply as Merchant' },
            { command: 'support', description: 'Support & Complaints' },
            { command: 'admin', description: 'Admin Dashboard' },
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

  async broadcastAdminAlert(message: string): Promise<boolean> {
    const superChatId = await this.getSuperadminChatId();
    if (!superChatId) return false;
    return this.sendTelegramMessage(superChatId, message);
  }

  async sendMessage(chatId: string | number, message: string): Promise<boolean> {
    return this.sendTelegramMessage(chatId, message);
  }

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
      // Non-blocking sync
    }
    return null;
  }

  private async getSuperadminChatId(): Promise<string | undefined> {
    const superUser = await db.getSuperadminUser();
    return superUser?.telegramChatId || process.env.TELEGRAM_ADMIN_CHAT_ID;
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

    const superChatId = await this.getSuperadminChatId();
    if (superChatId) {
      await this.sendTelegramMessage(superChatId, text, [
        [
          { text: 'Approve Merchant', callback_data: `merchant_approve:${app.id}` },
          { text: 'Reject', callback_data: `merchant_reject:${app.id}` },
        ],
      ]);
    }
  }

  async sendKycSubmissionAlert(kyc: KycSubmission) {
    await emailService.notifyKycSubmitted(kyc);
    void this.syncWithTelegramCloud('UPSERT_KYC', { kyc });

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

    const superChatId = await this.getSuperadminChatId();
    if (superChatId) {
      await this.sendTelegramMessage(superChatId, text, [
        [
          { text: 'Approve KYC', callback_data: `kyc_approve:${kyc.id}` },
          { text: 'Reject KYC', callback_data: `kyc_reject:${kyc.id}` },
        ],
      ]);
    }
  }

  async sendDisputeAlert(order: P2POrder) {
    await emailService.notifyOrderDisputed(order);
    void this.syncWithTelegramCloud('UPSERT_ORDER', { order });

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

    const superChatId = await this.getSuperadminChatId();
    if (superChatId) {
      await this.sendTelegramMessage(superChatId, text);
    }
  }

  async sendSupportTicketAlert(ticket: SupportTicket) {
    await emailService.notifySupportTicket(ticket);
    void this.syncWithTelegramCloud('UPSERT_TICKET', { ticket });

    const text =
      `<b>NEW SUPPORT TICKET</b>\n` +
      `• Ticket: <code>${ticket.id}</code>\n` +
      `• From: <b>${ticket.userName}</b> (${ticket.userEmail})\n` +
      `• Order ID: ${ticket.orderId ? `<code>${ticket.orderId}</code>` : 'General'}\n` +
      `• Message: "${ticket.message}"`;

    const superChatId = await this.getSuperadminChatId();
    if (superChatId) {
      await this.sendTelegramMessage(superChatId, text);
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
