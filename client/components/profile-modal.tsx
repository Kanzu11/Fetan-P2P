'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRealtime } from './realtime-provider';
import { displayName } from '@/client/types';
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
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 w-full max-w-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center font-bold text-emerald-400 text-base">
              {(currentUser.nickname || currentUser.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold tracking-tight">
                  {displayName(currentUser.name)}
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-emerald-300 px-2 py-0.5 rounded-md border border-slate-700">
                  {currentUser.role}
                </span>
              </div>
              <p className="text-xs text-slate-400">{currentUser.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-2 gap-2 text-xs font-semibold shrink-0">
          <button
            onClick={() => setActiveTab('OVERVIEW')}
            className={`pb-2.5 px-3 border-b-2 transition-colors ${
              activeTab === 'OVERVIEW'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Account Overview
          </button>
          <button
            onClick={() => setActiveTab('EDIT')}
            className={`pb-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'EDIT'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit Profile</span>
          </button>
          <button
            onClick={() => setActiveTab('PAYMENT_METHODS')}
            className={`pb-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'PAYMENT_METHODS'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Bank & Telebirr</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'OVERVIEW' ? (
            <div className="space-y-4">
              {/* Wallet Summary Card */}
              <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-3">
                <div className="flex justify-between items-center text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Wallet Balance</span>
                  </span>
                  <Link
                    href="/wallet"
                    onClick={onClose}
                    className="text-emerald-400 hover:underline flex items-center gap-1 text-[11px] font-semibold"
                  >
                    <span>Manage Wallet</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-800">
                  <div>
                    <div className="text-[11px] text-slate-400">Available</div>
                    <div className="text-xl font-bold tabular-nums text-white">
                      {currentUser.usdtBalance.toFixed(2)}{' '}
                      <span className="text-xs font-medium text-slate-400">USDT</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Locked in Escrow</div>
                    <div className="text-xl font-bold tabular-nums text-amber-300">
                      {currentUser.usdtLocked.toFixed(2)}{' '}
                      <span className="text-xs font-medium text-slate-400">USDT</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status & Verification Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                  <span className="text-slate-500 font-medium text-[11px]">Identity KYC</span>
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] ${
                        currentUser.kycStatus === 'VERIFIED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : currentUser.kycStatus === 'PENDING'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {currentUser.kycStatus === 'VERIFIED' ? (
                        <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                      <span>{currentUser.kycStatus}</span>
                    </span>
                    {currentUser.kycStatus !== 'VERIFIED' && (
                      <button
                        onClick={() => {
                          onClose();
                          onOpenKyc?.();
                        }}
                        className="text-emerald-700 hover:underline font-bold text-[11px]"
                      >
                        Verify ID
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                  <span className="text-slate-500 font-medium text-[11px]">Merchant Status</span>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-xs">
                      {currentUser.role === 'MERCHANT' ? 'Certified Merchant' : 'Regular User'}
                    </span>
                  </div>
                </div>
              </div>

              {/* User Details Details */}
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
                <div className="p-3 flex justify-between items-center">
                  <span className="text-slate-500">Account ID</span>
                  <span className="font-mono text-slate-900 font-semibold">{currentUser.id}</span>
                </div>
                <div className="p-3 flex justify-between items-center">
                  <span className="text-slate-500">Display / Nickname</span>
                  <span className="font-semibold text-slate-900">
                    {currentUser.nickname || currentUser.name}
                  </span>
                </div>
                <div className="p-3 flex justify-between items-center">
                  <span className="text-slate-500">Email Address</span>
                  <span className="text-slate-900">{currentUser.email}</span>
                </div>
                <div className="p-3 flex justify-between items-center">
                  <span className="text-slate-500">Telegram Handle</span>
                  <span className="font-semibold text-slate-900">
                    {currentUser.telegramHandle || 'Not linked'}
                  </span>
                </div>
                <div className="p-3 flex justify-between items-center">
                  <span className="text-slate-500">Phone Number</span>
                  <span className="text-slate-900">{currentUser.phone || 'Not set'}</span>
                </div>
                <div className="p-3 flex justify-between items-center">
                  <span className="text-slate-500">Completed Trades</span>
                  <span className="font-bold text-emerald-600">
                    {currentUser.completedTrades || 0} trades (
                    {currentUser.completionRate ?? 100}% rate)
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {activeTab === 'EDIT' ? (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Full Legal Name</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full legal name as on bank/ID..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Nickname / Trading Name
                    </label>
                    <input
                      type="text"
                      required
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder="Display name on P2P market..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Phone Number (Optional)
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+251 9..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Telegram Username (For Order Alerts)
                    </label>
                    <input
                      type="text"
                      value={telegramHandle}
                      onChange={(e) => setTelegramHandle(e.target.value)}
                      placeholder="@your_username"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Telebirr Phone Number
                    </label>
                    <input
                      type="text"
                      value={telebirr}
                      onChange={(e) => setTelebirr(e.target.value)}
                      placeholder="09..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Commercial Bank of Ethiopia (CBE) Account
                    </label>
                    <input
                      type="text"
                      value={cbeAccount}
                      onChange={(e) => setCbeAccount(e.target.value)}
                      placeholder="1000..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Bank of Abyssinia Account
                    </label>
                    <input
                      type="text"
                      value={abyssiniaAccount}
                      onChange={(e) => setAbyssiniaAccount(e.target.value)}
                      placeholder="Account number..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Awash Bank Account
                    </label>
                    <input
                      type="text"
                      value={awashAccount}
                      onChange={(e) => setAwashAccount(e.target.value)}
                      placeholder="Account number..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4 text-emerald-400" />
                <span>{saving ? 'Saving Changes...' : 'Save Profile Details'}</span>
              </button>
            </form>
          )}
        </div>

        {/* Modal Footer: Sign Out Action */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-500">
            Fetan P2P Ethiopia • Signed in as <strong className="text-slate-800">{currentUser.email}</strong>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
