'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'en' | 'am';

interface Translations {
  brandSub: string;
  navOverview: string;
  navMarket: string;
  navOrders: string;
  navWallet: string;
  navEscrow: string;
  navAdmin: string;
  liveStatus: string;
  quickDeposit: string;
  verifyId: string;
  verified: string;
  pending: string;
  merchant: string;
  applyMerchant: string;
  reqMinDeposit: string;

  heroBadge: string;
  heroTitle: string;
  heroSub: string;
  whatIsEscrowTitle: string;
  whatIsEscrowDesc: string;
  btnStartTrading: string;
  btnBecomeMerchant: string;
  btnEscrowDemo: string;

  metricVol: string;
  metricPrice: string;
  metricMerchants: string;
  metricSpeed: string;

  step1Title: string;
  step1Desc: string;
  step2Title: string;
  step2Desc: string;
  step3Title: string;
  step3Desc: string;

  railsTitle: string;
  railsSub: string;
  telebirrDesc: string;
  cbeDesc: string;
  abyssiniaDesc: string;
  awashDesc: string;

  marketTitle: string;
  marketSub: string;
  modeOrderbook: string;
  modeExpress: string;
  btnBuyUsdt: string;
  btnSellUsdt: string;
  postAd: string;
  filterAmount: string;
  filterPayment: string;
  allPayments: string;
  advertiser: string;
  unitPrice: string;
  availableLimit: string;
  action: string;
  available: string;
  limits: string;

  escrowContract: string;
  paymentWindow: string;
  buyerMustPay: string;
  sellerWillRelease: string;
  youSend: string;
  youReceive: string;
  bankDetails: string;
  accountName: string;
  accountNumber: string;
  paymentMethod: string;
  instructions: string;
  proofReceipt: string;
  attachProof: string;
  markPaidBtn: string;
  releaseBtn: string;
  disputeBtn: string;
  cancelOrderBtn: string;
  completedTitle: string;
  completedDesc: string;
  disputedTitle: string;
  cancelledTitle: string;
  chatTitle: string;
  chatPlaceholder: string;
  systemAuditLog: string;

  ordersTitle: string;
  ordersSub: string;
  walletTitle: string;
  walletSub: string;

  adminTitle: string;
  adminSub: string;
  tabPendingMerchants: string;
  tabKyc: string;
  tabSuperAdmin: string;
  approve: string;
  reject: string;
  balance: string;
  telegram: string;
  docType: string;
}

const translations: Record<Language, Translations> = {
  en: {
    brandSub: 'ETHIOPIA P2P',
    navOverview: 'Home',
    navMarket: 'P2P Market',
    navOrders: 'Orders',
    navWallet: 'Wallet',
    navEscrow: 'Active Order',
    navAdmin: 'Admin',
    liveStatus: 'ONLINE',
    quickDeposit: 'Add USDT',
    verifyId: 'Verify ID',
    verified: 'Verified',
    pending: 'In Review',
    merchant: 'Merchant',
    applyMerchant: 'Become Merchant',
    reqMinDeposit: 'Needs 10 USDT',

    heroBadge: '0% Buyer Fee • Safe USDT Escrow',
    heroTitle: 'Buy and sell USDT in Ethiopia with Birr.',
    heroSub:
      'Pay and get paid directly with Telebirr, CBE, Bank of Abyssinia, and Awash Bank. We hold the USDT safely until the Birr payment is confirmed.',
    whatIsEscrowTitle: 'How Our Escrow Keeps Your Money Safe',
    whatIsEscrowDesc:
      'When you start an order, Fetan locks the seller’s USDT right away. You send Birr straight to the seller’s Telebirr or bank account. Once the seller checks their balance and confirms, the USDT moves into your wallet with zero extra fees.',
    btnStartTrading: 'Buy & Sell USDT',
    btnBecomeMerchant: 'Become a Merchant',
    btnEscrowDemo: 'View Active Order',

    metricVol: '24h Volume',
    metricPrice: 'Best Market Price',
    metricMerchants: 'Verified Merchants',
    metricSpeed: 'Average Release Time',

    step1Title: '1. Pick an Offer',
    step1Desc:
      'Choose a seller or buyer from the list, or use Express to get matched with the best price right away.',
    step2Title: '2. Send Birr Directly',
    step2Desc:
      'The seller’s USDT is locked by Fetan. Send the exact Birr amount using Telebirr, CBE, Abyssinia, or Awash Bank, then tap "I Have Paid".',
    step3Title: '3. Get Your USDT',
    step3Desc:
      'As soon as the seller checks their bank or Telebirr balance and confirms, your USDT is unlocked and added to your wallet.',

    railsTitle: 'Supported Banks & Mobile Money',
    railsSub: 'Send and receive Ethiopian Birr using your everyday accounts',
    telebirrDesc: 'Fast mobile money transfer using the Telebirr app or *127#.',
    cbeDesc: 'Direct bank transfer using CBE mobile banking or internet banking.',
    abyssiniaDesc: 'Quick transfer using Bank of Abyssinia (BoA Mobile or Apollo).',
    awashDesc: 'Direct transfer using AwashBirr Pro or Awash Bank.',

    marketTitle: 'P2P Market',
    marketSub: 'Buy and sell USDT with Ethiopian Birr from verified users',
    modeOrderbook: 'All Ads',
    modeExpress: 'Fast Match',
    btnBuyUsdt: 'Buy USDT',
    btnSellUsdt: 'Sell USDT',
    postAd: 'Post New Ad',
    filterAmount: 'Amount',
    filterPayment: 'Payment Method',
    allPayments: 'All Payment Methods',
    advertiser: 'User',
    unitPrice: 'Price',
    availableLimit: 'Available / Limit',
    action: 'Action',
    available: 'Available',
    limits: 'Limit',

    escrowContract: 'Order',
    paymentWindow: 'Time Left to Pay',
    buyerMustPay: 'Send Birr to the seller’s account',
    sellerWillRelease: 'Seller checks their payment and releases USDT',
    youSend: 'Total Birr (ETB)',
    youReceive: 'Total Crypto (USDT)',
    bankDetails: 'Seller Payment Details',
    accountName: 'Account Holder Name',
    accountNumber: 'Account / Phone Number',
    paymentMethod: 'Payment Method',
    instructions:
      'Open your bank or Telebirr app and send the exact Birr amount from an account with your own name. Do not write "USDT" or "Crypto" in the payment note.',
    proofReceipt: 'Payment Reference or Note',
    attachProof: 'Enter your transfer reference or upload receipt',
    markPaidBtn: 'I Have Paid',
    releaseBtn: 'Confirm Payment & Complete Order',
    disputeBtn: 'Need Help / Appeal',
    cancelOrderBtn: 'Cancel Order',
    completedTitle: 'Order Completed',
    completedDesc:
      'The payment was confirmed and the USDT has been added to the buyer’s wallet with zero fee.',
    disputedTitle: 'Appeal in Review',
    cancelledTitle: 'Order Cancelled',
    chatTitle: 'Order Chat',
    chatPlaceholder: 'Type a message...',
    systemAuditLog: 'Order Timeline',

    ordersTitle: 'My Orders & Ads',
    ordersSub: 'View your open orders, past trades, and manage your buy/sell ads',
    walletTitle: 'Wallet & Payment Methods',
    walletSub: 'Check your USDT balance, deposit or withdraw, and save your bank or Telebirr numbers',

    adminTitle: 'Admin Control Center',
    adminSub: 'Review orders and appeals, verify user IDs, approve merchants, and manage accounts',
    tabPendingMerchants: 'Merchant Requests',
    tabKyc: 'ID Checks',
    tabSuperAdmin: 'User Accounts',
    approve: 'Approve',
    reject: 'Reject',
    balance: 'USDT Balance',
    telegram: 'Telegram',
    docType: 'ID Type',
  },
  am: {
    brandSub: 'የኢትዮጵያ P2P ገበያ',
    navOverview: 'መነሻ',
    navMarket: 'P2P ገበያ',
    navOrders: 'ትዕዛዞች',
    navWallet: 'ዋሌት',
    navEscrow: 'ንቁ ትዕዛዝ',
    navAdmin: 'አድሚን',
    liveStatus: 'ቀጥታ',
    quickDeposit: 'USDT ጨምር',
    verifyId: 'መታወቂያ አረጋግጥ',
    verified: 'የተረጋገጠ',
    pending: 'በግምገማ ላይ',
    merchant: 'ነጋዴ',
    applyMerchant: 'ነጋዴ ይሁኑ',
    reqMinDeposit: '10 USDT ያስፈልጋል',

    heroBadge: '0% ክፍያ • አስተማማኝ የUSDT ጥበቃ',
    heroTitle: 'በኢትዮጵያ USDT በብር በቀላሉ ይግዙ እና ይሽጡ።',
    heroSub:
      'በቴሌብር፣ በኢትዮጵያ ንግድ ባንክ (CBE)፣ በአቢሲኒያ ባንክ እና በአዋሽ ባንክ በቀጥታ ይገበያዩ። ክፍያው እስኪረጋገጥ ድረስ የሻጩ USDT በፈጣን ዋስትና ተቆልፎ ይጠበቃል።',
    whatIsEscrowTitle: 'ገንዘብዎ እንዴት እንደሚጠበቅ',
    whatIsEscrowDesc:
      'ትዕዛዝ ሲጀምሩ የሻጩ USDT ወዲያውኑ ይቆለፋል። እርስዎ ወደ ሻጩ የቴሌብር ወይም የባንክ ሂሳብ ብር ይልካሉ። ሻጩ ብሩ መድረሱን አይቶ ሲያረጋግጥ USDT ወዲያውኑ ወደ ዋሌትዎ ይገባል።',
    btnStartTrading: 'USDT ይግዙ / ይሽጡ',
    btnBecomeMerchant: 'ነጋዴ ይሁኑ',
    btnEscrowDemo: 'ንቁ ትዕዛዝ ይመልከቱ',

    metricVol: 'የ24 ሰዓት ግብይት',
    metricPrice: 'ምርጥ የገበያ ዋጋ',
    metricMerchants: 'የተረጋገጡ ነጋዴዎች',
    metricSpeed: 'አማካይ ፍጥነት',

    step1Title: '1. ማስታወቂያ ይምረጡ',
    step1Desc:
      'ከዝርዝሩ ውስጥ የሚፈልጉትን ሻጭ ወይም ገዢ ይምረጡ፣ ወይም በፈጣን ግብይት ምርጡን ዋጋ ያግኙ።',
    step2Title: '2. ብር በቀጥታ ይላኩ',
    step2Desc:
      'የሻጩ USDT ተቆልፏል። በቴሌብር ወይም በባንክ ትክክለኛውን ብር ልከው "ከፍያለሁ" የሚለውን ይጫኑ።',
    step3Title: '3. USDT ይቀበሉ',
    step3Desc:
      'ሻጩ የባንክ ወይም የቴሌብር ሂሳቡን አይቶ ሲያረጋግጥ USDT ወዲያውኑ ወደ ዋሌትዎ ይገባል።',

    railsTitle: 'የሚደገፉ ባንኮች እና ሞባይል ገንዘብ',
    railsSub: 'በየቀኑ በሚጠቀሙባቸው የባንክ እና የቴሌብር ሂሳቦች ይገበያዩ',
    telebirrDesc: 'በቴሌብር መተግበሪያ ወይም በ*127# ፈጣን ዝውውር።',
    cbeDesc: 'በኢትዮጵያ ንግድ ባንክ (CBE) የሞባይል ባንኪንግ ዝውውር።',
    abyssiniaDesc: 'በአቢሲኒያ ባንክ (BoA Mobile) ፈጣን የባንክ ዝውውር።',
    awashDesc: 'በአዋሽ ብር ፕሮ (AwashBirr Pro) እና አዋሽ ባንክ ዝውውር።',

    marketTitle: 'P2P ገበያ',
    marketSub: 'ከተረጋገጡ ተጠቃሚዎች ጋር USDT በኢትዮጵያ ብር ይግዙ እና ይሽጡ',
    modeOrderbook: 'ሁሉም ማስታወቂያዎች',
    modeExpress: 'ፈጣን ግብይት',
    btnBuyUsdt: 'USDT ግዛ',
    btnSellUsdt: 'USDT ሽጥ',
    postAd: 'ማስታወቂያ አውጣ',
    filterAmount: 'መጠን (ብር)',
    filterPayment: 'የክፍያ ዘዴ',
    allPayments: 'ሁሉም የክፍያ ዘዴዎች',
    advertiser: 'ተጠቃሚ',
    unitPrice: 'ዋጋ',
    availableLimit: 'ያለው / ገደብ',
    action: 'ድርጊት',
    available: 'ያለው',
    limits: 'ገደብ',

    escrowContract: 'ትዕዛዝ',
    paymentWindow: 'የቀረው የክፍያ ጊዜ',
    buyerMustPay: 'ብር ወደ ሻጩ ሂሳብ ይላኩ',
    sellerWillRelease: 'ሻጩ ሂሳቡን አይቶ USDT ይለቃል',
    youSend: 'ጠቅላላ ብር (ETB)',
    youReceive: 'ጠቅላላ USDT',
    bankDetails: 'የሻጩ የክፍያ መረጃ',
    accountName: 'የሂሳቡ ባለቤት ስም',
    accountNumber: 'የሂሳብ / ስልክ ቁጥር',
    paymentMethod: 'የክፍያ ዘዴ',
    instructions:
      'የባንክ ወይም የቴሌብር መተግበሪያዎን ከፍተው ትክክለኛውን የብር መጠን በራስዎ ስም ከተመዘገበ ሂሳብ ይላኩ። በክፍያ ማስታወሻ ላይ "USDT" ወይም "Crypto" ብለው አይጻፉ።',
    proofReceipt: 'የክፍያ ቁጥር ወይም ማስታወሻ',
    attachProof: 'የደረሰኝ ቁጥር ያስገቡ ወይም ፎቶ ያያይዙ',
    markPaidBtn: 'ከፍያለሁ',
    releaseBtn: 'ክፍያውን አረጋግጥና ትዕዛዙን አጠናቅቅ',
    disputeBtn: 'እገዛ / ቅሬታ',
    cancelOrderBtn: 'ትዕዛዙን ሰርዝ',
    completedTitle: 'ትዕዛዙ ተጠናቋል',
    completedDesc:
      'ክፍያው ተረጋግጦ USDT ያለምንም ክፍያ ወደ ገዢው ዋሌት ገብቷል።',
    disputedTitle: 'ትዕዛዙ በአድሚን እየታየ ነው',
    cancelledTitle: 'ትዕዛዙ ተሰርዟል',
    chatTitle: 'የትዕዛዝ ውይይት',
    chatPlaceholder: 'መልእክት ይጻፉ...',
    systemAuditLog: 'የትዕዛዝ ታሪክ',

    ordersTitle: 'የእኔ ትዕዛዞች እና ማስታወቂያዎች',
    ordersSub: 'ክፍት ትዕዛዞችን፣ ያለፉ ግብይቶችን እና ያወጧቸውን ማስታወቂያዎች ይመልከቱ',
    walletTitle: 'ዋሌት እና የክፍያ ሂሳቦች',
    walletSub: 'የUSDT ቀሪ ሂሳብዎን ይመልከቱ፣ ገቢ/ወጪ ያድርጉ እና የባንክ ወይም የቴሌብር ቁጥርዎን ያስቀምጡ',

    adminTitle: 'የአድሚን መቆጣጠሪያ',
    adminSub: 'ትዕዛዞችን እና ቅሬታዎችን ይፍቱ፣ መታወቂያ ያረጋግጡ እና ነጋዴዎችን ያጽድቁ',
    tabPendingMerchants: 'የነጋዴ ጥያቄዎች',
    tabKyc: 'የመታወቂያ ማረጋገጫ',
    tabSuperAdmin: 'ተጠቃሚዎች',
    approve: 'አጽድቅ',
    reject: 'ውድቅ አድርግ',
    balance: 'USDT ቀሪ ሂሳብ',
    telegram: 'ቴሌግራም',
    docType: 'የመታወቂያ ዓይነት',
  },
};

interface I18nContextType {
  lang: Language;
  setLang: (l: Language) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Language>('en');

  useEffect(() => {
    const saved = localStorage.getItem('fetan_lang') as Language;
    if (saved === 'en' || saved === 'am') {
      setLang(saved);
    }
  }, []);

  const handleSetLang = (newLang: Language) => {
    setLang(newLang);
    localStorage.setItem('fetan_lang', newLang);
  };

  return (
    <I18nContext.Provider
      value={{
        lang,
        setLang: handleSetLang,
        t: translations[lang],
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
