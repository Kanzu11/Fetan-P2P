'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRealtime } from './realtime-provider';
import { displayName, isAdminRole } from '@/client/types';
import {
  User,
  ShieldCheck,
  Mail,
  Phone,
  Send,
  Building2,
  Wallet,
  Clock,
  LogOut,
  Save,
  X,
  CheckCircle2,
  AlertCircle,
  Lock,
  ExternalLink,
  Edit3,
} from 'lucide-react';

export function ProfileModal({
  isOpen,
  onClose,
  onOpenKyc,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenKyc?: () => void;
}) {
  const { currentUser, refreshUser, logout, setNotification } = useRealtime();

  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'EDIT' | 'PAYMENT_METHODS'>('OVERVIEW');
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [telegramHandle, setTelegramHandle] = useState('');

  // Payment details
  const [telebirr, setTelebirr] = useState('');
  const [cbeAccount, setCbeAccount] = useState('');
  const [abyssiniaAccount, setAbyssiniaAccount] = useState('');
  const [awashAccount, setAwashAccount] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser) {
      setName(currentUser.name || '');
      setNickname(currentUser.nickname || '');
      setPhone(currentUser.phone || '');
      setTelegramHandle(currentUser.telegramHandle || '');

      if (currentUser.paymentDetails) {
        setTelebirr(currentUser.paymentDetails.telebirr || '');
        setCbeAccount(currentUser.paymentDetails.cbeAccount || '');
        setAbyssiniaAccount(currentUser.paymentDetails.abyssiniaAccount || '');
        setAwashAccount(currentUser.paymentDetails.awashAccount || '');
      }
    }
  }, [currentUser]);

  if (!isOpen || !currentUser) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          name: name.trim(),
          nickname: nickname.trim(),
          phone: phone.trim(),
          telegramHandle: telegramHandle.trim(),
          paymentDetails: {
            telebirr: telebirr.trim() || undefined,
            cbeAccount: cbeAccount.trim() || undefined,
            cbeHolder: name.trim(),
            abyssiniaAccount: abyssiniaAccount.trim() || undefined,
            abyssiniaHolder: name.trim(),
            awashAccount: awashAccount.trim() || undefined,
            awashHolder: name.trim(),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile');

      await refreshUser();
      setNotification('Profile details updated successfully!');
      setActiveTab('OVERVIEW');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    onClose();
    await logout();
    setNotification('You have logged out successfully.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="liquid-glass-card rounded-t-[28px] sm:rounded-[28px] w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="liquid-glass-dark p-4 sm:p-5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-buy-500/20 border border-brand-buy-400/30 flex items-center justify-center font-bold text-brand-buy-400 text-base">
              {(currentUser.nickname || currentUser.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold tracking-tight">
                  {displayName(currentUser.name)}
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-white/10 text-brand-buy-300 px-2.5 py-0.5 rounded-full border border-white/15">
                  {currentUser.role}
                </span>
              </div>
              <p className="text-xs text-white/65">{currentUser.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-4 py-2.5 bg-white/60 border-b border-black/[0.06] flex gap-1.5 text-xs font-semibold shrink-0 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('OVERVIEW')}
            className={`px-3.5 py-1.5 rounded-full transition-all whitespace-nowrap ${activeTab === 'OVERVIEW'
              ? 'bg-brand-ink text-white font-bold shadow-sm'
              : 'text-brand-ink-soft hover:text-brand-ink hover:bg-white/70'
              }`}
          >
            Account Overview
          </button>
          <button
            onClick={() => setActiveTab('EDIT')}
            className={`px-3.5 py-1.5 rounded-full transition-all flex items-center gap-1.5 whitespace-nowrap ${activeTab === 'EDIT'
              ? 'bg-brand-ink text-white font-bold shadow-sm'
              : 'text-brand-ink-soft hover:text-brand-ink hover:bg-white/70'
              }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit Profile</span>
          </button>
          <button
            onClick={() => setActiveTab('PAYMENT_METHODS')}
            className={`px-3.5 py-1.5 rounded-full transition-all flex items-center gap-1.5 whitespace-nowrap ${activeTab === 'PAYMENT_METHODS'
              ? 'bg-brand-ink text-white font-bold shadow-sm'
              : 'text-brand-ink-soft hover:text-brand-ink hover:bg-white/70'
              }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Bank & Telebirr</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {error && (
            <div className="p-3 rounded-2xl bg-rose-50/90 border border-rose-200 text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-brand-sell flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'OVERVIEW' ? (
            <div className="space-y-4">
              {/* Wallet Summary Card */}
              <div className="liquid-glass-dark p-4 rounded-2xl text-white space-y-3">
                <div className="flex justify-between items-center text-white/65">
                  <span className="flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5 text-brand-buy-400" />
                    <span>Wallet Balance</span>
                  </span>
                  <Link
                    href="/wallet"
                    onClick={onClose}
                    className="text-brand-buy-400 hover:underline flex items-center gap-1 text-[11px] font-semibold"
                  >
                    <span>Manage Wallet</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
                  <div>
                    <div className="text-[11px] text-white/60">Available</div>
                    <div className="text-xl font-mono font-bold tabular-nums text-white">
                      {currentUser.usdtBalance.toFixed(2)}{' '}
                      <span className="text-xs font-sans font-medium text-white/60">USDT</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/60">Locked in Escrow</div>
                    <div className="text-xl font-mono font-bold tabular-nums text-amber-300">
                      {currentUser.usdtLocked.toFixed(2)}{' '}
                      <span className="text-xs font-sans font-medium text-white/60">USDT</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status & Verification Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl border border-black/[0.08] bg-white/65 space-y-1">
                  <span className="text-brand-ink-soft font-medium text-[11px]">Identity KYC</span>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-[10px] ${currentUser.kycStatus === 'VERIFIED' || isAdminRole(currentUser.role)
                        ? 'bg-brand-buy-50 text-brand-buy-800 border border-brand-buy-300/60'
                        : currentUser.kycStatus === 'PENDING'
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : 'bg-black/[0.05] text-brand-ink'
                        }`}
                    >
                      {currentUser.kycStatus === 'VERIFIED' || isAdminRole(currentUser.role) ? (
                        <ShieldCheck className="w-3 h-3 text-brand-buy-600" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                      <span>{isAdminRole(currentUser.role) ? 'VERIFIED' : currentUser.kycStatus}</span>
                    </span>
                    {currentUser.kycStatus !== 'VERIFIED' && !isAdminRole(currentUser.role) && (
                      <button
                        onClick={() => {
                          onClose();
                          onOpenKyc?.();
                        }}
                        className="text-brand-buy-700 hover:underline font-bold text-[11px]"
                      >
                        Verify ID
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl border border-black/[0.08] bg-white/65 space-y-1">
                  <span className="text-brand-ink-soft font-medium text-[11px]">Merchant Status</span>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-brand-ink text-xs">
                      {currentUser.role === 'MERCHANT' ? 'Certified Merchant' : 'Regular User'}
                    </span>
                  </div>
                </div>
              </div>

              {/* User Details */}
              <div className="rounded-2xl border border-black/[0.08] divide-y divide-black/[0.06] bg-white/75">
                <div className="p-3.5 flex justify-between items-center">
                  <span className="text-brand-ink-soft">Account ID</span>
                  <span className="font-mono text-brand-ink font-semibold">{currentUser.id}</span>
                </div>
                <div className="p-3.5 flex justify-between items-center">
                  <span className="text-brand-ink-soft">Display / Nickname</span>
                  <span className="font-semibold text-brand-ink">
                    {currentUser.nickname || currentUser.name}
                  </span>
                </div>
                <div className="p-3.5 flex justify-between items-center">
                  <span className="text-brand-ink-soft">Email Address</span>
                  <span className="text-brand-ink">{currentUser.email}</span>
                </div>
                <div className="p-3.5 flex justify-between items-center">
                  <span className="text-brand-ink-soft">Telegram Handle</span>
                  <span className="font-mono font-semibold text-brand-ink">
                    {currentUser.telegramHandle || 'Not linked'}
                  </span>
                </div>
                <div className="p-3.5 flex justify-between items-center">
                  <span className="text-brand-ink-soft">Phone Number</span>
                  <span className="font-mono text-brand-ink">{currentUser.phone || 'Not set'}</span>
                </div>
                <div className="p-3.5 flex justify-between items-center">
                  <span className="text-brand-ink-soft">Completed Trades</span>
                  <span className="font-mono font-bold text-brand-buy-700">
                    {currentUser.completedTrades || 0} trades ({currentUser.completionRate ?? 100}% rate)
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {activeTab === 'EDIT' ? (
                <>
                  <div>
                    <label className="block font-semibold text-brand-ink mb-1.5">Full Legal Name</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full legal name as on bank/ID..."
                      className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-brand-ink mb-1.5">
                      Nickname / Trading Name
                    </label>
                    <input
                      type="text"
                      required
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder="Display name on P2P market..."
                      className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-brand-ink mb-1.5">
                      Phone Number (Optional)
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+251 9..."
                      className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 font-mono text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-brand-ink mb-1.5">
                      Telegram Username (For Order Alerts)
                    </label>
                    <input
                      type="text"
                      value={telegramHandle}
                      onChange={(e) => setTelegramHandle(e.target.value)}
                      placeholder="@your_username"
                      className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 font-mono text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block font-semibold text-brand-ink mb-1.5">
                      Telebirr Phone Number
                    </label>
                    <input
                      type="text"
                      value={telebirr}
                      onChange={(e) => setTelebirr(e.target.value)}
                      placeholder="09..."
                      className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 font-mono text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-brand-ink mb-1.5">
                      Commercial Bank of Ethiopia (CBE) Account
                    </label>
                    <input
                      type="text"
                      value={cbeAccount}
                      onChange={(e) => setCbeAccount(e.target.value)}
                      placeholder="1000..."
                      className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 font-mono text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-brand-ink mb-1.5">
                      Bank of Abyssinia Account
                    </label>
                    <input
                      type="text"
                      value={abyssiniaAccount}
                      onChange={(e) => setAbyssiniaAccount(e.target.value)}
                      placeholder="Account number..."
                      className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 font-mono text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-brand-ink mb-1.5">
                      Awash Bank Account
                    </label>
                    <input
                      type="text"
                      value={awashAccount}
                      onChange={(e) => setAwashAccount(e.target.value)}
                      placeholder="Account number..."
                      className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 font-mono text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 rounded-full bg-brand-ink hover:bg-neutral-800 text-white font-bold flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50"
              >
                <Save className="w-4 h-4 text-brand-buy-400" />
                <span>{saving ? 'Saving Changes...' : 'Save Profile Details'}</span>
              </button>
            </form>
          )}
        </div>

        {/* Modal Footer: Sign Out Action */}
        <div className="p-4 bg-white/70 border-t border-black/[0.06] flex items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] text-brand-ink-soft truncate">
            Signed in as <strong className="text-brand-ink">{currentUser.email}</strong>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-rose-50 hover:bg-rose-100 text-brand-sell border border-rose-200 font-bold text-xs transition-colors shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
