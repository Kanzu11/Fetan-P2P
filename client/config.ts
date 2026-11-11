/**
 * Fetan P2P Configuration
 *
 * Central place for values that were previously hardcoded throughout the UI.
 * Most values read from environment variables at runtime so the app works out
 * of the box (defaults below) but can be overridden for production.
 *
 * To override: add <KEY> to .env and reference process.env.<KEY> here.
 */

// --- API base ---
export const API = {
  base: process.env.NEXT_PUBLIC_API_URL || '/api',
  offers: '/api/offers',
  prices: '/api/prices/live',
  orders: '/api/orders',
  user: '/api/user',
  auth: '/api/auth',
  events: '/api/events',
};

// --- Feature flags ---
export const FEATURES = {
  enableExpressMode: process.env.NEXT_PUBLIC_ENABLE_EXPRESS !== 'false',
  enableKYCRequired: process.env.NEXT_PUBLIC_KYC_REQUIRED !== 'false',
  enableMerchantMode: process.env.NEXT_PUBLIC_ENABLE_MERCHANT !== 'false',
};

// --- Rate / price constants (overridable via env) ---
// These are *defaults* shown when the live price feed is offline;
// the UI always attempts to fetch /api/prices/live first.
export const PRICE_DEFAULTS = {
  // Reference rate: 1 USDT → ETB (updated when API responds)
  referenceEtbPerUsdt: Number(process.env.NEXT_PUBLIC_REFERENCE_ETB_PER_USDT) || 158.35,
  // ±10% safe band around the reference used for "allowed ad price"
  spreadPercent: Number(process.env.NEXT_PUBLIC_PRICE_SPREAD_PERCENT) || 10,
};

// --- Merchant / KYC thresholds ---
export const MERCHANT = {
  minUsdtBalanceToPost: Number(process.env.NEXT_PUBLIC_MIN_USDT_BALANCE_TO_POST) || 10,
};

// --- Bot / Mini App ---
export const BOT = {
  // Telegram bot username — used for links like /start @botname
  username: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'fetanp2probot',
  // Mini App URL — where the Telegram WebApp is hosted
  miniAppUrl:
    process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_URL ||
    'https://app.fetan.et',
  // Superadmin Telegram handle (for display in footers, notifications)
  superadminUsername: process.env.NEXT_PUBLIC_SUPERADMIN_USERNAME || 'kanzedin',
  // Support bot Telegram handle
  supportBotUsername: process.env.NEXT_PUBLIC_SUPPORT_BOT_USERNAME || 'fetanp2probot',
};

// --- Static hardcoded data that would normally come from the server ---
// These are kept here so the UI doesn't have inline literals scattered
// across 8+ files. They are only used as fallbacks when API data is absent.
export const STATIC = {
  // 24h traded volume (would normally come from /api/stats or a dashboard DB)
  volume24hEtb: Number(process.env.NEXT_PUBLIC_VOLUME_24H_ETB) || 642850,

  // Hardcoded current market price fallback (ETB per USDT)
  priceEtbPerUsdt: Number(process.env.NEXT_PUBLIC_PRICE_ETB_PER_USDT) || 158.35,

  // Number of verified merchants (from DB; fallback shown on landing)
  verifiedMerchantsCount: Number(
    process.env.NEXT_PUBLIC_VERIFIED_MERCHANTS_COUNT || 48
  ),

  // Typical time to release USDT from escrow (minutes); varies by payment method
  avgReleaseTimeMins: Number(
    process.env.NEXT_PUBLIC_AVG_RELEASE_TIME_MINS || 2
  ),

  // Disputed-order SLA (hours)
  disputeSlaHours: Number(process.env.NEXT_PUBLIC_DISPUTE_SLA_HOURS || 48),
};

// --- Payment method metadata (used in many places) ---
// Kept in one source of truth; overrides via PAYMENT_METHODS_META in types.ts
// take precedence if the server sends a fresh payload.
export const PAYMENT_METHODS_META_DEFAULT = {
  TELEBIRR: {
    id: 'TELEBIRR',
    name: 'Telebirr',
    shortName: 'Telebirr',
    nameAm: 'ቴሌብር',
    accentColor: '#009B57',
    hint: 'Telebirr app or *127#',
    settlementTime: 'Instant',
    channelHint: 'Telebirr app or *127#',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40',
    badgeText: 'text-emerald-700 dark:text-emerald-300',
    badgeBorder: 'border-emerald-200 dark:border-emerald-800',
    accountLabel: 'Telebirr phone number',
    accountField: 'telebirr' as const,
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
    accountField: 'cbeAccount' as const,
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
    accountField: 'abyssiniaAccount' as const,
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
    accountField: 'awashAccount' as const,
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
    accountField: 'cbeBirr' as const,
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
    accountField: 'dashenAccount' as const,
    placeholder: '50XXXXXXXXXXX',
  },
};