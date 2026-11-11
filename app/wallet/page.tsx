'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRealtime } from '@/client/components/realtime-provider';
import { useI18n } from '@/client/i18n';
import { PAYMENT_METHODS_META, displayName, WalletTransaction } from '@/client/types';
import {
  Wallet,
  Lock,
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Check,
  ShieldCheck,
  Building2,
  Save,
  PlusCircle,
  ArrowLeftRight,
  AlertCircle,
  Send,
  Bell,
  ExternalLink,
  MessageSquareWarning,
  CheckCircle2,
  History,
  QrCode,
  Info,
} from 'lucide-react';
import { ProtectedRoute } from '@/client/components/protected-route';

export default function WalletPage() {
  const { currentUser, refreshUser, setNotification } = useRealtime();
  const { t } = useI18n();

  const [activeAction, setActiveAction] = useState<
    'DEPOSIT' | 'WITHDRAW' | 'PAYMENT_METHODS' | 'TELEGRAM_BOT'
  >('DEPOSIT');
  const [network, setNetwork] = useState<'TRC20' | 'BEP20' | 'TON'>('TRC20');
  const [copied, setCopied] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Deposit verification state
  const [verifyTxHash, setVerifyTxHash] = useState('');
  const [verifyAmount, setVerifyAmount] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Transactions ledger state
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // Ethiopian Payment Methods state
  const [telebirr, setTelebirr] = useState('');
  const [cbeAccount, setCbeAccount] = useState('');
  const [abyssiniaAccount, setAbyssiniaAccount] = useState('');
  const [awashAccount, setAwashAccount] = useState('');
  const [cbeBirr, setCbeBirr] = useState('');
  const [dashenAccount, setDashenAccount] = useState('');
  const [savingMethods, setSavingMethods] = useState(false);

  // Telegram Bot & Order Notifications state
  const [tgHandle, setTgHandle] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [tgNotify, setTgNotify] = useState(true);
  const [savingTg, setSavingTg] = useState(false);

  // Support / Order Complaint state
  const [complaintOrderId, setComplaintOrderId] = useState('');
  const [complaintCategory, setComplaintCategory] = useState<
    'ORDER_COMPLAINT' | 'PAYMENT_ISSUE' | 'KYC_HELP' | 'GENERAL_SUPPORT'
  >('ORDER_COMPLAINT');
  const [complaintMessage, setComplaintMessage] = useState('');
  const [sendingComplaint, setSendingComplaint] = useState(false);

  useEffect(() => {
    if (currentUser?.paymentDetails) {
      setTelebirr(currentUser.paymentDetails.telebirr || '');
      setCbeAccount(currentUser.paymentDetails.cbeAccount || '');
      setAbyssiniaAccount(currentUser.paymentDetails.abyssiniaAccount || '');
      setAwashAccount(currentUser.paymentDetails.awashAccount || '');
      setCbeBirr(currentUser.paymentDetails.cbeBirr || '');
      setDashenAccount(currentUser.paymentDetails.dashenAccount || '');
    }
    if (currentUser) {
      setTgHandle(currentUser.telegramHandle || '');
      setTgChatId(currentUser.telegramChatId || '');
      setTgNotify(currentUser.telegramNotifications !== false);
    }
  }, [currentUser]);

  const fetchTransactions = async () => {
    if (!currentUser?.id) return;
    setLoadingTransactions(true);
    try {
      const res = await fetch(`/api/user/transactions?userId=${currentUser.id}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
      }
    } catch (e) {
      console.warn('Failed to fetch transactions', e);
    } finally {
      setLoadingTransactions(false);
    }
  };

  useEffect(() => {
    if (currentUser?.id) {
      void fetchTransactions();
    }
  }, [currentUser?.id]);

  if (!currentUser) {
    return <div className="p-12 text-center text-slate-500 text-xs">Loading wallet...</div>;
  }

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'fetanp2probot';
  const miniAppUrl =
    process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_URL || 'https://app9136159373.tgcloud.ai/';

  const totalEquityUsdt = currentUser.usdtBalance + currentUser.usdtLocked;
  const etbEquivalent = totalEquityUsdt * 158.35;

  const depositAddresses = {
    TRC20: currentUser.depositAddresses?.trc20 || '',
    BEP20: currentUser.depositAddresses?.bep20 || '',
    TON: currentUser.depositAddresses?.ton || '',
  };
  const tonMemo = currentUser.depositAddresses?.tonMemo || '';
  const depositReady = Boolean(depositAddresses[network]);

  const handleCopyAddress = () => {
    if (!depositAddresses[network]) return;
    navigator.clipboard.writeText(depositAddresses[network]);
    setCopied(true);
    setNotification(`Copied ${network} deposit address`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyMemo = () => {
    if (!tonMemo) return;
    navigator.clipboard.writeText(tonMemo);
    setCopiedMemo(true);
    setNotification(`Copied TON Memo: ${tonMemo}`);
    setTimeout(() => setCopiedMemo(false), 2000);
  };

  const handleCopyLinkCode = () => {
    const code = currentUser.telegramLinkCode || `link_${currentUser.id}`;
    navigator.clipboard.writeText(`/start ${code}`);
    setCopiedCode(true);
    setNotification('Copied bot connect command!');
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawLoading(true);
    setWithdrawError(null);
    try {
      const res = await fetch('/api/user/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          network,
          amount: Number(withdrawAmount),
          destinationAddress: withdrawAddress,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not process withdrawal');

      setWithdrawAmount('');
      setWithdrawAddress('');
      await refreshUser();
      await fetchTransactions();
      setNotification(`Withdrawal of ${withdrawAmount} USDT submitted successfully.`);
    } catch (err: unknown) {
      setWithdrawError(err instanceof Error ? err.message : 'Could not process withdrawal');
    } finally {
      setWithdrawLoading(false);
    }
  };

  const handleVerifyDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyTxHash.trim() || !verifyAmount) return;
    setVerifyLoading(true);
    setVerifyError(null);
    try {
      const res = await fetch('/api/user/deposit/verify-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          network,
          txHash: verifyTxHash.trim(),
          amount: Number(verifyAmount),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to verify transaction');

      setVerifyTxHash('');
      setVerifyAmount('');
      await refreshUser();
      await fetchTransactions();
      setNotification(`Successfully credited +${data.transaction.amount} USDT to your wallet!`);
    } catch (err: unknown) {
      setVerifyError(err instanceof Error ? err.message : 'Failed to verify deposit');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleSavePaymentMethods = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMethods(true);
    const holderName = displayName(currentUser.name);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          paymentDetails: {
            telebirr,
            cbeAccount,
            cbeHolder: holderName,
            abyssiniaAccount,
            abyssiniaHolder: holderName,
            awashAccount,
            awashHolder: holderName,
            cbeBirr,
            dashenAccount,
          },
        }),
      });
      if (res.ok) {
        await refreshUser();
        setNotification('Your bank and Telebirr numbers have been saved!');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingMethods(false);
    }
  };

  const handleSaveTelegramSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTg(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          telegramHandle: tgHandle,
          telegramChatId: tgChatId,
          telegramNotifications: tgNotify,
        }),
      });
      if (res.ok) {
        await refreshUser();
        setNotification(
          tgNotify
            ? 'Telegram Bot connected! You will receive order alerts on @fetanp2probot.'
            : 'Telegram settings saved (order alerts paused).'
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingTg(false);
    }
  };

  const handleSendSupportComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintMessage.trim()) return;
    setSendingComplaint(true);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          orderId: complaintOrderId.trim() || undefined,
          category: complaintCategory,
          subject: complaintOrderId.trim()
            ? `Order #${complaintOrderId.trim()} Complaint`
            : `${complaintCategory.replace(/_/g, ' ')}`,
          message: complaintMessage.trim(),
          source: 'WEB',
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setComplaintMessage('');
        setComplaintOrderId('');
        setNotification('Sent to Superadmin @kanzedin via Telegram Bot & Email!');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSendingComplaint(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            {t.walletTitle}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{t.walletSub}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={miniAppUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors"
          >
            <Send className="w-3.5 h-3.5 text-sky-400" />
            <span>Open Telegram Mini App</span>
            <ExternalLink className="w-3 h-3 text-slate-400" />
          </a>

          <Link
            href="/market"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>Buy / Sell USDT with Birr</span>
          </Link>
        </div>
      </div>

      {/* Top Balance Banner */}
      <div className="rounded-3xl bg-slate-900 text-white p-6 sm:p-8 shadow-sm grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        <div className="lg:col-span-6 space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span>Total Wallet Balance</span>
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-3xl sm:text-4xl font-bold tabular-nums">
              {totalEquityUsdt.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-sm font-semibold text-emerald-400">USDT</span>
          </div>
          <div className="text-xs text-slate-400 tabular-nums">
            ≈{' '}
            {etbEquivalent.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            ETB
          </div>
        </div>

        <div className="lg:col-span-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-800 border border-slate-700 p-4 space-y-1">
            <div className="text-xs text-slate-400">Available to Use</div>
            <div className="text-xl font-bold text-white tabular-nums">
              {currentUser.usdtBalance.toFixed(2)}{' '}
              <span className="text-xs font-medium text-slate-400">USDT</span>
            </div>
            <div className="text-[11px] text-emerald-400 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              <span>Ready to sell or withdraw</span>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-800 border border-slate-700 p-4 space-y-1">
            <div className="text-xs text-slate-400">Locked in Open Orders</div>
            <div className="text-xl font-bold text-amber-300 tabular-nums">
              {currentUser.usdtLocked.toFixed(2)}{' '}
              <span className="text-xs font-medium text-slate-400">USDT</span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              <span>Held safely in escrow</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Switcher Tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveAction('DEPOSIT')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors border ${
            activeAction === 'DEPOSIT'
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
          <span>Add / Deposit USDT</span>
        </button>

        <button
          onClick={() => setActiveAction('WITHDRAW')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors border ${
            activeAction === 'WITHDRAW'
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <ArrowUpRight className="w-4 h-4 text-rose-400" />
          <span>Withdraw USDT</span>
        </button>

        <button
          onClick={() => setActiveAction('PAYMENT_METHODS')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors border ${
            activeAction === 'PAYMENT_METHODS'
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Building2 className="w-4 h-4 text-sky-400" />
          <span>Bank & Telebirr Accounts</span>
        </button>

        <button
          onClick={() => setActiveAction('TELEGRAM_BOT')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors border ${
            activeAction === 'TELEGRAM_BOT'
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Bell className="w-4 h-4 text-emerald-400" />
          <span>Telegram Bot & Order Alerts</span>
        </button>
      </div>

      {/* Tab Content */}
      {activeAction === 'DEPOSIT' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Permanent Assigned Address */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm text-xs">
            <div>
              <h2 className="text-base font-bold text-slate-900">Your Dedicated Deposit Address</h2>
              <p className="text-slate-500 mt-0.5">
                Send USDT from Binance, Bybit, OKX, or your private wallet directly to your account.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-700">Select Network</label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'TRC20', name: 'Tron (TRC-20)' },
                    { id: 'BEP20', name: 'BNB Smart Chain' },
                    { id: 'TON', name: 'TON Network' },
                  ] as const
                ).map((net) => (
                  <button
                    key={net.id}
                    type="button"
                    onClick={() => setNetwork(net.id)}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      network === net.id
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="font-bold">{net.id}</div>
                    <div
                      className={`text-[10px] ${
                        network === net.id ? 'text-slate-300' : 'text-slate-400'
                      }`}
                    >
                      {net.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {depositReady ? (
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex justify-between items-center text-slate-500">
                    <span>Your {network} Deposit Address</span>
                    <span className="text-emerald-700 font-semibold">1 Block Confirmation</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 bg-white p-3 rounded-lg border border-slate-200">
                    <span className="font-mono font-bold text-slate-900 truncate">
                      {depositAddresses[network]}
                    </span>
                    <button
                      onClick={handleCopyAddress}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 flex-shrink-0"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {network === 'TON' && tonMemo && (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                    <div className="flex justify-between items-center text-amber-900">
                      <span className="font-bold">Required TON Transfer Memo</span>
                      <span className="text-[10px] text-amber-700">Must include in transfer</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-white p-3 rounded-lg border border-amber-200">
                      <span className="font-mono font-bold text-amber-900">{tonMemo}</span>
                      <button
                        onClick={handleCopyMemo}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-900 text-white font-semibold hover:bg-amber-800 flex-shrink-0"
                      >
                        {copiedMemo ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedMemo ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2 text-amber-900">
                <div className="flex items-center gap-2 font-bold">
                  <Info className="w-4 h-4 text-amber-600" />
                  <span>Platform Deposit Node Gateway</span>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-800">
                  On-chain address derivation requires master public key configuration (`DEPOSIT_XPUB` & `DEPOSIT_TON_ADDRESS` in `.env`). In the meantime, you can deposit by submitting a valid transaction hash on the right panel.
                </p>
              </div>
            )}

            <div className="text-[11px] text-slate-500 space-y-1">
              <div>• Minimum deposit: <strong>1.00 USDT</strong></div>
              <div>• Deposits are credited automatically after required blockchain confirmations.</div>
            </div>
          </div>

          {/* On-Chain TxID Verification Card */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm text-xs">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 text-white font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Verify On-Chain Deposit</span>
              </div>
              <h3 className="text-base font-bold text-slate-900">Confirm Blockchain TxID</h3>
              <p className="text-slate-600 leading-relaxed text-[11px]">
                Already sent USDT? Paste your transaction hash (TxID) below to instantly verify and credit your balance.
              </p>
            </div>

            {verifyError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                <span>{verifyError}</span>
              </div>
            )}

            <form onSubmit={handleVerifyDeposit} className="space-y-3.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Transaction Hash (TxID)
                </label>
                <input
                  type="text"
                  required
                  value={verifyTxHash}
                  onChange={(e) => setVerifyTxHash(e.target.value)}
                  placeholder="Paste 64-character hash from TronScan / BscScan..."
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 font-mono text-xs focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Amount Deposited (USDT)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={verifyAmount}
                  onChange={(e) => setVerifyAmount(e.target.value)}
                  placeholder="e.g. 100.00"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 font-bold text-xs tabular-nums focus:outline-none focus:border-slate-900"
                />
              </div>

              <button
                type="submit"
                disabled={verifyLoading}
                className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {verifyLoading ? (
                  <span>Verifying on Blockchain...</span>
                ) : (
                  <span>Verify & Credit Deposit</span>
                )}
              </button>
            </form>
          </div>
        </div>
      ) : activeAction === 'WITHDRAW' ? (
        <div className="max-w-xl bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm text-xs">
          <div>
            <h2 className="text-base font-bold text-slate-900">Withdraw USDT</h2>
            <p className="text-slate-500 mt-0.5">
              Send your available USDT to an external wallet or exchange address.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">Select Withdrawal Network</label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'TRC20', name: 'Tron (TRC-20)' },
                  { id: 'BEP20', name: 'BNB Chain' },
                  { id: 'TON', name: 'TON Network' },
                ] as const
              ).map((net) => (
                <button
                  key={net.id}
                  type="button"
                  onClick={() => setNetwork(net.id)}
                  className={`p-2.5 rounded-xl border text-left transition-colors ${
                    network === net.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <div className="font-bold">{net.id}</div>
                  <div
                    className={`text-[10px] ${
                      network === net.id ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {net.name}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {withdrawError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <span>{withdrawError}</span>
            </div>
          )}

          <form onSubmit={handleWithdraw} className="space-y-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Recipient Wallet Address ({network})
              </label>
              <input
                type="text"
                required
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
                placeholder={
                  network === 'TRC20'
                    ? 'Starts with T (e.g. TX...)'
                    : network === 'BEP20'
                    ? 'Starts with 0x (e.g. 0x12...)'
                    : 'Starts with EQ or UQ'
                }
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-xs focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <label className="font-semibold text-slate-700">Amount (USDT)</label>
                <button
                  type="button"
                  onClick={() => setWithdrawAmount(currentUser.usdtBalance.toString())}
                  className="text-emerald-700 font-bold hover:underline"
                >
                  Available: {currentUser.usdtBalance.toFixed(2)} USDT
                </button>
              </div>
              <input
                type="number"
                step="0.01"
                min="5"
                max={currentUser.usdtBalance}
                required
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Min. 5.00"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-bold text-sm tabular-nums focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 space-y-1">
              <div>• Network fee: <strong>0.00 USDT (Covered by platform)</strong></div>
              <div>• Minimum withdrawal: <strong>5.00 USDT</strong></div>
              <div>• Processing time: <strong>5 - 15 minutes</strong></div>
            </div>

            <button
              type="submit"
              disabled={withdrawLoading || currentUser.usdtBalance < 5}
              className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {withdrawLoading ? 'Authorizing Withdrawal...' : 'Submit Withdrawal Request'}
            </button>
          </form>
        </div>
      ) : activeAction === 'PAYMENT_METHODS' ? (
        /* SAVED ETHIOPIAN BANK & TELEBIRR ACCOUNTS */
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Your Saved Bank & Telebirr Accounts
              </h2>
              <p className="text-slate-500 mt-0.5">
                Account holder name:{' '}
                <strong className="text-slate-900">{displayName(currentUser.name)}</strong>
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full font-semibold self-start sm:self-auto">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Name Checked</span>
            </span>
          </div>

          <form onSubmit={handleSavePaymentMethods} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span
                    className="w-1.5 h-4 rounded-full"
                    style={{ backgroundColor: PAYMENT_METHODS_META.TELEBIRR.accentColor }}
                  />
                  <span>Telebirr Phone Number</span>
                </div>
                <input
                  type="text"
                  value={telebirr}
                  onChange={(e) => setTelebirr(e.target.value)}
                  placeholder="e.g. 0911234567"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 bg-white font-mono text-xs focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span
                    className="w-1.5 h-4 rounded-full"
                    style={{ backgroundColor: PAYMENT_METHODS_META.CBE.accentColor }}
                  />
                  <span>Commercial Bank of Ethiopia (CBE)</span>
                </div>
                <input
                  type="text"
                  value={cbeAccount}
                  onChange={(e) => setCbeAccount(e.target.value)}
                  placeholder="e.g. 1000123456789"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 bg-white font-mono text-xs focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span
                    className="w-1.5 h-4 rounded-full"
                    style={{ backgroundColor: PAYMENT_METHODS_META.ABYSSINIA.accentColor }}
                  />
                  <span>Bank of Abyssinia (BoA)</span>
                </div>
                <input
                  type="text"
                  value={abyssiniaAccount}
                  onChange={(e) => setAbyssiniaAccount(e.target.value)}
                  placeholder="e.g. 88201944"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 bg-white font-mono text-xs focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span
                    className="w-1.5 h-4 rounded-full"
                    style={{ backgroundColor: PAYMENT_METHODS_META.AWASH.accentColor }}
                  />
                  <span>Awash Bank</span>
                </div>
                <input
                  type="text"
                  value={awashAccount}
                  onChange={(e) => setAwashAccount(e.target.value)}
                  placeholder="e.g. 01320987654321"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 bg-white font-mono text-xs focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span
                    className="w-1.5 h-4 rounded-full"
                    style={{ backgroundColor: PAYMENT_METHODS_META.CBE_BIRR.accentColor }}
                  />
                  <span>CBE Birr Phone Number</span>
                </div>
                <input
                  type="text"
                  value={cbeBirr}
                  onChange={(e) => setCbeBirr(e.target.value)}
                  placeholder="e.g. 0911234567"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 bg-white font-mono text-xs focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span
                    className="w-1.5 h-4 rounded-full"
                    style={{ backgroundColor: PAYMENT_METHODS_META.DASHEN.accentColor }}
                  />
                  <span>Dashen Bank Account</span>
                </div>
                <input
                  type="text"
                  value={dashenAccount}
                  onChange={(e) => setDashenAccount(e.target.value)}
                  placeholder="e.g. 5029184720112"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 bg-white font-mono text-xs focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingMethods}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition-colors"
              >
                <Save className="w-4 h-4" />
                <span>{savingMethods ? 'Saving...' : 'Save Accounts'}</span>
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* TELEGRAM BOT CONNECTION, MERCHANT ORDER ALERTS & SUPPORT */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
          {/* Left: Connect @fetanp2probot & Toggle Order Notifications */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Connect Telegram Bot (@{botUsername})
                </h2>
                <p className="text-slate-500 mt-0.5">
                  Merchants and users can connect the Telegram Serverless bot to receive instant order notifications, confirm payments, release USDT, and verify KYC.
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full font-bold text-[11px] shrink-0 ${
                  tgNotify
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}
              >
                {tgNotify ? 'Alerts Active' : 'Alerts Paused'}
              </span>
            </div>

            {/* 1-Click Connect Box */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900">Your Account Link Code</span>
                <span className="text-[11px] text-slate-500">Shared Database Sync</span>
              </div>
              <div className="flex items-center justify-between gap-2 bg-white p-3 rounded-lg border border-slate-200">
                <code className="font-mono font-bold text-slate-900">
                  /start {currentUser.telegramLinkCode || `link_${currentUser.id}`}
                </code>
                <button
                  type="button"
                  onClick={handleCopyLinkCode}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Copied' : 'Copy Command'}</span>
                </button>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href={`https://t.me/${botUsername}?start=${currentUser.telegramLinkCode || `link_${currentUser.id}`}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Connect @{botUsername} Now</span>
                </a>
                <a
                  href={miniAppUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold"
                >
                  <span>Open Mini App</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <form onSubmit={handleSaveTelegramSettings} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Telegram Username
                  </label>
                  <input
                    type="text"
                    value={tgHandle}
                    onChange={(e) => setTgHandle(e.target.value)}
                    placeholder="@username"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Telegram Chat ID (Auto-filled on /start)
                  </label>
                  <input
                    type="text"
                    value={tgChatId}
                    onChange={(e) => setTgChatId(e.target.value)}
                    placeholder="e.g. 913615937"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                </div>
              </div>

              <label className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tgNotify}
                  onChange={(e) => setTgNotify(e.target.checked)}
                  className="mt-0.5 rounded border-emerald-400 text-emerald-600 focus:ring-emerald-600"
                />
                <div>
                  <div className="font-bold text-slate-900">
                    Receive Order Notifications via Telegram Bot (Optional for Merchants & Users)
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    When enabled, @{botUsername} sends you a message with inline buttons whenever someone places an order on your ad, marks payment sent, or releases USDT.
                  </p>
                </div>
              </label>

              <button
                type="submit"
                disabled={savingTg}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
              >
                <Save className="w-4 h-4" />
                <span>{savingTg ? 'Saving...' : 'Save Telegram Bot Preferences'}</span>
              </button>
            </form>
          </div>

          {/* Right: Send Order Complaint / Support Ticket to Superadmin (@kanzedin) */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                <MessageSquareWarning className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Order Complaints & Support (@kanzedin)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Sent directly to Superadmin @kanzedin on Telegram & Email
                </p>
              </div>
            </div>

            <form onSubmit={handleSendSupportComplaint} className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Topic</label>
                <select
                  value={complaintCategory}
                  onChange={(e) => setComplaintCategory(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold"
                >
                  <option value="ORDER_COMPLAINT">Order Complaint / Appeal</option>
                  <option value="PAYMENT_ISSUE">Bank / Telebirr Payment Issue</option>
                  <option value="KYC_HELP">KYC Verification Help</option>
                  <option value="GENERAL_SUPPORT">General Support</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Order Number (Optional)
                </label>
                <input
                  type="text"
                  value={complaintOrderId}
                  onChange={(e) => setComplaintOrderId(e.target.value)}
                  placeholder="e.g. 20261109000101"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Describe Your Issue
                </label>
                <textarea
                  rows={3}
                  required
                  value={complaintMessage}
                  onChange={(e) => setComplaintMessage(e.target.value)}
                  placeholder="Explain what happened so @kanzedin can help resolve it..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={sendingComplaint}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold"
              >
                {sendingComplaint ? 'Sending...' : 'Send to Superadmin (@kanzedin)'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* On-Chain Ledger & Activity History */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-700" />
            <h3 className="text-sm font-bold text-slate-900">On-Chain Activity & Wallet Ledger</h3>
          </div>
          <span className="text-[11px] text-slate-400">
            {transactions.length} record{transactions.length === 1 ? '' : 's'}
          </span>
        </div>

        {loadingTransactions ? (
          <div className="py-8 text-center text-slate-400">Loading wallet ledger...</div>
        ) : transactions.length === 0 ? (
          <div className="py-8 text-center text-slate-400">
            No on-chain deposits or withdrawals recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-semibold text-[11px]">
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">Network</th>
                  <th className="pb-2">TxID / Address</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((tx) => {
                  const isDeposit = tx.type === 'DEPOSIT';
                  const explorerLink = tx.txHash
                    ? tx.network === 'TRC20'
                      ? `https://tronscan.org/#/transaction/${tx.txHash}`
                      : tx.network === 'BEP20'
                      ? `https://bscscan.com/tx/${tx.txHash}`
                      : `https://tonviewer.com/transaction/${tx.txHash}`
                    : null;

                  return (
                    <tr key={tx.id} className="text-slate-700">
                      <td className="py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            isDeposit
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {isDeposit ? (
                            <ArrowDownLeft className="w-3 h-3" />
                          ) : (
                            <ArrowUpRight className="w-3 h-3" />
                          )}
                          <span>{tx.type}</span>
                        </span>
                      </td>
                      <td className="py-3 font-bold tabular-nums">
                        <span className={isDeposit ? 'text-emerald-600' : 'text-slate-900'}>
                          {isDeposit ? '+' : '-'}
                          {tx.amount.toFixed(2)} USDT
                        </span>
                      </td>
                      <td className="py-3 font-semibold text-slate-600">{tx.network}</td>
                      <td className="py-3 font-mono text-[11px] max-w-[180px] truncate text-slate-500">
                        {explorerLink ? (
                          <a
                            href={explorerLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-600 hover:underline inline-flex items-center gap-1"
                          >
                            <span>{tx.txHash ? `${tx.txHash.slice(0, 10)}...` : 'View'}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          tx.address ? `${tx.address.slice(0, 10)}...` : '—'
                        )}
                      </td>
                      <td className="py-3 text-slate-400 text-[11px]">
                        {new Date(tx.createdAt).toLocaleDateString()}{' '}
                        {new Date(tx.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            tx.status === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : tx.status === 'PENDING'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </ProtectedRoute>
  );
}
