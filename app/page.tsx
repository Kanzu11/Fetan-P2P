'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRealtime } from '@/components/realtime-provider';
import { useI18n } from '@/lib/i18n';
import { PaymentMethod, PAYMENT_METHODS_META } from '@/lib/types';
import {
  ShieldCheck,
  ArrowRight,
  Lock,
  UserCheck,
  Check,
  Zap,
  ChevronDown,
  ArrowUpDown,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { ApplyMerchantModal } from '@/components/apply-merchant-modal';
import { KycModal } from '@/components/kyc-modal';

export default function LandingPage() {
  const router = useRouter();
  const { currentUser, latestActiveOrderId } = useRealtime();
  const { lang, t } = useI18n();

  const [merchantModalOpen, setMerchantModalOpen] = useState(false);
  const [kycModalOpen, setKycModalOpen] = useState(false);

  // Interactive Hero Calculator State
  const [calcSide, setCalcSide] = useState<'BUY' | 'SELL'>('BUY');
  const [etbInput, setEtbInput] = useState<string>('15000');
  const [selectedRail, setSelectedRail] = useState<PaymentMethod>('TELEBIRR');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const unitRate = calcSide === 'BUY' ? 158.35 : 157.4;
  const parsedEtb = parseFloat(etbInput) || 0;
  const calculatedUsdt = parsedEtb > 0 ? parsedEtb / unitRate : 0;

  const handleHeroQuoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams({
      side: calcSide,
      amount: etbInput || '',
      method: selectedRail,
    });
    router.push(`/market?${params.toString()}`);
  };

  const faqs =
    lang === 'am'
      ? [
          {
            q: 'ብር ከላክሁ በኋላ ሻጩ USDT ባይለቅስ ምን ይፈጠራል?',
            a: 'ትዕዛዝ ሲከፍቱ የሻጩ USDT ወዲያውኑ በፈጣን እስክሮው ተቆልፎ ይቀመጣል። የክፍያ ደረሰኝዎን አያይዘው "እገዛ / ቅሬታ" የሚለውን ሲጫኑ አድሚኑ ደረሰኙን አይቶ USDT በቀጥታ ወደ ዋሌትዎ ይለቃል።',
          },
          {
            q: 'በቴሌብር ወይም በባንክ ማስታወሻ (Remark) ላይ ምን መጻፍ አለብኝ?',
            a: 'በባንክ ወይም በቴሌብር ዝውውር ወቅት "USDT"፣ "Crypto" ወይም "P2P" የሚሉ ቃላትን አይጻፉ። ማስታወሻውን ባዶ ይተዉት ወይም የግል ክፍያ ብለው ይላኩ።',
          },
          {
            q: 'በሌላ ሰው (በቤተሰብ ወይም በጓደኛ) የባንክ ሂሳብ መክፈል እችላለሁ?',
            a: 'አይቻልም። ለደህንነት ሲባል ክፍያ የሚፈጽሙበት የቴሌብር ወይም የባንክ ሂሳብ ስም በFetan P2P ላይ ከተመዘገበው ስምዎ ጋር አንድ መሆን አለበት።',
          },
          {
            q: 'ነጋዴ (Merchant) ለመሆን ምን ያስፈልጋል?',
            a: 'መታወቂያዎን (ፋይዳ፣ ፓስፖርት ወይም መንጃ ፍቃድ) ያረጋግጡ እና በዋሌትዎ ውስጥ ቢያንስ 10 USDT ይኑርዎት። ከዚያ ያለምንም ክፍያ የመግዣ እና የመሸጫ ማስታወቂያ ማውጣት ይችላሉ።',
          },
        ]
      : [
          {
            q: 'What if I send the Birr and the seller does not release the USDT?',
            a: 'The seller’s USDT is locked by Fetan as soon as you open the order, so they cannot take it back. If the seller does not respond after you pay, tap "Need Help / Appeal" and share your payment receipt. Our admin team will check your receipt and release the USDT to your wallet.',
          },
          {
            q: 'What should I write in the Telebirr or bank payment note?',
            a: 'Do not write "USDT", "Crypto", or "P2P" in the payment note. Leave it blank or write "Personal".',
          },
          {
            q: 'Can I pay using a friend’s or family member’s bank account?',
            a: 'No. You must pay from a Telebirr or bank account with your own name matching your Fetan account.',
          },
          {
            q: 'How do I become a Merchant and post my own ads?',
            a: 'Verify your ID (Fayda ID, Passport, or Driver’s License) and keep at least 10 USDT in your Fetan wallet. Once approved, you can post Buy and Sell ads for free.',
          },
        ];

  const featuredRails: PaymentMethod[] = [
    'TELEBIRR',
    'CBE',
    'ABYSSINIA',
    'AWASH',
    'CBE_BIRR',
    'DASHEN',
  ];

  return (
    <div className="space-y-10 pb-10">
      {/* 1. Split Hero Section with Quick Calculator */}
      <section className="rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Left Column: Value Proposition */}
          <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-between space-y-6">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>{t.heroBadge}</span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 leading-[1.15]">
                {t.heroTitle}
              </h1>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
                {t.heroSub}
              </p>

              <div className="pt-1 flex flex-wrap items-center gap-3">
                <Link
                  href="/market"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm"
                >
                  <span>{t.btnStartTrading}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>

                <Link
                  href={`/trade/${latestActiveOrderId}`}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
                >
                  <Lock className="w-4 h-4 text-emerald-600" />
                  <span>{t.btnEscrowDemo}</span>
                </Link>

                {currentUser?.role === 'USER' && (
                  <button
                    onClick={() => setMerchantModalOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-sm font-semibold hover:bg-slate-100 transition-colors"
                  >
                    <UserCheck className="w-4 h-4 text-slate-600" />
                    <span>{t.btnBecomeMerchant}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Trust Highlights Row */}
            <div className="pt-6 border-t border-slate-100 grid grid-cols-3 gap-4 text-xs">
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>Safe Escrow</span>
                </div>
                <p className="text-slate-500 text-[11px]">USDT is locked before you pay</p>
              </div>
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>Fast Release</span>
                </div>
                <p className="text-slate-500 text-[11px]">Pay with Telebirr or bank</p>
              </div>
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>Verified Users</span>
                </div>
                <p className="text-slate-500 text-[11px]">Checked with Fayda ID</p>
              </div>
            </div>
          </div>

          {/* Right Column: Quick Price Calculator */}
          <div className="lg:col-span-5 bg-slate-900 text-white p-6 sm:p-8 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-800">
            <form onSubmit={handleHeroQuoteSubmit} className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Quick Calculator
                  </span>
                </div>
                <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full tabular-nums">
                  1 USDT ≈ {unitRate.toFixed(2)} ETB
                </span>
              </div>

              {/* Buy / Sell Switcher */}
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setCalcSide('BUY')}
                  className={`py-2.5 rounded-lg transition-colors ${
                    calcSide === 'BUY'
                      ? 'bg-emerald-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {lang === 'am' ? 'USDT ግዛ' : 'Buy USDT'}
                </button>
                <button
                  type="button"
                  onClick={() => setCalcSide('SELL')}
                  className={`py-2.5 rounded-lg transition-colors ${
                    calcSide === 'SELL'
                      ? 'bg-rose-500 text-white shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {lang === 'am' ? 'USDT ሽጥ' : 'Sell USDT'}
                </button>
              </div>

              {/* Birr Input Box */}
              <div className="rounded-2xl bg-slate-800 border border-slate-700 p-3.5 space-y-2">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>
                    {calcSide === 'BUY'
                      ? lang === 'am'
                        ? 'የሚከፍሉት ብር'
                        : 'You pay (Birr)'
                      : lang === 'am'
                      ? 'የሚቀበሉት ብር'
                      : 'You get (Birr)'}
                  </span>
                  <span>300 – 850,000 ETB</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="number"
                    value={etbInput}
                    onChange={(e) => setEtbInput(e.target.value)}
                    placeholder="15000"
                    className="w-full bg-transparent text-2xl font-bold text-white tabular-nums focus:outline-none"
                  />
                  <span className="px-2.5 py-1 rounded-lg bg-slate-700 text-xs font-bold text-slate-200 flex-shrink-0">
                    ETB
                  </span>
                </div>
                <div className="flex gap-1.5 pt-1">
                  {['2000', '10000', '25000', '100000'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setEtbInput(preset)}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                        etbInput === preset
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {Number(preset).toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Calculated USDT Output */}
              <div className="rounded-2xl bg-slate-800 border border-slate-700 p-3.5 space-y-1">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>
                    {calcSide === 'BUY'
                      ? lang === 'am'
                        ? 'የሚቀበሉት USDT (0% ክፍያ)'
                        : 'You get (0% fee)'
                      : lang === 'am'
                      ? 'የሚሸጡት USDT'
                      : 'You sell'}
                  </span>
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-emerald-400 tabular-nums">
                    {calculatedUsdt.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-xs font-bold text-emerald-300">
                    USDT
                  </span>
                </div>
              </div>

              {/* Payment Method Quick Picker */}
              <div className="space-y-1.5">
                <label className="block text-xs text-slate-400">
                  {lang === 'am' ? 'የክፍያ ዘዴ' : 'Payment Method'}
                </label>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {(['TELEBIRR', 'CBE', 'ABYSSINIA', 'AWASH'] as PaymentMethod[]).map((m) => {
                    const meta = PAYMENT_METHODS_META[m];
                    const active = selectedRail === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSelectedRail(m)}
                        className={`px-3 py-2 rounded-xl border text-left flex items-center gap-2 transition-colors ${
                          active
                            ? 'bg-white text-slate-900 border-white font-semibold'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        <span
                          className="w-1.5 h-3.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: meta.accentColor }}
                        />
                        <span className="truncate">{meta.shortName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-sm ${
                  calcSide === 'BUY'
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                    : 'bg-rose-500 hover:bg-rose-400 text-white'
                }`}
              >
                <span>
                  {calcSide === 'BUY'
                    ? lang === 'am'
                      ? 'የመግዣ ዋጋዎችን ይመልከቱ'
                      : 'See Buy Offers'
                    : lang === 'am'
                    ? 'የመሸጫ ዋጋዎችን ይመልከቱ'
                    : 'See Sell Offers'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* 2. Key Exchange Numbers */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-1 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t.metricVol}</div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            642,850 <span className="text-xs text-slate-400 font-medium">USDT</span>
          </div>
          <div className="text-[11px] text-emerald-600 font-medium">Traded in the last 24 hours</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-1 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t.metricPrice}</div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            158.35 <span className="text-xs text-slate-400 font-medium">ETB</span>
          </div>
          <div className="text-[11px] text-slate-500">Current market price</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-1 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t.metricMerchants}</div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            48 <span className="text-xs text-emerald-600 font-semibold">Online</span>
          </div>
          <div className="text-[11px] text-slate-500">ID checked & verified</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-1 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t.metricSpeed}</div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">1–2 mins</div>
          <div className="text-[11px] text-slate-500">Usual time to get your USDT</div>
        </div>
      </section>

      {/* 3. How It Works (3 Simple Steps) */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {t.whatIsEscrowTitle}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1 max-w-3xl leading-relaxed">
              {t.whatIsEscrowDesc}
            </p>
          </div>
          <Link
            href={`/trade/${latestActiveOrderId}`}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1 flex-shrink-0"
          >
            <span>{t.btnEscrowDemo}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Step 1 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-xl bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">
                  01
                </span>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Step 1
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900">{t.step1Title}</h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{t.step1Desc}</p>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <Link
                href="/market"
                className="text-xs font-semibold text-slate-900 hover:text-emerald-700 inline-flex items-center gap-1"
              >
                <span>Open P2P Market</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Step 2 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-xl bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">
                  02
                </span>
                <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">
                  Step 2
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900">{t.step2Title}</h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{t.step2Desc}</p>
            </div>
            <div className="pt-2 border-t border-slate-100">
              {currentUser?.kycStatus === 'VERIFIED' ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <Check className="w-4 h-4" />
                  <span>{t.verified} Account</span>
                </span>
              ) : (
                <button
                  onClick={() => setKycModalOpen(true)}
                  className="text-xs font-semibold text-slate-900 hover:text-emerald-700 inline-flex items-center gap-1"
                >
                  <span>{t.verifyId}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Step 3 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-xl bg-emerald-600 text-white font-mono text-xs font-bold flex items-center justify-center">
                  03
                </span>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Step 3
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900">{t.step3Title}</h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{t.step3Desc}</p>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <Link
                href="/wallet"
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1"
              >
                <span>Open Wallet</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Supported Ethiopian Banks & Mobile Money */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              {t.railsTitle}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{t.railsSub}</p>
          </div>
          <Link
            href="/wallet"
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 border border-slate-200 px-3 py-1.5 rounded-lg self-start sm:self-auto"
          >
            Save Your Bank / Telebirr Numbers →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {featuredRails.map((railId) => {
            const meta = PAYMENT_METHODS_META[railId];
            return (
              <Link
                key={railId}
                href={`/market?method=${railId}`}
                className="group rounded-2xl border border-slate-200 p-4 hover:border-slate-300 hover:bg-slate-50 transition-colors flex flex-col justify-between space-y-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-1.5 h-4 rounded-full"
                        style={{ backgroundColor: meta.accentColor }}
                      />
                      <span className="font-bold text-slate-900 text-sm">
                        {lang === 'am' ? meta.nameAm : meta.name}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${meta.badgeBg} ${meta.badgeText} ${meta.badgeBorder}`}
                    >
                      {meta.settlementTime}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 pl-3.5">{meta.channelHint}</p>
                </div>

                <div className="pl-3.5 flex items-center justify-between text-xs font-semibold text-slate-700 group-hover:text-emerald-700">
                  <span>See {meta.shortName} Ads</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 5. Simple Safety Rules & Common Questions */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-3xl bg-slate-900 text-white p-6 sm:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
              <AlertCircle className="w-4 h-4" />
              <span>Simple Safety Rules</span>
            </span>
            <h3 className="text-xl font-bold tracking-tight">
              Three easy rules to keep every trade safe
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Follow these rules on every order to protect your money and your USDT.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-800 border border-slate-700 space-y-1">
              <div className="font-bold text-white">1. Only Use Accounts With Your Own Name</div>
              <p className="text-slate-300 leading-relaxed">
                Always send or receive Birr using a Telebirr or bank account that matches your name on Fetan.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-800 border border-slate-700 space-y-1">
              <div className="font-bold text-white">2. Do Not Write &ldquo;Crypto&rdquo; in Payment Notes</div>
              <p className="text-slate-300 leading-relaxed">
                Never write &ldquo;USDT&rdquo;, &ldquo;Crypto&rdquo;, or &ldquo;P2P&rdquo; when sending money. Leave the note blank.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-800 border border-slate-700 space-y-1">
              <div className="font-bold text-white">3. Check Your Balance Before Releasing USDT</div>
              <p className="text-slate-300 leading-relaxed">
                If you are selling USDT, always open your Telebirr or bank app and check that the Birr is in your balance before clicking &ldquo;Confirm Payment & Complete Order&rdquo;.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 space-y-4 shadow-sm">
          <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
            {lang === 'am' ? 'ተደጋጋሚ ጥያቄዎች' : 'Common Questions'}
          </h3>

          <div className="divide-y divide-slate-200">
            {faqs.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={idx} className="py-3.5 first:pt-1 last:pb-1">
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between text-left gap-4 py-1 text-sm font-semibold text-slate-900 hover:text-emerald-700 transition-colors"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${
                        isOpen ? 'rotate-180 text-emerald-600' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed pr-6">
                      {item.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. Footer */}
      <footer className="border-t border-slate-200 pt-8 pb-4 text-xs text-slate-500 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <div className="font-bold text-slate-900">Fetan P2P • Ethiopia</div>
          <p className="text-slate-500">
            Buy and sell USDT with Ethiopian Birr safely with escrow protection.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600">
          <Link href="/market" className="hover:text-slate-900">
            P2P Market
          </Link>
          <Link href="/orders" className="hover:text-slate-900">
            Orders
          </Link>
          <Link href="/wallet" className="hover:text-slate-900">
            Wallet
          </Link>
          <Link href={`/trade/${latestActiveOrderId}`} className="hover:text-slate-900">
            Active Order
          </Link>
        </div>
      </footer>

      {/* Modals */}
      <ApplyMerchantModal isOpen={merchantModalOpen} onClose={() => setMerchantModalOpen(false)} />
      <KycModal isOpen={kycModalOpen} onClose={() => setKycModalOpen(false)} />
    </div>
  );
}
