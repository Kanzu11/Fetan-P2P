'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRealtime } from './realtime-provider';
import { useI18n } from '@/client/i18n';
import { displayName, isAdminRole } from '@/client/types';
import {
  ShieldCheck,
  ArrowLeftRight,
  Lock,
  UserCheck,
  Wallet,
  ClipboardList,
  Menu,
  X,
  Building2,
  Clock,
  Home,
  ChevronDown,
  LogIn,
  LogOut,
  User,
  LifeBuoy,
} from 'lucide-react';
import { FetanLogo } from './fetan-logo';
import { ApplyMerchantModal } from './apply-merchant-modal';
import { KycModal } from './kyc-modal';
import { AuthModal } from './auth-modal';
import { ProfileModal } from './profile-modal';
import { SupportModal } from './support-modal';

export function Navigation() {
  const pathname = usePathname();
  const {
    currentUser,
    activeOrdersCount,
    latestActiveOrderId,
    isAuthModalOpen,
    setAuthModalOpen,
    logout,
  } = useRealtime();
  const { lang, setLang, t } = useI18n();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [merchantModalOpen, setMerchantModalOpen] = useState(false);
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [supportModalOpen, setSupportModalOpen] = useState(false);

  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const isAdmin = isAdminRole(currentUser?.role);

  const navLinks: Array<{
    href: string;
    label: string;
    exact?: boolean;
    matchPrefix?: string;
    badge?: number;
  }> = [
    { href: '/', label: t.navOverview, exact: true },
    { href: '/market', label: t.navMarket },
    { href: '/orders', label: t.navOrders, badge: activeOrdersCount },
    { href: '/wallet', label: t.navWallet },
  ];

  if (latestActiveOrderId) {
    navLinks.push({
      href: `/trade/${latestActiveOrderId}`,
      label: t.navEscrow,
      matchPrefix: '/trade',
    });
  }

  const isLinkActive = (link: { href: string; exact?: boolean; matchPrefix?: string }) => {
    if (link.matchPrefix) return pathname.startsWith(link.matchPrefix);
    if (link.exact) return pathname === link.href;
    return pathname === link.href || pathname.startsWith(`${link.href}/`);
  };

  return (
    <>
      <header className="sticky top-2.5 sm:top-3 z-40 px-3 sm:px-6 lg:px-8 pointer-events-none">
        <div className="max-w-6xl mx-auto pointer-events-auto">
          {/* Clear Floating Liquid Glass Capsule */}
          <div className="liquid-glass-nav rounded-full px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
            {/* Left: Bespoke Brand Logo */}
            <Link
              href="/"
              className="flex items-center shrink-0 rounded-full py-1 pl-0.5 pr-2 hover:bg-black/[0.03] transition-colors"
            >
              <FetanLogo size="sm" variant="full" />
            </Link>

            {/* Center: Segmented Frosted Glass Nav Pill */}
            <nav className="hidden md:flex items-center gap-0.5 liquid-pill-track rounded-full p-1">
              {navLinks.map((link) => {
                const active = isLinkActive(link);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-3.5 py-1.5 rounded-full text-[13px] transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap ${
                      active
                        ? 'bg-white text-brand-ink font-semibold shadow-[0_1px_4px_rgba(10,22,18,0.1)]'
                        : 'text-brand-ink-soft hover:text-brand-ink font-medium'
                    }`}
                  >
                    <span>{link.label}</span>
                    {link.badge !== undefined && link.badge > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold bg-brand-buy text-white tabular-nums">
                        {link.badge}
                      </span>
                    )}
                  </Link>
                );
              })}

              {isAdmin && (
                <Link
                  href="/admin"
                  className={`px-3.5 py-1.5 rounded-full text-[13px] transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap ${
                    pathname.startsWith('/admin')
                      ? 'bg-brand-ink text-white font-semibold shadow-sm'
                      : 'text-brand-ink-soft hover:text-brand-ink font-medium'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  <span>{t.navAdmin}</span>
                </Link>
              )}
            </nav>

            {/* Right: Desktop Utility & Account Controls */}
            <div className="hidden md:flex items-center gap-2 shrink-0">
              {/* Language Switcher */}
              <div className="inline-flex items-center p-0.5 rounded-full liquid-pill-track text-[11px] font-medium">
                <button
                  type="button"
                  onClick={() => setLang('en')}
                  className={`px-2.5 py-1 rounded-full transition-all ${
                    lang === 'en'
                      ? 'bg-white text-brand-ink font-semibold shadow-xs'
                      : 'text-brand-ink-soft hover:text-brand-ink'
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setLang('am')}
                  className={`px-2.5 py-1 rounded-full transition-all ${
                    lang === 'am'
                      ? 'bg-white text-brand-ink font-semibold shadow-xs'
                      : 'text-brand-ink-soft hover:text-brand-ink'
                  }`}
                >
                  አማ
                </button>
              </div>

              {currentUser ? (
                <>
                  {/* Wallet Balance Chip */}
                  <Link
                    href="/wallet"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/75 hover:bg-white border border-black/[0.07] transition-colors text-xs shadow-xs"
                    title="Open Wallet"
                  >
                    <Wallet className="w-3.5 h-3.5 text-brand-buy" />
                    <span className="font-semibold text-brand-ink tabular-nums font-mono">
                      {currentUser.usdtBalance.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span className="text-[10px] font-medium text-brand-ink-soft">USDT</span>
                    {currentUser.usdtLocked > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-800 bg-amber-100/80 px-1.5 py-0.5 rounded-full tabular-nums"
                        title="Locked in open order"
                      >
                        <Lock className="w-2.5 h-2.5" />
                        {currentUser.usdtLocked.toFixed(0)}
                      </span>
                    )}
                  </Link>

                  {/* Account Menu Pill */}
                  <div className="relative" ref={accountRef}>
                    <button
                      type="button"
                      onClick={() => setAccountMenuOpen((o) => !o)}
                      className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full bg-white/80 hover:bg-white border border-black/[0.08] transition-colors text-xs font-semibold text-brand-ink shadow-xs"
                      title="Account, Profile & Settings"
                    >
                      <span className="w-6 h-6 rounded-full bg-brand-ink text-white flex items-center justify-center text-[11px] font-bold relative">
                        {(currentUser.nickname || currentUser.name || 'U').charAt(0).toUpperCase()}
                        {currentUser.kycStatus === 'VERIFIED' && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand-buy border-2 border-white" />
                        )}
                      </span>
                      <span className="truncate max-w-[88px]">{displayName(currentUser.name)}</span>
                      <ChevronDown className="w-3.5 h-3.5 text-brand-ink-soft" />
                    </button>

                    {accountMenuOpen && (
                      <div className="absolute right-0 mt-2.5 w-64 liquid-glass-card rounded-[20px] p-2 shadow-glass-lg space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
                        <div className="px-3 py-2.5 rounded-xl bg-black/[0.03] space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-brand-ink truncate">
                              {displayName(currentUser.name)}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-brand-ink/10 text-brand-ink">
                              {currentUser.role}
                            </span>
                          </div>
                          <div className="text-[11px] text-brand-ink-soft truncate">
                            {currentUser.email}
                          </div>
                          <div className="pt-1 flex items-center gap-1.5">
                            {currentUser.kycStatus === 'VERIFIED' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-buy bg-brand-buy/10 px-2 py-0.5 rounded-full">
                                <ShieldCheck className="w-3 h-3" /> {t.verified}
                              </span>
                            ) : currentUser.kycStatus === 'PENDING' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                                <Clock className="w-3 h-3" /> {t.pending}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-sell bg-brand-sell/10 px-2 py-0.5 rounded-full">
                                Unverified ID
                              </span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setAccountMenuOpen(false);
                            setProfileModalOpen(true);
                          }}
                          className="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-brand-ink hover:bg-black/[0.04] flex items-center gap-2 transition-colors"
                        >
                          <User className="w-3.5 h-3.5 text-brand-ink-soft" />
                          <span>Profile &amp; Edit Details</span>
                        </button>

                        {currentUser.kycStatus !== 'VERIFIED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setAccountMenuOpen(false);
                              setKycModalOpen(true);
                            }}
                            className="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-brand-ink hover:bg-black/[0.04] flex items-center gap-2 transition-colors"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 text-brand-buy" />
                            <span>{t.verifyId}</span>
                          </button>
                        )}

                        {currentUser.role === 'MERCHANT' ? (
                          <Link
                            href="/orders?tab=ads"
                            onClick={() => setAccountMenuOpen(false)}
                            className="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-brand-ink hover:bg-black/[0.04] flex items-center gap-2 transition-colors"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-brand-buy" />
                            <span>Manage Merchant Ads</span>
                          </Link>
                        ) : currentUser.role === 'USER' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAccountMenuOpen(false);
                              setMerchantModalOpen(true);
                            }}
                            className="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-brand-ink hover:bg-black/[0.04] flex items-center gap-2 transition-colors"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-brand-ink-soft" />
                            <span>{t.applyMerchant}</span>
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => {
                            setAccountMenuOpen(false);
                            setSupportModalOpen(true);
                          }}
                          className="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-brand-ink hover:bg-black/[0.04] flex items-center gap-2 transition-colors"
                        >
                          <LifeBuoy className="w-3.5 h-3.5 text-brand-ink-soft" />
                          <span>Support Desk</span>
                        </button>

                        <div className="border-t border-black/[0.06] pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setAccountMenuOpen(false);
                              void logout();
                            }}
                            className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-brand-sell hover:bg-brand-sell/10 flex items-center gap-2 transition-colors"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>Log Out</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Direct 1-click Log Out icon button */}
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="p-2 rounded-full bg-white/75 hover:bg-brand-sell/10 hover:text-brand-sell border border-black/[0.07] text-brand-ink-soft transition-colors"
                    title="Log Out"
                    aria-label="Log Out"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full bg-brand-ink hover:bg-black text-white transition-all shadow-sm"
                >
                  <LogIn className="w-3.5 h-3.5 text-brand-buy-400" />
                  <span>Sign In</span>
                </button>
              )}
            </div>

            {/* Mobile Right Header Controls */}
            <div className="flex md:hidden items-center gap-1.5">
              {currentUser && (
                <Link
                  href="/wallet"
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/80 border border-black/[0.07] text-[11px] font-semibold text-brand-ink tabular-nums font-mono"
                >
                  <Wallet className="w-3 h-3 text-brand-buy" />
                  <span>{currentUser.usdtBalance.toFixed(1)}</span>
                </Link>
              )}

              <button
                type="button"
                onClick={() => setLang(lang === 'en' ? 'am' : 'en')}
                className="px-2.5 py-1 rounded-full bg-white/75 border border-black/[0.07] text-[11px] font-semibold text-brand-ink-soft"
              >
                {lang === 'en' ? 'አማ' : 'EN'}
              </button>

              <button
                type="button"
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="p-2 rounded-full bg-white/80 border border-black/[0.07] text-brand-ink"
                aria-label="Toggle Menu"
              >
                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Mobile Liquid Glass Popover Drawer */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-2 liquid-glass-card rounded-[24px] p-4 space-y-3 shadow-glass-lg animate-in fade-in slide-in-from-top-2 duration-150">
              {currentUser && (
                <div className="liquid-glass-dark rounded-2xl p-4 text-white space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm flex items-center gap-1.5">
                        <span className="truncate">{displayName(currentUser.name)}</span>
                        {currentUser.kycStatus === 'VERIFIED' && (
                          <ShieldCheck className="w-4 h-4 text-brand-buy-400 shrink-0" />
                        )}
                      </div>
                      <div className="text-[11px] text-white/60 truncate">{currentUser.email}</div>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-white/10 text-brand-buy-300 px-2 py-0.5 rounded-full">
                      {currentUser.role}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
                    <div>
                      <div className="text-[10px] text-white/55">Available</div>
                      <div className="text-sm font-bold font-mono tabular-nums">
                        {currentUser.usdtBalance.toFixed(2)} USDT
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-white/55">Locked</div>
                      <div className="text-sm font-bold font-mono text-amber-300 tabular-nums">
                        {currentUser.usdtLocked.toFixed(2)} USDT
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                {isAdmin && (
                  <Link
                    href="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full py-2.5 px-3.5 rounded-xl bg-brand-ink text-white text-xs font-semibold flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-brand-buy-400" /> Admin Console
                    </span>
                  </Link>
                )}

                {currentUser ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setProfileModalOpen(true);
                      }}
                      className="w-full py-2.5 px-3.5 rounded-xl bg-white/75 border border-black/[0.07] text-brand-ink text-xs font-semibold flex items-center gap-2"
                    >
                      <User className="w-4 h-4 text-brand-ink-soft" />
                      <span>Profile &amp; Edit Details</span>
                    </button>

                    {currentUser.kycStatus !== 'VERIFIED' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          setKycModalOpen(true);
                        }}
                        className="w-full py-2.5 px-3.5 rounded-xl bg-white/75 border border-black/[0.07] text-brand-ink text-xs font-semibold flex items-center gap-2"
                      >
                        <ShieldCheck className="w-4 h-4 text-brand-buy" />
                        <span>{t.verifyId}</span>
                      </button>
                    )}

                    {currentUser.role === 'USER' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          setMerchantModalOpen(true);
                        }}
                        className="w-full py-2.5 px-3.5 rounded-xl bg-white/75 border border-black/[0.07] text-brand-ink text-xs font-semibold flex items-center gap-2"
                      >
                        <UserCheck className="w-4 h-4 text-brand-buy" />
                        <span>{t.applyMerchant}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setSupportModalOpen(true);
                      }}
                      className="w-full py-2.5 px-3.5 rounded-xl bg-white/75 border border-black/[0.07] text-brand-ink text-xs font-semibold flex items-center gap-2"
                    >
                      <LifeBuoy className="w-4 h-4 text-brand-ink-soft" />
                      <span>Support Desk</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        void logout();
                      }}
                      className="w-full py-2.5 px-3.5 rounded-xl bg-brand-sell/10 text-brand-sell text-xs font-semibold flex items-center justify-center gap-2"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Log Out</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setAuthModalOpen(true);
                    }}
                    className="w-full py-2.5 rounded-full bg-brand-ink text-white font-semibold text-xs flex items-center justify-center gap-2"
                  >
                    <LogIn className="w-4 h-4 text-brand-buy-400" />
                    <span>Sign In</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Mobile Floating Liquid Glass Dock */}
      <nav className="md:hidden fixed bottom-3 inset-x-3 z-40 pointer-events-none">
        <div className="liquid-glass-nav rounded-[24px] px-1.5 py-1.5 flex justify-around items-center text-[11px] font-medium text-brand-ink-soft pointer-events-auto">
          <Link
            href="/"
            className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-2xl transition-all ${
              pathname === '/' ? 'bg-white text-brand-ink font-semibold shadow-xs' : 'hover:text-brand-ink'
            }`}
          >
            <Home className="w-[18px] h-[18px] mb-0.5" />
            <span>{t.navOverview}</span>
          </Link>

          <Link
            href="/market"
            className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-2xl transition-all ${
              pathname.startsWith('/market')
                ? 'bg-white text-brand-ink font-semibold shadow-xs'
                : 'hover:text-brand-ink'
            }`}
          >
            <ArrowLeftRight className="w-[18px] h-[18px] mb-0.5" />
            <span>{t.navMarket}</span>
          </Link>

          <Link
            href="/orders"
            className={`relative flex flex-col items-center justify-center py-1.5 px-3 rounded-2xl transition-all ${
              pathname.startsWith('/orders')
                ? 'bg-white text-brand-ink font-semibold shadow-xs'
                : 'hover:text-brand-ink'
            }`}
          >
            <div className="relative">
              <ClipboardList className="w-[18px] h-[18px] mb-0.5" />
              {activeOrdersCount > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-brand-buy text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                  {activeOrdersCount}
                </span>
              )}
            </div>
            <span>{t.navOrders}</span>
          </Link>

          <Link
            href="/wallet"
            className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-2xl transition-all ${
              pathname.startsWith('/wallet')
                ? 'bg-white text-brand-ink font-semibold shadow-xs'
                : 'hover:text-brand-ink'
            }`}
          >
            <Wallet className="w-[18px] h-[18px] mb-0.5" />
            <span>{t.navWallet}</span>
          </Link>

          {isAdmin ? (
            <Link
              href="/admin"
              className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-2xl transition-all ${
                pathname.startsWith('/admin')
                  ? 'bg-brand-ink text-white font-semibold shadow-xs'
                  : 'hover:text-brand-ink'
              }`}
            >
              <Building2 className="w-[18px] h-[18px] mb-0.5" />
              <span>{t.navAdmin}</span>
            </Link>
          ) : latestActiveOrderId ? (
            <Link
              href={`/trade/${latestActiveOrderId}`}
              className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-2xl transition-all ${
                pathname.startsWith('/trade')
                  ? 'bg-white text-brand-ink font-semibold shadow-xs'
                  : 'hover:text-brand-ink'
              }`}
            >
              <Lock className="w-[18px] h-[18px] mb-0.5 text-brand-buy" />
              <span>Escrow</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => (currentUser ? setProfileModalOpen(true) : setAuthModalOpen(true))}
              className="flex flex-col items-center justify-center py-1.5 px-3 rounded-2xl hover:text-brand-ink transition-all"
            >
              <User className="w-[18px] h-[18px] mb-0.5" />
              <span>{currentUser ? 'Account' : 'Sign In'}</span>
            </button>
          )}
        </div>
      </nav>

      {/* Modals */}
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setAuthModalOpen(false)} />
      <ApplyMerchantModal isOpen={merchantModalOpen} onClose={() => setMerchantModalOpen(false)} />
      <KycModal isOpen={kycModalOpen} onClose={() => setKycModalOpen(false)} />
      <SupportModal isOpen={supportModalOpen} onClose={() => setSupportModalOpen(false)} />
      <ProfileModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onOpenKyc={() => {
          setProfileModalOpen(false);
          setKycModalOpen(true);
        }}
      />
    </>
  );
}
