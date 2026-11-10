export type Role = 'USER' | 'MERCHANT' | 'ADMIN' | 'SUPERADMIN';

export type KycStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export type KycDocType = 'NATIONAL_ID' | 'PASSPORT' | 'DRIVERS_LICENSE';

/**
 * Order life cycle (same model as Binance P2P):
 *
 *   PENDING_PAYMENT ──buyer marks paid──▶ PAYMENT_SENT ──seller releases──▶ COMPLETED
 *        │                                   │
 *        │ buyer cancels / time runs out     │ buyer or seller appeals
 *        ▼                                   ▼
 *    CANCELLED ◀──admin cancels────────── DISPUTED ──admin releases──▶ COMPLETED
 */
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_SENT'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED';

export const OPEN_ORDER_STATUSES: OrderStatus[] = ['PENDING_PAYMENT', 'PAYMENT_SENT', 'DISPUTED'];

export type OfferType = 'SELL' | 'BUY';

export type PaymentMethod = 'TELEBIRR' | 'CBE' | 'ABYSSINIA' | 'AWASH' | 'CBE_BIRR' | 'DASHEN';

export interface UserPaymentDetails {
  telebirr?: string;
  cbeAccount?: string;
  cbeHolder?: string;
  abyssiniaAccount?: string;
  abyssiniaHolder?: string;
  awashAccount?: string;
  awashHolder?: string;
  cbeBirr?: string;
  dashenAccount?: string;
  dashenHolder?: string;
}

export interface PaymentMethodMeta {
  id: PaymentMethod;
  name: string;
  shortName: string;
  nameAm: string;
  accentColor: string;
  hint: string;
  settlementTime: string;
  channelHint: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  accountLabel: string;
  accountField: keyof UserPaymentDetails;
  placeholder: string;
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  'TELEBIRR',
  'CBE',
  'ABYSSINIA',
  'AWASH',
  'CBE_BIRR',
  'DASHEN',
];

export const PAYMENT_METHODS_META: Record<PaymentMethod, PaymentMethodMeta> = {
  TELEBIRR: {
    id: 'TELEBIRR',
    name: 'Telebirr',
    shortName: 'Telebirr',
    nameAm: 'ቴሌብር',
    accentColor: '#00A859',
    hint: 'Telebirr app or *127#',
    settlementTime: 'Instant',
    channelHint: 'Telebirr app or *127#',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40',
    badgeText: 'text-emerald-700 dark:text-emerald-300',
    badgeBorder: 'border-emerald-200 dark:border-emerald-800',
    accountLabel: 'Telebirr phone number',
    accountField: 'telebirr',
    placeholder: '09XXXXXXXX',
  },
  CBE: {
    id: 'CBE',
    name: 'Commercial Bank of Ethiopia',
    shortName: 'CBE',
    nameAm: 'የኢትዮጵያ ንግድ ባንክ',
    accentColor: '#7E22CE',
    hint: 'CBE Mobile app or *889#',
    settlementTime: '1 - 3 min',
    channelHint: 'CBE Mobile app or *889#',
    badgeBg: 'bg-purple-50 dark:bg-purple-950/40',
    badgeText: 'text-purple-700 dark:text-purple-300',
    badgeBorder: 'border-purple-200 dark:border-purple-800',
    accountLabel: 'CBE account number',
    accountField: 'cbeAccount',
    placeholder: '1000XXXXXXXXX',
  },
  ABYSSINIA: {
    id: 'ABYSSINIA',
    name: 'Bank of Abyssinia',
    shortName: 'Abyssinia',
    nameAm: 'አቢሲኒያ ባንክ',
    accentColor: '#D97706',
    hint: 'BoA Mobile app',
    settlementTime: '1 - 3 min',
    channelHint: 'BoA Mobile app',
    badgeBg: 'bg-amber-50 dark:bg-amber-950/40',
    badgeText: 'text-amber-700 dark:text-amber-300',
    badgeBorder: 'border-amber-200 dark:border-amber-800',
    accountLabel: 'Bank of Abyssinia account number',
    accountField: 'abyssiniaAccount',
    placeholder: 'XXXXXXXX',
  },
  AWASH: {
    id: 'AWASH',
    name: 'Awash Bank',
    shortName: 'Awash',
    nameAm: 'አዋሽ ባንክ',
    accentColor: '#1D4ED8',
    hint: 'Awash Birr Pro app',
    settlementTime: '1 - 3 min',
    channelHint: 'Awash Birr Pro app',
    badgeBg: 'bg-blue-50 dark:bg-blue-950/40',
    badgeText: 'text-blue-700 dark:text-blue-300',
    badgeBorder: 'border-blue-200 dark:border-blue-800',
    accountLabel: 'Awash Bank account number',
    accountField: 'awashAccount',
    placeholder: '0132XXXXXXXXXX',
  },
  CBE_BIRR: {
    id: 'CBE_BIRR',
    name: 'CBE Birr',
    shortName: 'CBE Birr',
    nameAm: 'ሲቢኢ ብር',
    accentColor: '#4F46E5',
    hint: 'CBE Birr app or *847#',
    settlementTime: 'Instant',
    channelHint: 'CBE Birr app or *847#',
    badgeBg: 'bg-indigo-50 dark:bg-indigo-950/40',
    badgeText: 'text-indigo-700 dark:text-indigo-300',
    badgeBorder: 'border-indigo-200 dark:border-indigo-800',
    accountLabel: 'CBE Birr phone number',
    accountField: 'cbeBirr',
    placeholder: '09XXXXXXXX',
  },
  DASHEN: {
    id: 'DASHEN',
    name: 'Dashen Bank',
    shortName: 'Dashen',
    nameAm: 'ዳሽን ባንክ',
    accentColor: '#0F172A',
    hint: 'Dashen SuperApp',
    settlementTime: '1 - 3 min',
    channelHint: 'Dashen SuperApp',
    badgeBg: 'bg-slate-100 dark:bg-slate-800',
    badgeText: 'text-slate-700 dark:text-slate-200',
    badgeBorder: 'border-slate-300 dark:border-slate-700',
    accountLabel: 'Dashen Bank account number',
    accountField: 'dashenAccount',
    placeholder: '50XXXXXXXXXXX',
  },
};

export interface User {
  id: string;
  email: string;
  /** Legal name. Shown only on payment details (must match the bank account). */
  name: string;
  /** Public name shown in the market and chat. */
  nickname?: string;
  telegramHandle?: string;
  /** Numeric Telegram chat ID when linked with @fetanp2probot */
  telegramChatId?: string;
  /** Whether the user/merchant wants order notifications via @fetanp2probot */
  telegramNotifications?: boolean;
  /** One-time or persistent code to link website account with @fetanp2probot */
  telegramLinkCode?: string;
  phone?: string;
  role: Role;
  /** Mandatory for all users before placing or accepting any P2P order */
  kycStatus: KycStatus;
  kycDocType?: KycDocType;
  kycDocNumber?: string;
  kycSubmittedAt?: string;
  usdtBalance: number;
  /** USDT held for open orders. Always equals the sum of this user's open sell orders. */
  usdtLocked: number;
  /** Unique dedicated deposit addresses per network (Binance-style) */
  depositAddresses?: {
    trc20: string;
    bep20: string;
    ton: string;
    tonMemo?: string;
    derivationIndex?: number;
  };
  completedTrades?: number;
  completionRate?: number;
  avgReleaseTimeMins?: number;
  rating?: number;
  positiveFeedback?: number;
  negativeFeedback?: number;
  createdAt: string;
  updatedAt: string;
  paymentDetails?: UserPaymentDetails;
}

export interface P2POffer {
  id: string;
  merchantId: string;
  merchantName: string;
  completedTrades: number;
  completionRate: number;
  merchantRating?: number;
  avgReleaseTimeMins?: number;
  offerType: OfferType; // 'SELL' = merchant sells USDT (user buys). 'BUY' = merchant buys USDT (user sells).
  pricePerUsdtEtb: number;
  minLimitEtb: number;
  maxLimitEtb: number;
  totalAvailable: number; // USDT
  paymentMethods: PaymentMethod[];
  terms?: string;
  isActive: boolean;
  isOnline?: boolean;
  isVerifiedMerchant?: boolean;
  createdAt: string;
}

export interface OrderAuditLog {
  id: string;
  timestamp: string;
  message: string;
  actor: 'SYSTEM' | 'BUYER' | 'SELLER' | 'ADMIN';
}

export interface ChatMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderName: string;
  senderRole: Role;
  text: string;
  timestamp: string;
  isSystem?: boolean;
}

export interface OrderFeedback {
  rating: 'POSITIVE' | 'NEGATIVE';
  comment?: string;
  createdAt: string;
}

export interface P2POrder {
  id: string;
  offerId: string;
  offerType: OfferType;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerName: string;
  usdtAmount: number;
  etbAmount: number;
  unitPriceEtb: number;
  status: OrderStatus;
  proofReceiptUrl?: string;
  paymentMethod: PaymentMethod;
  paymentDetails: {
    method: PaymentMethod;
    accountNumber: string;
    accountName: string;
    bankName: string;
    phone?: string;
  };
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelledBy?: 'BUYER' | 'ADMIN' | 'SYSTEM' | string;
  cancelReason?: string;
  disputeReason?: string;
  appealedBy?: 'BUYER' | 'SELLER' | 'Buyer' | 'Seller' | 'Admin' | string;
  appealedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
  buyerFeedback?: OrderFeedback;
  sellerFeedback?: OrderFeedback;
  auditLogs: OrderAuditLog[];
}

export type OrderViewerRole = 'BUYER' | 'SELLER' | 'ADMIN';

export interface MerchantApplication {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  telegramHandle: string;
  kycDocType: KycDocType;
  kycDocNumber: string;
  usdtBalance: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  reviewedBy?: string;
}

export interface KycSubmission {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  telegramHandle?: string;
  source?: 'WEB' | 'TELEGRAM_BOT' | 'MINI_APP';
  kycDocType: KycDocType;
  kycDocNumber: string;
  docPhotoUrl?: string;
  status: KycStatus;
  submittedAt: string;
  reviewedBy?: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  telegramHandle?: string;
  orderId?: string;
  category: 'ORDER_COMPLAINT' | 'PAYMENT_ISSUE' | 'KYC_HELP' | 'GENERAL_SUPPORT';
  subject: string;
  message: string;
  status: 'OPEN' | 'RESOLVED';
  adminReply?: string;
  resolvedBy?: string;
  source: 'WEB' | 'TELEGRAM_BOT' | 'MINI_APP';
  createdAt: string;
  updatedAt: string;
}

export function displayName(
  input?: string | Pick<User, 'name' | 'nickname'> | null
): string {
  if (!input) return '';
  if (typeof input === 'string') return input.replace(/\s*\(.*\)/, '').trim();
  return (input.nickname || input.name).replace(/\s*\(.*\)/, '').trim();
}

export function isAdminRole(role?: Role): boolean {
  return role === 'ADMIN' || role === 'SUPERADMIN';
}

