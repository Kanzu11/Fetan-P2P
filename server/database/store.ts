import {
  User,
  P2POffer,
  P2POrder,
  MerchantApplication,
  KycSubmission,
  ChatMessage,
  PaymentMethod,
  SupportTicket,
  WalletTransaction,
  OPEN_ORDER_STATUSES,
} from '../../client/types';
import { generateUserDepositAddresses } from '../crypto-address-service';

/**
 * In-memory row locks. Emulates Postgres `SELECT ... FOR UPDATE`.
 * Keys are always taken in sorted order so two requests can never deadlock.
 */
class RowLockManager {
  private locks: Map<string, Promise<void>> = new Map();

  async acquire(key: string): Promise<() => void> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }
    let release: () => void = () => {};
    const p = new Promise<void>((resolve) => {
      release = () => {
        this.locks.delete(key);
        resolve();
      };
    });
    this.locks.set(key, p);
    return release;
  }
}

const rowLocks = new RowLockManager();

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60 * 1000).toISOString();

export class DatabaseStore {
  private users: Map<string, User> = new Map();
  private offers: Map<string, P2POffer> = new Map();
  private orders: Map<string, P2POrder> = new Map();
  private merchantApplications: Map<string, MerchantApplication> = new Map();
  private kycSubmissions: Map<string, KycSubmission> = new Map();
  private supportTickets: Map<string, SupportTicket> = new Map();
  private chatMessages: Map<string, ChatMessage[]> = new Map();
  private walletTransactions: Map<string, WalletTransaction> = new Map();
  private orderSeq = 200;

  constructor() {
    this.seed();
  }

  private seed() {
    const superAdminEmail = process.env.SUPERADMIN_EMAIL || process.env.ADMIN_EMAIL || 'superadmin@fetan.et';
    const superAdminTg = (process.env.ADMIN_TELEGRAM_USERNAME || 'kanzedin').replace(/^@/, '');

    const seedUsers: User[] = [
      {
        id: 'usr-buyer-dawit',
        email: 'dawit@fetan.et',
        name: 'Dawit Mekonnen',
        nickname: 'Dawit_M',
        telegramHandle: '@dawit_mek',
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-DAWIT-101',
        phone: '+251911445566',
        role: 'USER',
        kycStatus: 'VERIFIED',
        kycDocType: 'NATIONAL_ID',
        kycDocNumber: 'FAYDA-9281-4402',
        usdtBalance: 245.5,
        usdtLocked: 0,
        completedTrades: 38,
        completionRate: 100,
        avgReleaseTimeMins: 2,
        positiveFeedback: 37,
        negativeFeedback: 0,
        createdAt: '2026-08-10T09:00:00Z',
        updatedAt: '2026-09-10T12:00:00Z',
        paymentDetails: {
          telebirr: '0911445566',
          cbeAccount: '1000223344556',
          abyssiniaAccount: '88201944',
        },
      },
      {
        id: 'usr-merchant-alazar',
        email: 'alazar@fetan.et',
        name: 'Alazar Haile',
        nickname: 'Alazar_FX',
        telegramHandle: '@alazar_fx',
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-ALAZAR-202',
        phone: '+251911234567',
        role: 'MERCHANT',
        kycStatus: 'VERIFIED',
        kycDocType: 'PASSPORT',
        kycDocNumber: 'EP-492019',
        usdtBalance: 4850,
        usdtLocked: 100, // open order 20261109000101
        completedTrades: 1420,
        completionRate: 99.7,
        avgReleaseTimeMins: 1,
        positiveFeedback: 1398,
        negativeFeedback: 4,
        createdAt: '2026-06-01T08:00:00Z',
        updatedAt: '2026-09-10T11:00:00Z',
        paymentDetails: {
          telebirr: '0911234567',
          cbeAccount: '1000123456789',
          abyssiniaAccount: '91028374',
          awashAccount: '01320987654321',
          cbeBirr: '0911234567',
        },
      },
      {
        id: 'usr-merchant-addis',
        email: 'bethelhem@fetan.et',
        name: 'Bethelhem Tedros',
        nickname: 'Addis_Prime',
        telegramHandle: '@addis_prime',
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-ADDIS-303',
        phone: '+251922987654',
        role: 'MERCHANT',
        kycStatus: 'VERIFIED',
        kycDocType: 'NATIONAL_ID',
        kycDocNumber: 'FAYDA-8819-2041',
        usdtBalance: 12400,
        usdtLocked: 120, // order under appeal 20261109000105
        completedTrades: 3180,
        completionRate: 99.9,
        avgReleaseTimeMins: 1,
        positiveFeedback: 3122,
        negativeFeedback: 6,
        createdAt: '2026-05-15T10:00:00Z',
        updatedAt: '2026-09-10T14:30:00Z',
        paymentDetails: {
          telebirr: '0922987654',
          cbeAccount: '1000987654321',
          abyssiniaAccount: '77419200',
          awashAccount: '01321122334455',
          cbeBirr: '0922987654',
        },
      },
      {
        id: 'usr-merchant-bole',
        email: 'nahom@fetan.et',
        name: 'Nahom Tadesse',
        nickname: 'Bole_Capital',
        telegramHandle: '@bole_capital',
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-BOLE-404',
        phone: '+251912889900',
        role: 'MERCHANT',
        kycStatus: 'VERIFIED',
        kycDocType: 'PASSPORT',
        kycDocNumber: 'EP-819204',
        usdtBalance: 18500,
        usdtLocked: 0,
        completedTrades: 2150,
        completionRate: 99.4,
        avgReleaseTimeMins: 2,
        positiveFeedback: 2101,
        negativeFeedback: 11,
        createdAt: '2026-04-20T09:00:00Z',
        updatedAt: '2026-09-10T15:00:00Z',
        paymentDetails: {
          telebirr: '0912889900',
          cbeAccount: '1000445566778',
          abyssiniaAccount: '55192837',
          dashenAccount: '5029881726354',
        },
      },
      {
        id: 'usr-admin-selam',
        email: 'admin@fetan.et',
        name: 'Selamawit Tadesse',
        nickname: 'Fetan Support',
        telegramHandle: '@selam_admin',
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-ADMIN-505',
        role: 'ADMIN',
        kycStatus: 'VERIFIED',
        kycDocType: 'NATIONAL_ID',
        kycDocNumber: 'FAYDA-1102-9944',
        usdtBalance: 50,
        usdtLocked: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-09-10T08:00:00Z',
      },
      {
        id: 'usr-super-yared',
        email: superAdminEmail,
        name: 'Kanzedin Akmel',
        nickname: 'Kanzedin (Superadmin)',
        telegramHandle: `@${superAdminTg}`,
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-KANZEDIN-999',
        role: 'SUPERADMIN',
        kycStatus: 'VERIFIED',
        kycDocType: 'PASSPORT',
        kycDocNumber: 'EP-100293',
        usdtBalance: 5000,
        usdtLocked: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-09-10T08:00:00Z',
      },
      {
        id: 'usr-app-kaleb',
        email: 'kaleb@fetan.et',
        name: 'Kaleb Abebe',
        nickname: 'Kaleb_A',
        telegramHandle: '@kaleb_trader',
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-KALEB-606',
        role: 'USER',
        kycStatus: 'VERIFIED',
        kycDocType: 'DRIVERS_LICENSE',
        kycDocNumber: 'DL-ET-98210',
        usdtBalance: 45.2,
        usdtLocked: 0,
        completedTrades: 6,
        completionRate: 100,
        createdAt: '2026-09-01T12:00:00Z',
        updatedAt: '2026-09-10T16:00:00Z',
        paymentDetails: { telebirr: '0933221100' },
      },
      {
        id: 'usr-app-marta',
        email: 'marta@fetan.et',
        name: 'Marta Girma',
        nickname: 'Marta_G',
        telegramHandle: '@marta_g',
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-MARTA-707',
        role: 'USER',
        kycStatus: 'VERIFIED',
        kycDocType: 'NATIONAL_ID',
        kycDocNumber: 'FAYDA-3921-1188',
        usdtBalance: 6.5,
        usdtLocked: 0,
        createdAt: '2026-09-05T09:30:00Z',
        updatedAt: '2026-09-10T17:00:00Z',
      },
      {
        id: 'usr-new-hana',
        email: 'hana@fetan.et',
        name: 'Hana Wolde',
        nickname: 'Hana_W',
        telegramHandle: '@hana_wolde',
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-HANA-808',
        role: 'USER',
        kycStatus: 'UNVERIFIED',
        usdtBalance: 120,
        usdtLocked: 0,
        createdAt: '2026-11-01T09:30:00Z',
        updatedAt: '2026-11-01T09:30:00Z',
        paymentDetails: { telebirr: '0944556677' },
      },
      {
        id: 'usr-tigist',
        email: 'tigist@fetan.et',
        name: 'Tigist Assefa',
        telegramHandle: '@tigist_a',
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-TIGIST-901',
        role: 'USER',
        kycStatus: 'PENDING',
        kycDocType: 'NATIONAL_ID',
        kycDocNumber: 'FAYDA-7721-9921',
        usdtBalance: 0,
        usdtLocked: 0,
        createdAt: '2026-11-05T09:30:00Z',
        updatedAt: '2026-11-05T09:30:00Z',
      },
      {
        id: 'usr-yohannes',
        email: 'yohannes@fetan.et',
        name: 'Yohannes Tefera',
        telegramHandle: '@yohannes_t',
        telegramNotifications: true,
        telegramLinkCode: 'FETAN-YOHANNES-902',
        role: 'USER',
        kycStatus: 'PENDING',
        kycDocType: 'PASSPORT',
        kycDocNumber: 'EP-902188',
        usdtBalance: 0,
        usdtLocked: 0,
        createdAt: '2026-11-06T09:30:00Z',
        updatedAt: '2026-11-06T09:30:00Z',
      },
    ];
    seedUsers.forEach((u) => {
      u.depositAddresses = generateUserDepositAddresses(u.id);
      this.users.set(u.id, u);
    });

    const seedOffers: P2POffer[] = [
      {
        id: 'off-alazar-sell',
        merchantId: 'usr-merchant-alazar',
        merchantName: 'Alazar_FX',
        completedTrades: 1420,
        completionRate: 99.7,
        avgReleaseTimeMins: 1,
        offerType: 'SELL',
        pricePerUsdtEtb: 158.35,
        minLimitEtb: 500,
        maxLimitEtb: 75000,
        totalAvailable: 1250,
        paymentMethods: ['TELEBIRR', 'CBE', 'CBE_BIRR'],
        terms:
          'I release fast. Send from an account in your own name. Leave the payment reason empty. Do not write "USDT" or "crypto".',
        isActive: true,
        createdAt: '2026-09-10T08:00:00Z',
      },
      {
        id: 'off-addis-sell',
        merchantId: 'usr-merchant-addis',
        merchantName: 'Addis_Prime',
        completedTrades: 3180,
        completionRate: 99.9,
        avgReleaseTimeMins: 1,
        offerType: 'SELL',
        pricePerUsdtEtb: 158.6,
        minLimitEtb: 2000,
        maxLimitEtb: 300000,
        totalAvailable: 4800,
        paymentMethods: ['TELEBIRR', 'CBE', 'ABYSSINIA', 'AWASH'],
        terms: 'Payments from another person’s account will be sent back. Please upload your receipt.',
        isActive: true,
        createdAt: '2026-09-10T09:15:00Z',
      },
      {
        id: 'off-bole-sell',
        merchantId: 'usr-merchant-bole',
        merchantName: 'Bole_Capital',
        completedTrades: 2150,
        completionRate: 99.4,
        avgReleaseTimeMins: 2,
        offerType: 'SELL',
        pricePerUsdtEtb: 158.85,
        minLimitEtb: 10000,
        maxLimitEtb: 850000,
        totalAvailable: 9500,
        paymentMethods: ['CBE', 'ABYSSINIA', 'DASHEN'],
        terms: 'Large orders welcome. Bank transfer only.',
        isActive: true,
        createdAt: '2026-09-10T10:00:00Z',
      },
      {
        id: 'off-addis-buy',
        merchantId: 'usr-merchant-addis',
        merchantName: 'Addis_Prime',
        completedTrades: 3180,
        completionRate: 99.9,
        avgReleaseTimeMins: 1,
        offerType: 'BUY',
        pricePerUsdtEtb: 157.4,
        minLimitEtb: 1000,
        maxLimitEtb: 250000,
        totalAvailable: 5000,
        paymentMethods: ['TELEBIRR', 'CBE', 'ABYSSINIA', 'AWASH'],
        terms: 'I pay within 5 minutes. Your account name must match your Fetan name.',
        isActive: true,
        createdAt: '2026-09-10T09:40:00Z',
      },
      {
        id: 'off-alazar-buy',
        merchantId: 'usr-merchant-alazar',
        merchantName: 'Alazar_FX',
        completedTrades: 1420,
        completionRate: 99.7,
        avgReleaseTimeMins: 1,
        offerType: 'BUY',
        pricePerUsdtEtb: 157.15,
        minLimitEtb: 500,
        maxLimitEtb: 90000,
        totalAvailable: 2200,
        paymentMethods: ['TELEBIRR', 'CBE', 'CBE_BIRR'],
        terms: 'Fast Telebirr and CBE payout.',
        isActive: true,
        createdAt: '2026-09-10T08:30:00Z',
      },
      {
        id: 'off-bole-buy',
        merchantId: 'usr-merchant-bole',
        merchantName: 'Bole_Capital',
        completedTrades: 2150,
        completionRate: 99.4,
        avgReleaseTimeMins: 2,
        offerType: 'BUY',
        pricePerUsdtEtb: 156.9,
        minLimitEtb: 15000,
        maxLimitEtb: 600000,
        totalAvailable: 8000,
        paymentMethods: ['CBE', 'ABYSSINIA', 'AWASH', 'DASHEN'],
        terms: 'Bank transfer only.',
        isActive: true,
        createdAt: '2026-09-10T11:00:00Z',
      },
    ];
    seedOffers.forEach((o) => this.offers.set(o.id, o));

    const openOrder: P2POrder = {
      id: '20261109000101',
      offerId: 'off-alazar-sell',
      offerType: 'SELL',
      buyerId: 'usr-buyer-dawit',
      buyerName: 'Dawit_M',
      sellerId: 'usr-merchant-alazar',
      sellerName: 'Alazar_FX',
      usdtAmount: 100,
      etbAmount: 15835,
      unitPriceEtb: 158.35,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'TELEBIRR',
      paymentDetails: {
        method: 'TELEBIRR',
        accountNumber: '0911234567',
        accountName: 'Alazar Haile',
        bankName: 'Telebirr',
      },
      expiresAt: minutesFromNow(14),
      createdAt: minutesAgo(1),
      updatedAt: minutesAgo(1),
      auditLogs: [
        { id: 'log-101-1', timestamp: minutesAgo(1), actor: 'SYSTEM', message: 'Order created. 100.00 USDT from the seller is locked.' },
      ],
    };

    const completedOrder: P2POrder = {
      id: '20261108000098',
      offerId: 'off-addis-sell',
      offerType: 'SELL',
      buyerId: 'usr-buyer-dawit',
      buyerName: 'Dawit_M',
      sellerId: 'usr-merchant-addis',
      sellerName: 'Addis_Prime',
      usdtAmount: 50,
      etbAmount: 7930,
      unitPriceEtb: 158.6,
      status: 'COMPLETED',
      paymentMethod: 'CBE',
      proofReceiptUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop',
      paymentDetails: {
        method: 'CBE',
        accountNumber: '1000987654321',
        accountName: 'Bethelhem Tedros',
        bankName: 'Commercial Bank of Ethiopia',
      },
      expiresAt: minutesAgo(55),
      createdAt: minutesAgo(70),
      updatedAt: minutesAgo(66),
      paidAt: minutesAgo(68),
      completedAt: minutesAgo(66),
      buyerFeedback: { rating: 'POSITIVE', comment: 'Fast release, thank you.', createdAt: minutesAgo(65) },
      auditLogs: [
        { id: 'log-98-1', timestamp: minutesAgo(70), actor: 'SYSTEM', message: 'Order created. 50.00 USDT from the seller is locked.' },
        { id: 'log-98-2', timestamp: minutesAgo(68), actor: 'BUYER', message: 'Buyer marked the order as paid.' },
        { id: 'log-98-3', timestamp: minutesAgo(66), actor: 'SELLER', message: 'Seller confirmed payment. 50.00 USDT sent to the buyer.' },
      ],
    };

    const appealOrder: P2POrder = {
      id: '20261109000105',
      offerId: 'off-addis-sell',
      offerType: 'SELL',
      buyerId: 'usr-app-kaleb',
      buyerName: 'Kaleb_A',
      sellerId: 'usr-merchant-addis',
      sellerName: 'Addis_Prime',
      usdtAmount: 120,
      etbAmount: 19032,
      unitPriceEtb: 158.6,
      status: 'DISPUTED',
      paymentMethod: 'TELEBIRR',
      proofReceiptUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop',
      paymentDetails: {
        method: 'TELEBIRR',
        accountNumber: '0922987654',
        accountName: 'Bethelhem Tedros',
        bankName: 'Telebirr',
      },
      expiresAt: minutesAgo(20),
      createdAt: minutesAgo(35),
      updatedAt: minutesAgo(8),
      paidAt: minutesAgo(30),
      appealedBy: 'BUYER',
      appealedAt: minutesAgo(8),
      disputeReason: 'I sent 19,032 ETB by Telebirr 30 minutes ago and uploaded the receipt. The seller has not released.',
      auditLogs: [
        { id: 'log-105-1', timestamp: minutesAgo(35), actor: 'SYSTEM', message: 'Order created. 120.00 USDT from the seller is locked.' },
        { id: 'log-105-2', timestamp: minutesAgo(30), actor: 'BUYER', message: 'Buyer marked the order as paid.' },
        { id: 'log-105-3', timestamp: minutesAgo(8), actor: 'BUYER', message: 'Buyer opened an appeal.' },
      ],
    };

    [openOrder, completedOrder, appealOrder].forEach((o) => this.orders.set(o.id, o));

    this.chatMessages.set(openOrder.id, [
      {
        id: 'msg-101-1',
        orderId: openOrder.id,
        senderId: 'SYSTEM',
        senderName: 'Fetan',
        senderRole: 'ADMIN',
        text: 'The seller’s 100.00 USDT is locked. Send 15,835.00 ETB to the seller, then tap “I have paid”.',
        timestamp: minutesAgo(1),
        isSystem: true,
      },
      {
        id: 'msg-101-2',
        orderId: openOrder.id,
        senderId: 'usr-merchant-alazar',
        senderName: 'Alazar_FX',
        senderRole: 'MERCHANT',
        text: 'Selam! I am online. Please send from your own Telebirr and leave the reason empty.',
        timestamp: minutesAgo(0.7),
      },
    ]);

    this.chatMessages.set(completedOrder.id, [
      {
        id: 'msg-98-1',
        orderId: completedOrder.id,
        senderId: 'SYSTEM',
        senderName: 'Fetan',
        senderRole: 'ADMIN',
        text: 'Order completed. 50.00 USDT was sent to the buyer.',
        timestamp: minutesAgo(66),
        isSystem: true,
      },
    ]);

    this.chatMessages.set(appealOrder.id, [
      {
        id: 'msg-105-1',
        orderId: appealOrder.id,
        senderId: 'usr-app-kaleb',
        senderName: 'Kaleb_A',
        senderRole: 'USER',
        text: 'I paid. Receipt is uploaded. Please release.',
        timestamp: minutesAgo(25),
      },
      {
        id: 'msg-105-2',
        orderId: appealOrder.id,
        senderId: 'SYSTEM',
        senderName: 'Fetan',
        senderRole: 'ADMIN',
        text: 'The buyer opened an appeal. Our support team will check this order. The USDT stays locked until then.',
        timestamp: minutesAgo(8),
        isSystem: true,
      },
    ]);

    this.merchantApplications.set('app-kaleb', {
      id: 'app-kaleb',
      userId: 'usr-app-kaleb',
      userEmail: 'kaleb@fetan.et',
      userName: 'Kaleb Abebe',
      telegramHandle: '@kaleb_trader',
      kycDocType: 'DRIVERS_LICENSE',
      kycDocNumber: 'DL-ET-98210',
      usdtBalance: 45.2,
      status: 'PENDING',
      submittedAt: minutesAgo(35),
    });

    this.merchantApplications.set('app-marta', {
      id: 'app-marta',
      userId: 'usr-app-marta',
      userEmail: 'marta@fetan.et',
      userName: 'Marta Girma',
      telegramHandle: '@marta_g',
      kycDocType: 'NATIONAL_ID',
      kycDocNumber: 'FAYDA-3921-1188',
      usdtBalance: 6.5,
      status: 'PENDING',
      submittedAt: minutesAgo(15),
    });

    this.kycSubmissions.set('kyc-tigist', {
      id: 'kyc-tigist',
      userId: 'usr-tigist',
      userEmail: 'tigist@fetan.et',
      userName: 'Tigist Assefa',
      telegramHandle: '@tigist_a',
      source: 'WEB',
      kycDocType: 'NATIONAL_ID',
      kycDocNumber: 'FAYDA-7721-9921',
      status: 'PENDING',
      submittedAt: minutesAgo(48),
    });

    this.kycSubmissions.set('kyc-yohannes', {
      id: 'kyc-yohannes',
      userId: 'usr-yohannes',
      userEmail: 'yohannes@fetan.et',
      userName: 'Yohannes Tefera',
      telegramHandle: '@yohannes_t',
      source: 'TELEGRAM_BOT',
      kycDocType: 'PASSPORT',
      kycDocNumber: 'EP-902188',
      status: 'PENDING',
      submittedAt: minutesAgo(12),
    });

    this.supportTickets.set('sup-1001', {
      id: 'sup-1001',
      userId: 'usr-app-kaleb',
      userName: 'Kaleb Abebe',
      userEmail: 'kaleb@fetan.et',
      telegramHandle: '@kaleb_trader',
      orderId: '20261109000105',
      category: 'ORDER_COMPLAINT',
      subject: 'Order #20261109000105 payment sent via Telebirr',
      message: 'I paid 19,032 ETB to Addis_Prime on Telebirr and uploaded the receipt. Please help release my 120 USDT.',
      status: 'OPEN',
      source: 'TELEGRAM_BOT',
      createdAt: minutesAgo(8),
      updatedAt: minutesAgo(8),
    });
  }

  // ---------- Locks ----------

  async withLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const unique = Array.from(new Set(keys)).sort();
    const releases: Array<() => void> = [];
    try {
      for (const k of unique) {
        releases.push(await rowLocks.acquire(k));
      }
      return await fn();
    } finally {
      releases.reverse().forEach((r) => r());
    }
  }

  async withUserLock<T>(userId: string, fn: (user: User) => Promise<T>): Promise<T> {
    return this.withLocks([`user:${userId}`], async () => {
      const user = this.users.get(userId);
      if (!user) throw new Error('User not found');
      return fn(user);
    });
  }

  async withOrderLock<T>(orderId: string, fn: (order: P2POrder) => Promise<T>): Promise<T> {
    return this.withLocks([`order:${orderId}`], async () => {
      const order = this.orders.get(orderId);
      if (!order) throw new Error('Order not found');
      return fn(order);
    });
  }

  // ---------- IDs ----------

  newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  nextOrderId(): string {
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    let id = '';
    do {
      this.orderSeq += 1;
      id = `${date}${String(this.orderSeq).padStart(6, '0')}`;
    } while (this.orders.has(id));
    return id;
  }

  // ---------- Users ----------

  getUser(id: string): User | undefined {
    const user = this.users.get(id);
    if (user && !user.depositAddresses) {
      user.depositAddresses = generateUserDepositAddresses(user.id);
      this.users.set(user.id, user);
    }
    return user;
  }

  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  getSuperadminUser(): User | undefined {
    return this.getAllUsers().find((u) => u.role === 'SUPERADMIN') || this.users.get('usr-super-yared');
  }

  getUserByTelegram(chatIdOrUsername: string): User | undefined {
    const clean = chatIdOrUsername.trim().replace(/^@/, '').toLowerCase();
    for (const u of this.users.values()) {
      if (u.telegramChatId && String(u.telegramChatId) === clean) return u;
      if (u.telegramHandle && u.telegramHandle.replace(/^@/, '').toLowerCase() === clean) return u;
      if (u.telegramLinkCode && u.telegramLinkCode.toLowerCase() === clean) return u;
    }
    return undefined;
  }

  linkTelegramAccount(codeOrUserId: string, chatId: string, username?: string): User | undefined {
    const cleanCode = codeOrUserId.trim().replace(/^link_/i, '');
    let target = this.users.get(cleanCode);
    if (!target) {
      for (const u of this.users.values()) {
        if (
          u.telegramLinkCode?.toLowerCase() === cleanCode.toLowerCase() ||
          (username && u.telegramHandle?.replace(/^@/, '').toLowerCase() === username.replace(/^@/, '').toLowerCase())
        ) {
          target = u;
          break;
        }
      }
    }
    if (!target) return undefined;

    const updated: User = {
      ...target,
      telegramChatId: String(chatId),
      telegramHandle: username ? `@${username.replace(/^@/, '')}` : target.telegramHandle,
      telegramNotifications: true,
      updatedAt: new Date().toISOString(),
    };
    this.users.set(target.id, updated);
    return updated;
  }

  saveUser(user: User): User {
    this.users.set(user.id, user);
    return user;
  }

  updateUser(id: string, updates: Partial<User>): User {
    const existing = this.users.get(id);
    if (!existing) throw new Error('User not found');
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.users.set(id, updated);
    return updated;
  }

  createOrGetTelegramUser(params: {
    tgId: string;
    username?: string;
    name: string;
    email?: string;
  }): User {
    const superTg = (process.env.ADMIN_TELEGRAM_USERNAME || 'kanzedin').replace(/^@/, '').toLowerCase();
    const cleanUser = (params.username || '').replace(/^@/, '').toLowerCase();

    if (cleanUser === superTg) {
      const superUser = this.getSuperadminUser();
      if (superUser) {
        return this.updateUser(superUser.id, {
          telegramChatId: String(params.tgId),
          telegramHandle: `@${cleanUser}`,
        });
      }
    }

    const existing =
      this.getUserByTelegram(String(params.tgId)) ||
      (cleanUser ? this.getUserByTelegram(cleanUser) : undefined);

    if (existing) {
      return this.updateUser(existing.id, {
        telegramChatId: String(params.tgId),
        telegramHandle: cleanUser ? `@${cleanUser}` : existing.telegramHandle,
      });
    }

    const id = `usr-tg-${params.tgId}`;
    const newUser: User = {
      id,
      email: params.email || `${cleanUser || params.tgId}@telegram.fetan.et`,
      name: params.name || cleanUser || `Trader ${params.tgId}`,
      nickname: cleanUser || params.name,
      telegramHandle: cleanUser ? `@${cleanUser}` : undefined,
      telegramChatId: String(params.tgId),
      telegramNotifications: true,
      telegramLinkCode: `FETAN-${String(params.tgId).slice(-5)}`,
      role: cleanUser === superTg ? 'SUPERADMIN' : 'USER',
      kycStatus: cleanUser === superTg ? 'VERIFIED' : 'UNVERIFIED',
      depositAddresses: generateUserDepositAddresses(id),
      usdtBalance: 0,
      usdtLocked: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(id, newUser);
    return newUser;
  }

  // ---------- Offers ----------

  getOffers(type?: 'SELL' | 'BUY', paymentMethod?: PaymentMethod, includeInactive = false): P2POffer[] {
    let list = Array.from(this.offers.values());
    if (!includeInactive) list = list.filter((o) => o.isActive);
    if (type) list = list.filter((o) => o.offerType === type);
    if (paymentMethod) list = list.filter((o) => o.paymentMethods.includes(paymentMethod));
    return list;
  }

  getOffer(id: string): P2POffer | undefined {
    return this.offers.get(id);
  }

  createOffer(offer: P2POffer): P2POffer {
    this.offers.set(offer.id, offer);
    return offer;
  }

  updateOffer(id: string, updates: Partial<P2POffer>): P2POffer {
    const existing = this.offers.get(id);
    if (!existing) throw new Error('Ad not found');
    const updated = { ...existing, ...updates };
    this.offers.set(id, updated);
    return updated;
  }

  deleteOffer(id: string): boolean {
    return this.offers.delete(id);
  }

  // ---------- Orders ----------

  getOrder(id: string): P2POrder | undefined {
    return this.orders.get(id);
  }

  getAllOrders(): P2POrder[] {
    return Array.from(this.orders.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getOrdersForUser(userId: string): P2POrder[] {
    return this.getAllOrders().filter((o) => o.buyerId === userId || o.sellerId === userId);
  }

  getOpenOrdersForOffer(offerId: string): P2POrder[] {
    return this.getAllOrders().filter(
      (o) => o.offerId === offerId && OPEN_ORDER_STATUSES.includes(o.status)
    );
  }

  saveOrder(order: P2POrder): P2POrder {
    this.orders.set(order.id, order);
    return order;
  }

  // ---------- Chat ----------

  getChatMessages(orderId: string): ChatMessage[] {
    return this.chatMessages.get(orderId) || [];
  }

  addChatMessage(message: ChatMessage): ChatMessage {
    const list = this.chatMessages.get(message.orderId) || [];
    list.push(message);
    this.chatMessages.set(message.orderId, list);
    return message;
  }

  // ---------- Merchant applications ----------

  getMerchantApplications(): MerchantApplication[] {
    return Array.from(this.merchantApplications.values()).sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }

  getMerchantApplication(id: string): MerchantApplication | undefined {
    return this.merchantApplications.get(id);
  }

  saveMerchantApplication(app: MerchantApplication): MerchantApplication {
    this.merchantApplications.set(app.id, app);
    return app;
  }

  // ---------- KYC ----------

  getKycSubmissions(): KycSubmission[] {
    return Array.from(this.kycSubmissions.values()).sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }

  getKycSubmission(id: string): KycSubmission | undefined {
    return this.kycSubmissions.get(id);
  }

  saveKycSubmission(sub: KycSubmission): KycSubmission {
    this.kycSubmissions.set(sub.id, sub);
    return sub;
  }

  // ---------- Support & Order Complaints ----------

  getSupportTickets(): SupportTicket[] {
    return Array.from(this.supportTickets.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getSupportTicket(id: string): SupportTicket | undefined {
    return this.supportTickets.get(id);
  }

  saveSupportTicket(ticket: SupportTicket): SupportTicket {
    this.supportTickets.set(ticket.id, ticket);
    return ticket;
  }

  // ---------- Wallet Transactions (Deposits & Withdrawals) ----------

  getWalletTransactions(userId?: string): WalletTransaction[] {
    let list = Array.from(this.walletTransactions.values());
    if (userId) {
      list = list.filter((t) => t.userId === userId);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  saveWalletTransaction(tx: WalletTransaction): WalletTransaction {
    this.walletTransactions.set(tx.id, tx);
    return tx;
  }

  findWalletTransactionByTxHash(txHash: string): WalletTransaction | undefined {
    const clean = txHash.trim().toLowerCase();
    for (const tx of this.walletTransactions.values()) {
      if (tx.txHash && tx.txHash.trim().toLowerCase() === clean) {
        return tx;
      }
    }
    return undefined;
  }
}

const globalForDb = global as unknown as { dbStore?: DatabaseStore };
export const db = globalForDb.dbStore || new DatabaseStore();
if (process.env.NODE_ENV !== 'production') globalForDb.dbStore = db;

