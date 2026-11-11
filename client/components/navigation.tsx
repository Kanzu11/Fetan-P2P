'use client';

import React, { useState } from 'react';
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
  ChevronRight,
  LogIn,
  LogOut,
  User,
} from 'lucide-react';
import { ApplyMerchantModal } from './apply-merchant-modal';
import { KycModal } from './kyc-modal';
import { AuthModal } from './auth-modal';
import { ProfileModal } from './profile-modal';

export function Navigation() {
  const pathname = usePathname();
  const { currentUser, activeOrdersCount, latestActiveOrderId, logout } = useRealtime();
  const { lang, setLang, t } = useI18n();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [merchantModalOpen, setMerchantModalOpen] = useState(false);
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const isAdmin = isAdminRole(currentUser?.role);

  const navLinks = [
    { href: '/', label: t.navOverview, exact: true },
    { href: '/market', label: t.navMarket, exact: false },
    { href: '/orders', label: t.navOrders, exact: false, badge: activeOrdersCount },
    { href: '/wallet', label: t.navWallet, exact: false },
    { href: `/trade/${latestActiveOrderId}`, label: t.navEscrow, matchPrefix: '/trade' },
  ];

  const isLinkActive = (link: { href: string; exact?: boolean; matchPrefix?: string }) => {
    if (link.matchPrefix) return pathname.startsWith(link.matchPrefix);
    if (link.exact) return pathname === link.href;
    return pathname === link.href || pathname.startsWith(`${link.href}/`);
  };

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left: Brand & Desktop Links */}
            <div className="flex items-center gap-7">
              <Link href="/" className="flex items-center gap-2.5 group">
                <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center text-white shadow-sm group-hover:bg-emerald-600 transition-colors">
                  <ArrowLeftRight className="w-4 h-4 text-emerald-400 group-hover:text-white transition-colors" />
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-900 tracking-tight text-base leading-none">
                      Fetan
                    </span>
                    <span className="text-[11px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 leading-none">
                      P2P
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-medium tracking-wider uppercase mt-0.5">
                    {t.brandSub}
                  </span>
                </div>
              </Link>

              {/* Desktop Navigation */}
              <nav className="hidden md:flex items-center gap-1">
                {navLinks.map((link) => {
                  const active = isLinkActive(link);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`relative px-3.5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                        active
                          ? 'text-slate-900 bg-slate-100 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <span>{link.label}</span>
                      {link.badge !== undefined && link.badge > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-emerald-600 text-white tabular-nums">
                          {link.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}

                {isAdmin && (
                  <Link
                    href="/admin"
                    className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                      pathname === '/admin'
                        ? 'bg-slate-900 text-white font-semibold'
                        : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>{t.navAdmin}</span>
                  </Link>
                )}
              </nav>
            </div>

            {/* Right: Desktop Controls */}
            <div className="hidden md:flex items-center gap-2.5">
              {/* Language Switcher */}
              <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-medium">
                <button
                  onClick={() => setLang('en')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    lang === 'en'
                      ? 'bg-white text-slate-900 font-semibold shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  EN
                </button>
                <button
                  onClick={() => setLang('am')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    lang === 'am'
                      ? 'bg-white text-slate-900 font-semibold shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  አማርኛ
                </button>
              </div>

              {currentUser ? (
                <>
                  {/* Wallet Balance Pill */}
                  <Link
                    href="/wallet"
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors text-xs"
                  >
                    <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="font-bold text-slate-900 tabular-nums">
                      {currentUser.usdtBalance.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      <span className="font-medium text-slate-500">USDT</span>
                    </span>
                    {currentUser.usdtLocked > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"
                        title="Locked in open order"
                      >
                        <Lock className="w-2.5 h-2.5" />
                        {currentUser.usdtLocked.toFixed(0)}
                      </span>
                    )}
                  </Link>

                  {/* User Profile Pill (See Profile & Edit) */}
                  <button
                    onClick={() => setProfileModalOpen(true)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-xs font-semibold text-slate-800 shadow-sm"
                    title="See Profile & Edit"
                  >
                    <div className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold">
                      {(currentUser.nickname || currentUser.name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate max-w-[90px]">{displayName(currentUser.name)}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase border border-slate-200">
                      {currentUser.role}
                    </span>
                  </button>

                  {/* KYC Badge or Action */}
                  {currentUser.kycStatus === 'VERIFIED' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{t.verified}</span>
                    </span>
                  ) : currentUser.kycStatus === 'PENDING' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{t.pending}</span>
                    </span>
                  ) : (
                    <button
                      onClick={() => setKycModalOpen(true)}
                      className="text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {t.verifyId}
                    </button>
                  )}

                  {/* Merchant Badge or Apply Button */}
                  {currentUser.role === 'MERCHANT' ? (
                    <Link
                      href="/orders?tab=ads"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{t.merchant}</span>
                    </Link>
                  ) : currentUser.role === 'USER' ? (
                    <button
                      onClick={() => setMerchantModalOpen(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                    >
                      <span>{t.applyMerchant}</span>
                    </button>
                  ) : null}

                  {/* Clear Log Out Button */}
                  <button
                    onClick={() => logout()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-xs font-semibold text-slate-700 transition-colors shadow-sm"
                    title="Log Out"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-500" />
                    <span>Log Out</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setAuthModalOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign In</span>
                </button>
              )}
            </div>

            {/* Mobile Right Header Controls */}
            <div className="flex md:hidden items-center gap-2">
              {currentUser && (
                <Link
                  href="/wallet"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-bold text-slate-900 tabular-nums"
                >
                  <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{currentUser.usdtBalance.toFixed(2)}</span>
                  <span className="text-[10px] font-medium text-slate-500">USDT</span>
                </Link>
              )}

              <button
                onClick={() => setLang(lang === 'en' ? 'am' : 'en')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800"
              >
                {lang === 'en' ? 'አማ' : 'EN'}
              </button>

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-lg text-slate-700 border border-slate-200 bg-white hover:bg-slate-50"
                aria-label="Toggle Menu"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-5 space-y-4 shadow-xl">
            {currentUser && (
              <div className="p-4 rounded-xl bg-slate-900 text-white space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      <span>{displayName(currentUser.name)}</span>
                      {currentUser.kycStatus === 'VERIFIED' && (
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      )}
                    </div>
                    <div className="text-xs text-slate-400">{currentUser.email}</div>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-emerald-300 px-2 py-0.5 rounded-md">
                    {currentUser.role}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                  <div>
                    <div className="text-[11px] text-slate-400">Available</div>
                    <div className="text-base font-bold tabular-nums">
                      {currentUser.usdtBalance.toFixed(2)} USDT
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Locked in Orders</div>
                    <div className="text-base font-bold text-amber-300 tabular-nums">
                      {currentUser.usdtLocked.toFixed(2)} USDT
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  {currentUser.kycStatus !== 'VERIFIED' && (
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setKycModalOpen(true);
                      }}
                      className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-center"
                    >
                      {t.verifyId}
                    </button>
                  )}
                  {currentUser.role === 'USER' && (
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setMerchantModalOpen(true);
                      }}
                      className="flex-1 py-2 rounded-lg bg-emerald-500 text-slate-950 text-xs font-bold text-center"
                    >
                      {t.applyMerchant}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1">
              {navLinks.map((link) => {
                const active = isLinkActive(link);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium ${
                      active
                        ? 'bg-emerald-50 text-emerald-900 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{link.label}</span>
                    <div className="flex items-center gap-2">
                      {link.badge !== undefined && link.badge > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-600 text-white">
                          {link.badge}
                        </span>
                      )}
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </Link>
                );
              })}

              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold ${
                    pathname === '/admin'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  <span>{t.navAdmin}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-800 px-2 py-0.5 rounded">
                    Admin
                  </span>
                </Link>
              )}

              {currentUser ? (
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setProfileModalOpen(true);
                    }}
                    className="w-full py-2.5 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold text-xs flex items-center justify-center gap-2"
                  >
                    <User className="w-4 h-4 text-slate-600" />
                    <span>See Profile &amp; Edit Details</span>
                  </button>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      void logout();
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 font-bold text-xs flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-4 h-4 text-rose-500" />
                    <span>Log Out</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setAuthModalOpen(true);
                  }}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Sign In</span>
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-1.5 flex justify-around items-center text-[11px] font-medium text-slate-500">
        <Link
          href="/"
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
            pathname === '/' ? 'text-emerald-600 font-semibold' : 'hover:text-slate-900'
          }`}
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span>{t.navOverview}</span>
        </Link>

        <Link
          href="/market"
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
            pathname.startsWith('/market') ? 'text-emerald-600 font-semibold' : 'hover:text-slate-900'
          }`}
        >
          <ArrowLeftRight className="w-5 h-5 mb-0.5" />
          <span>{t.navMarket}</span>
        </Link>

        <Link
          href="/orders"
          className={`relative flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
            pathname.startsWith('/orders') ? 'text-emerald-600 font-semibold' : 'hover:text-slate-900'
          }`}
        >
          <div className="relative">
            <ClipboardList className="w-5 h-5 mb-0.5" />
            {activeOrdersCount > 0 && (
              <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                {activeOrdersCount}
              </span>
            )}
          </div>
          <span>{t.navOrders}</span>
        </Link>

        <Link
          href="/wallet"
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
            pathname.startsWith('/wallet') ? 'text-emerald-600 font-semibold' : 'hover:text-slate-900'
          }`}
        >
          <Wallet className="w-5 h-5 mb-0.5" />
          <span>{t.navWallet}</span>
        </Link>

        {isAdmin ? (
          <Link
            href="/admin"
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
              pathname.startsWith('/admin') ? 'text-emerald-600 font-semibold' : 'hover:text-slate-900'
            }`}
          >
            <Building2 className="w-5 h-5 mb-0.5" />
            <span>{t.navAdmin}</span>
          </Link>
        ) : (
          <Link
            href={`/trade/${latestActiveOrderId}`}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
              pathname.startsWith('/trade') ? 'text-emerald-600 font-semibold' : 'hover:text-slate-900'
            }`}
          >
            <Lock className="w-5 h-5 mb-0.5" />
            <span>{t.navEscrow}</span>
          </Link>
        )}
      </nav>

      {/* Modals */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      <ApplyMerchantModal isOpen={merchantModalOpen} onClose={() => setMerchantModalOpen(false)} />
      <KycModal isOpen={kycModalOpen} onClose={() => setKycModalOpen(false)} />
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
