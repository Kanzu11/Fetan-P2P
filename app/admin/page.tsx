'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRealtime } from '@/client/components/realtime-provider';
import { useI18n } from '@/client/i18n';
import {
  MerchantApplication,
  KycSubmission,
  User,
  Role,
  KycStatus,
  P2POffer,
  P2POrder,
  WalletTransaction,
  SupportTicket,
  displayName,
} from '@/client/types';
import {
  ShieldCheck,
  Building2,
  Search,
  Lock,
  AlertCircle,
  Eye,
  FileCheck,
  X,
  ExternalLink,
  UserCheck,
  CheckCircle2,
  Image as ImageIcon,
  Zap,
  MessageSquare,
  Terminal,
  Ban,
  Megaphone,
  PauseCircle,
  PlayCircle,
  Trash2,
} from 'lucide-react';
import { ProtectedRoute } from '@/client/components/protected-route';
import { ImageLightbox } from '@/client/components/image-lightbox';

export default function AdminDashboardPage() {
  const { currentUser, connected, refreshUser, setNotification } = useRealtime();
  const { t } = useI18n();

  type AdminWithdrawalItem = WalletTransaction & {
    userName?: string;
    userEmail?: string;
    telegramHandle?: string;
  };

  type AdminAuditLogItem = {
    id: string;
    actorId?: string | null;
    actorRole?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    ip?: string | null;
    details?: unknown;
    createdAt: string;
  };

  const [activeTab, setActiveTab] = useState<
    'DISPUTES' | 'ADS' | 'USERS' | 'MERCHANTS' | 'KYC' | 'WITHDRAWALS' | 'SUPPORT' | 'AUDIT' | 'SUPERADMIN'
  >('DISPUTES');

  // State
  const [merchantApps, setMerchantApps] = useState<MerchantApplication[]>([]);
  const [kycSubmissions, setKycSubmissions] = useState<KycSubmission[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [allOrders, setAllOrders] = useState<P2POrder[]>([]);
  const [allOffers, setAllOffers] = useState<P2POffer[]>([]);
  const [adFilter, setAdFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED' | 'SELL' | 'BUY'>('ALL');
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawalItem[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [ticketReplies, setTicketReplies] = useState<Record<string, string>>({});
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogItem[]>([]);
  const [withdrawTxHashes, setWithdrawTxHashes] = useState<Record<string, string>>({});
  const [withdrawNotes, setWithdrawNotes] = useState<Record<string, string>>({});
  const [orderStatusFilter, setOrderStatusFilter] = useState<
    'ALL' | 'OPEN' | 'DISPUTED' | 'COMPLETED' | 'CANCELLED'
  >('ALL');

  // Inspection Modals & Zoom Lightbox
  const [inspectKycModal, setInspectKycModal] = useState<KycSubmission | null>(null);
  const [inspectMerchantModal, setInspectMerchantModal] = useState<MerchantApplication | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<{ src: string; title: string } | null>(null);

  // Filters for All Users Tab
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'USER' | 'MERCHANT' | 'ADMIN'>('ALL');

  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  const fetchAdminData = async () => {
    try {
      setLoading(true);
      const [merchantsRes, kycRes, usersRes, ordersRes, offersRes, withdrawalsRes, supportRes, auditRes] =
        await Promise.all([
          fetch('/api/admin/merchants'),
          fetch('/api/admin/kyc'),
          fetch('/api/admin/users'),
          fetch('/api/orders'),
          fetch('/api/offers?includeInactive=true'),
          fetch('/api/admin/withdrawals'),
          fetch('/api/support'),
          fetch('/api/admin/audit'),
        ]);

      if (merchantsRes.ok) {
        const mData = await merchantsRes.json();
        setMerchantApps(mData.applications || []);
      }

      if (kycRes.ok) {
        const kData = await kycRes.json();
        setKycSubmissions(kData.kycSubmissions || []);
      }

      if (usersRes.ok) {
        const uData = await usersRes.json();
        setAllUsers(uData.users || []);
      }

      if (ordersRes.ok) {
        const oData = await ordersRes.json();
        setAllOrders(oData.orders || []);
      }

      if (offersRes.ok) {
        const offData = await offersRes.json();
        setAllOffers(offData.offers || []);
      }

      if (withdrawalsRes.ok) {
        const wData = await withdrawalsRes.json();
        setWithdrawals(wData.withdrawals || []);
      }

      if (supportRes.ok) {
        const sData = await supportRes.json();
        setSupportTickets(sData.tickets || []);
      }

      if (auditRes.ok) {
        const aData = await auditRes.json();
        setAuditLogs(aData.logs || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  // Real-time listener on admin:dashboard
  useEffect(() => {
    const eventSource = new EventSource(`/api/events?role=${currentUser?.role || 'ADMIN'}`);

    eventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (
          payload.event === 'new_merchant_request' ||
          payload.event === 'merchant_reviewed' ||
          payload.event === 'new_kyc_submission' ||
          payload.event === 'kyc_reviewed' ||
          payload.event === 'user_role_changed' ||
          payload.event === 'merchant_status_changed' ||
          payload.event === 'dispute_alert'
        ) {
          fetchAdminData();
        }
      } catch {
        // ignore
      }
    };

    return () => {
      eventSource.close();
    };
  }, [currentUser?.role]);

  // Action: Admin Complete Order (Release USDT to Buyer) or Cancel Order (Return USDT to Seller)
  const handleResolveOrder = async (orderId: string, action: 'RELEASE' | 'CANCEL') => {
    if (!currentUser) return;
    setActionLoadingId(orderId);
    setAdminError(null);
    try {
      const endpoint =
        action === 'RELEASE'
          ? `/api/orders/${orderId}/release`
          : `/api/orders/${orderId}/cancel`;
      const body =
        action === 'RELEASE'
          ? { sellerId: currentUser.id, note: 'Completed by Admin' }
          : { userId: currentUser.id, reason: 'Cancelled by Admin' };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update order');

      setNotification(
        action === 'RELEASE'
          ? `Order #${orderId} completed: USDT sent to buyer.`
          : `Order #${orderId} cancelled: USDT returned to seller.`
      );
      await fetchAdminData();
      await refreshUser();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Could not update order');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Toggle Merchant status
  const handleToggleMerchant = async (targetUser: User) => {
    setActionLoadingId(targetUser.id);
    setAdminError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerId: currentUser?.id,
          targetUserId: targetUser.id,
          action: 'TOGGLE_MERCHANT',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');

      setNotification(`Merchant status updated for ${displayName(targetUser.name)}`);
      await fetchAdminData();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Direct KYC Status change
  const handleDirectKyc = async (targetUser: User, newKycStatus: KycStatus) => {
    setActionLoadingId(targetUser.id);
    setAdminError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerId: currentUser?.id,
          targetUserId: targetUser.id,
          action: 'UPDATE_KYC',
          newKycStatus,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');

      setNotification(`ID status set to ${newKycStatus} for ${displayName(targetUser.name)}`);
      await fetchAdminData();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Superadmin Action: Promote/Demote ADMIN
  const handleToggleAdminRole = async (targetUser: User) => {
    if (currentUser?.role !== 'SUPERADMIN') {
      setAdminError('Only Superadmin can promote or demote Admin roles.');
      return;
    }

    if (targetUser.role === 'SUPERADMIN' || targetUser.telegramHandle === '@kanzedin') {
      setAdminError('Security Guard: Primary Superadmin account cannot be modified or demoted.');
      return;
    }

    if (targetUser.id === currentUser.id) {
      setAdminError('You cannot modify your own administrative role.');
      return;
    }

    const newRole: Role = targetUser.role === 'ADMIN' ? 'USER' : 'ADMIN';

    setActionLoadingId(targetUser.id);
    setAdminError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerId: currentUser.id,
          targetUserId: targetUser.id,
          action: 'TOGGLE_ADMIN',
          newRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Role change failed');

      setNotification(`Updated role: ${displayName(targetUser.name)} is now ${newRole}`);
      await fetchAdminData();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Merchant Applications review
  const handleReviewMerchant = async (appId: string, action: 'APPROVE' | 'REJECT') => {
    setActionLoadingId(appId);
    setAdminError(null);
    try {
      const res = await fetch('/api/admin/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationId: appId,
          action,
          reviewedBy: displayName(currentUser?.name) || 'Admin',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not review request');

      setNotification(`Merchant request ${action.toLowerCase()}d`);
      await fetchAdminData();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReviewKyc = async (kycId: string, action: 'APPROVE' | 'REJECT') => {
    setActionLoadingId(kycId);
    setAdminError(null);
    try {
      const res = await fetch('/api/admin/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kycId,
          action,
          reviewedBy: displayName(currentUser?.name) || 'Admin',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not review ID');

      setNotification(`ID check ${action.toLowerCase()}d`);
      await fetchAdminData();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleResolveSupportTicket = async (ticketId: string) => {
    setActionLoadingId(ticketId);
    setAdminError(null);
    try {
      const reply = (ticketReplies[ticketId] || '').trim() || 'Resolved by Fetan Operations Team';
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RESOLVE',
          ticketId,
          adminReply: reply,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resolve support ticket');
      setNotification('Support ticket marked as resolved');
      await fetchAdminData();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Error resolving ticket');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReviewWithdrawal = async (txId: string, action: 'APPROVE' | 'REJECT') => {
    setActionLoadingId(txId);
    setAdminError(null);
    try {
      const txHash = (withdrawTxHashes[txId] || '').trim();
      const note = (withdrawNotes[txId] || '').trim();
      if (action === 'APPROVE' && !txHash) {
        throw new Error('Enter the verified payout blockchain TxHash before approving.');
      }

      const res = await fetch('/api/admin/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txId,
          action,
          txHash: txHash || undefined,
          note: note || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not process withdrawal review');

      setNotification(
        action === 'APPROVE'
          ? 'Withdrawal approved & TxHash recorded.'
          : 'Withdrawal rejected & USDT refunded to user balance.'
      );
      await fetchAdminData();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Ban / Suspend or Reactivate User
  const handleToggleSuspend = async (targetUser: User) => {
    const nextSuspended = !Boolean(targetUser.isSuspended);
    const reason = nextSuspended
      ? window.prompt(
          `Enter suspension reason for ${displayName(targetUser.name)}:`,
          'Suspended by Fetan Compliance Admin'
        )
      : undefined;

    if (nextSuspended && reason === null) return;

    setActionLoadingId(targetUser.id);
    setAdminError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: targetUser.id,
          action: 'TOGGLE_SUSPEND',
          newStatus: nextSuspended,
          suspendReason: reason || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update user suspension status');

      setNotification(
        nextSuspended
          ? `${displayName(targetUser.name)} suspended and active ads paused.`
          : `${displayName(targetUser.name)} reactivated.`
      );
      await fetchAdminData();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Error updating user suspension');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Pause / Activate Ad
  const handleToggleAdActive = async (offer: P2POffer) => {
    setActionLoadingId(offer.id);
    setAdminError(null);
    try {
      const res = await fetch(`/api/offers/${encodeURIComponent(offer.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !offer.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update ad status');

      setNotification(
        !offer.isActive
          ? `Ad #${offer.id.slice(0, 8)} activated.`
          : `Ad #${offer.id.slice(0, 8)} paused.`
      );
      await fetchAdminData();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Error updating ad');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Delete Ad
  const handleDeleteAd = async (offer: P2POffer) => {
    if (!window.confirm(`Permanently delete ${offer.offerType} ad by ${displayName(offer.merchantName)}?`)) {
      return;
    }
    setActionLoadingId(offer.id);
    setAdminError(null);
    try {
      const res = await fetch(`/api/offers/${encodeURIComponent(offer.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete ad');

      setNotification(`Ad #${offer.id.slice(0, 8)} deleted.`);
      await fetchAdminData();
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'Error deleting ad');
    } finally {
      setActionLoadingId(null);
    }
  };

  const isSuperadmin = currentUser?.role === 'SUPERADMIN';

  const filteredUsers = allUsers.filter((u) => {
    if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q) ||
        (u.telegramHandle && u.telegramHandle.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const openOrdersCount = allOrders.filter(
    (o) =>
      o.status === 'DISPUTED' ||
      o.status === 'PAYMENT_SENT' ||
      o.status === 'PENDING_PAYMENT'
  ).length;

  const filteredAdminOrders = allOrders.filter((o) => {
    if (orderStatusFilter === 'ALL') return true;
    if (orderStatusFilter === 'OPEN') {
      return (
        o.status === 'PENDING_PAYMENT' ||
        o.status === 'PAYMENT_SENT' ||
        o.status === 'DISPUTED'
      );
    }
    return o.status === orderStatusFilter;
  });

  return (
    <ProtectedRoute requireAdmin={true}>
      <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-brand-ink text-white flex items-center justify-center shadow-sm">
            <Building2 className="w-4 h-4 text-brand-buy-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-brand-ink">{t.adminTitle}</h1>
            <p className="text-xs text-brand-ink-soft">{t.adminSub}</p>
          </div>
        </div>

        {/* Live Status Pill */}
        <div className="inline-flex items-center gap-2 liquid-glass-card px-4 py-2 rounded-full text-xs self-start sm:self-auto">
          <span
            className={`inline-flex rounded-full h-2.5 w-2.5 ${
              connected ? 'bg-brand-buy-600' : 'bg-amber-500'
            }`}
          />
          <span className="font-semibold text-brand-ink">
            {connected ? 'Live Updates Active' : 'Connecting...'}
          </span>
        </div>
      </div>

      {adminError && (
        <div className="p-3.5 rounded-2xl bg-rose-50/90 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-brand-sell flex-shrink-0" />
            <span>{adminError}</span>
          </div>
          <button
            onClick={() => setAdminError(null)}
            className="text-rose-500 hover:text-rose-800 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="liquid-glass-card rounded-[22px] p-4 space-y-1">
          <div className="text-xs text-brand-ink-soft font-medium">Open Orders & Appeals</div>
          <div className="text-2xl font-mono font-bold text-brand-ink tabular-nums">{openOrdersCount}</div>
        </div>
        <div className="liquid-glass-card rounded-[22px] p-4 space-y-1">
          <div className="text-xs text-brand-ink-soft font-medium">Verified Merchants</div>
          <div className="text-2xl font-mono font-bold text-brand-buy-700 tabular-nums">
            {allUsers.filter((u) => u.role === 'MERCHANT').length}
          </div>
        </div>
        <div className="liquid-glass-card rounded-[22px] p-4 space-y-1">
          <div className="text-xs text-brand-ink-soft font-medium">Pending Requests</div>
          <div className="text-2xl font-mono font-bold text-amber-600 tabular-nums">
            {merchantApps.filter((a) => a.status === 'PENDING').length +
              kycSubmissions.filter((k) => k.status === 'PENDING').length}
          </div>
        </div>
        <div className="liquid-glass-card rounded-[22px] p-4 space-y-1">
          <div className="text-xs text-brand-ink-soft font-medium">Total Users</div>
          <div className="text-2xl font-mono font-bold text-brand-ink tabular-nums">{allUsers.length}</div>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 text-xs">
        <button
          onClick={() => setActiveTab('DISPUTES')}
          className={`px-4 py-2 rounded-full font-semibold whitespace-nowrap transition-all border ${
            activeTab === 'DISPUTES'
              ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
              : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
          }`}
        >
          Orders & Appeals ({allOrders.length})
        </button>

        <button
          onClick={() => setActiveTab('ADS')}
          className={`px-4 py-2 rounded-full font-semibold whitespace-nowrap transition-all border flex items-center gap-1.5 ${
            activeTab === 'ADS'
              ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
              : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
          }`}
        >
          <Megaphone className="w-3.5 h-3.5 text-brand-buy-600" />
          <span>Manage Ads ({allOffers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('USERS')}
          className={`px-4 py-2 rounded-full font-semibold whitespace-nowrap transition-all border ${
            activeTab === 'USERS'
              ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
              : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
          }`}
        >
          Users & Merchants ({allUsers.length})
        </button>

        <button
          onClick={() => setActiveTab('MERCHANTS')}
          className={`px-4 py-2 rounded-full font-semibold whitespace-nowrap transition-all border ${
            activeTab === 'MERCHANTS'
              ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
              : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
          }`}
        >
          {t.tabPendingMerchants} ({merchantApps.filter((a) => a.status === 'PENDING').length})
        </button>

        <button
          onClick={() => setActiveTab('KYC')}
          className={`px-4 py-2 rounded-full font-semibold whitespace-nowrap transition-all border ${
            activeTab === 'KYC'
              ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
              : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
          }`}
        >
          {t.tabKyc} ({kycSubmissions.filter((k) => k.status === 'PENDING').length})
        </button>

        <button
          onClick={() => setActiveTab('WITHDRAWALS')}
          className={`px-4 py-2 rounded-full font-semibold whitespace-nowrap transition-all border ${
            activeTab === 'WITHDRAWALS'
              ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
              : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
          }`}
        >
          Withdrawals ({withdrawals.filter((w) => w.status === 'PENDING').length})
        </button>

        <button
          onClick={() => setActiveTab('SUPPORT')}
          className={`px-4 py-2 rounded-full font-semibold whitespace-nowrap transition-all border flex items-center gap-1.5 ${
            activeTab === 'SUPPORT'
              ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
              : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
          <span>Support ({supportTickets.filter((s) => s.status !== 'RESOLVED').length})</span>
        </button>

        <button
          onClick={() => setActiveTab('AUDIT')}
          className={`px-4 py-2 rounded-full font-semibold whitespace-nowrap transition-all border flex items-center gap-1.5 ${
            activeTab === 'AUDIT'
              ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
              : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
          }`}
        >
          <Terminal className="w-3.5 h-3.5 text-sky-600" />
          <span>Audit Log ({auditLogs.length})</span>
        </button>

        {isSuperadmin && (
          <button
            onClick={() => setActiveTab('SUPERADMIN')}
            className={`px-4 py-2 rounded-full font-semibold whitespace-nowrap transition-all border flex items-center gap-1.5 ${
              activeTab === 'SUPERADMIN'
                ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
                : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-brand-buy-500" />
            <span>Admin Roles</span>
          </button>
        )}
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="liquid-glass-card rounded-[26px] p-10 space-y-3 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded-2xl bg-black/[0.06]" />
          ))}
        </div>
      ) : activeTab === 'DISPUTES' ? (
        /* TAB: ORDERS & APPEALS (Admin can Cancel or Complete any open order) */
        <div className="space-y-4 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'ALL', label: `All Orders (${allOrders.length})` },
              { id: 'OPEN', label: `Open (${openOrdersCount})` },
              {
                id: 'DISPUTED',
                label: `Appeals (${allOrders.filter((o) => o.status === 'DISPUTED').length})`,
              },
              {
                id: 'COMPLETED',
                label: `Completed (${allOrders.filter((o) => o.status === 'COMPLETED').length})`,
              },
              {
                id: 'CANCELLED',
                label: `Cancelled (${allOrders.filter((o) => o.status === 'CANCELLED').length})`,
              },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setOrderStatusFilter(f.id as any)}
                className={`px-3.5 py-1.5 rounded-full border font-semibold transition-all ${
                  orderStatusFilter === f.id
                    ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
                    : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="liquid-glass-card rounded-[26px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.07] bg-white/50 text-brand-ink-soft uppercase text-[11px] font-semibold">
                    <th className="py-3.5 px-4">Order & Status</th>
                    <th className="py-3.5 px-4">Buyer / Seller</th>
                    <th className="py-3.5 px-4">Amount</th>
                    <th className="py-3.5 px-4">Appeal / Info</th>
                    <th className="py-3.5 px-4 text-right">Admin Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {filteredAdminOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-white/75 transition-colors">
                      <td className="py-3.5 px-4 space-y-1">
                        <Link
                          href={`/trade/${ord.id}`}
                          className="font-mono font-bold text-brand-ink hover:text-brand-buy-700 underline"
                        >
                          #{ord.id}
                        </Link>
                        <div>
                          <span
                            className={`inline-block text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                              ord.status === 'DISPUTED'
                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                : ord.status === 'COMPLETED'
                                ? 'bg-brand-buy-50 text-brand-buy-800 border-brand-buy-300/60'
                                : ord.status === 'PAYMENT_SENT'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : ord.status === 'CANCELLED'
                                ? 'bg-black/[0.05] text-brand-ink-soft border-black/10'
                                : 'bg-sky-50 text-sky-800 border-sky-200'
                            }`}
                          >
                            {ord.status === 'PENDING_PAYMENT'
                              ? 'Waiting Payment'
                              : ord.status === 'PAYMENT_SENT'
                              ? 'Buyer Paid'
                              : ord.status === 'DISPUTED'
                              ? 'Appeal'
                              : ord.status}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 space-y-0.5">
                        <div>
                          <span className="text-brand-ink-soft">Buyer:</span>{' '}
                          <strong className="text-brand-ink">{displayName(ord.buyerName)}</strong>
                        </div>
                        <div>
                          <span className="text-brand-ink-soft">Seller:</span>{' '}
                          <strong className="text-brand-ink">{displayName(ord.sellerName)}</strong>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-nums">
                        <div className="font-bold text-brand-ink">
                          {ord.usdtAmount.toFixed(2)} USDT
                        </div>
                        <div className="text-brand-ink-soft">
                          {ord.etbAmount.toLocaleString()} ETB ({ord.paymentMethod})
                        </div>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs">
                        {ord.disputeReason ? (
                          <span className="text-brand-sell font-medium">
                            &ldquo;{ord.disputeReason}&rdquo;
                          </span>
                        ) : ord.cancelReason ? (
                          <span className="text-brand-ink-soft">
                            Cancelled: &ldquo;{ord.cancelReason}&rdquo;
                          </span>
                        ) : (
                          <span className="text-brand-ink-soft/60">Normal order</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {ord.status !== 'COMPLETED' && ord.status !== 'CANCELLED' ? (
                          <>
                            <button
                              onClick={() => handleResolveOrder(ord.id, 'RELEASE')}
                              disabled={actionLoadingId === ord.id}
                              className="px-3.5 py-1.5 rounded-full bg-brand-buy-600 text-white font-bold hover:bg-brand-buy-700 transition-colors"
                            >
                              Complete (Pay Buyer)
                            </button>
                            <button
                              onClick={() => handleResolveOrder(ord.id, 'CANCEL')}
                              disabled={actionLoadingId === ord.id}
                              className="px-3.5 py-1.5 rounded-full border border-rose-200 bg-rose-50 text-brand-sell font-semibold hover:bg-rose-100 transition-colors"
                            >
                              Cancel Order (Refund Seller)
                            </button>
                          </>
                        ) : (
                          <Link
                            href={`/trade/${ord.id}`}
                            className="text-brand-ink-soft hover:text-brand-ink font-semibold"
                          >
                            Open Order →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'ADS' ? (
        /* TAB: MANAGE P2P ADS */
        <div className="space-y-4 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'ALL', label: `All Ads (${allOffers.length})` },
              { id: 'ACTIVE', label: `Active (${allOffers.filter((o) => o.isActive).length})` },
              { id: 'PAUSED', label: `Paused (${allOffers.filter((o) => !o.isActive).length})` },
              { id: 'SELL', label: `Merchant Sell Ads (${allOffers.filter((o) => o.offerType === 'SELL').length})` },
              { id: 'BUY', label: `Merchant Buy Ads (${allOffers.filter((o) => o.offerType === 'BUY').length})` },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setAdFilter(f.id as 'ALL' | 'ACTIVE' | 'PAUSED' | 'SELL' | 'BUY')}
                className={`px-3.5 py-1.5 rounded-full border font-semibold transition-all ${
                  adFilter === f.id
                    ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
                    : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="liquid-glass-card rounded-[26px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.07] bg-white/50 text-brand-ink-soft uppercase text-[11px] font-semibold">
                    <th className="py-3.5 px-4">Ad & Merchant</th>
                    <th className="py-3.5 px-4">Side & Price</th>
                    <th className="py-3.5 px-4">Available & Limits</th>
                    <th className="py-3.5 px-4">Payment Rails</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Admin Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {allOffers
                    .filter((o) => {
                      if (adFilter === 'ACTIVE') return o.isActive;
                      if (adFilter === 'PAUSED') return !o.isActive;
                      if (adFilter === 'SELL' || adFilter === 'BUY') return o.offerType === adFilter;
                      return true;
                    })
                    .map((offer) => (
                      <tr key={offer.id} className="hover:bg-white/75 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-brand-ink">{displayName(offer.merchantName)}</div>
                          <div className="font-mono text-[11px] text-brand-ink-soft">#{offer.id}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              offer.offerType === 'SELL'
                                ? 'bg-brand-buy-50 text-brand-buy-800 border-brand-buy-300/60'
                                : 'bg-sky-50 text-sky-800 border-sky-200'
                            }`}
                          >
                            {offer.offerType === 'SELL' ? 'SELL (Buy USDT)' : 'BUY (Sell USDT)'}
                          </span>
                          <div className="font-mono font-bold text-brand-ink mt-1">
                            {offer.pricePerUsdtEtb.toFixed(2)} ETB
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums">
                          <div className="font-bold text-brand-ink">
                            {offer.totalAvailable.toFixed(2)} USDT
                          </div>
                          <div className="text-[11px] text-brand-ink-soft">
                            {offer.minLimitEtb.toLocaleString()}–{offer.maxLimitEtb.toLocaleString()} ETB
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1">
                            {offer.paymentMethods.map((m) => (
                              <span
                                key={m}
                                className="px-2 py-0.5 rounded-full bg-black/[0.05] text-[10px] font-semibold text-brand-ink"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              offer.isActive
                                ? 'bg-brand-buy-50 text-brand-buy-800 border-brand-buy-300/60'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}
                          >
                            {offer.isActive ? 'ACTIVE' : 'PAUSED'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => handleToggleAdActive(offer)}
                            disabled={actionLoadingId === offer.id}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
                              offer.isActive
                                ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                                : 'bg-brand-buy-50 border-brand-buy-300/60 text-brand-buy-800 hover:bg-brand-buy-100'
                            }`}
                          >
                            {offer.isActive ? (
                              <>
                                <PauseCircle className="w-3.5 h-3.5" />
                                <span>Pause</span>
                              </>
                            ) : (
                              <>
                                <PlayCircle className="w-3.5 h-3.5" />
                                <span>Activate</span>
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleDeleteAd(offer)}
                            disabled={actionLoadingId === offer.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-rose-50 border border-rose-200 text-brand-sell hover:bg-rose-100 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'USERS' ? (
        /* TAB: ALL USERS & MERCHANTS */
        <div className="space-y-4 text-xs">
          {/* Search & Filter */}
          <div className="liquid-glass-card rounded-[24px] p-4 flex flex-col sm:flex-row gap-3 justify-between items-center">
            <div className="relative w-full sm:w-80">
              <Search className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-3" />
              <input
                type="text"
                placeholder="Search name, email, Telegram..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 rounded-full border border-black/10 bg-white/75 text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
              {(['ALL', 'USER', 'MERCHANT', 'ADMIN'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  className={`px-3.5 py-1.5 rounded-full border font-semibold transition-all ${
                    roleFilter === r
                      ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
                      : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="liquid-glass-card rounded-[26px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.07] bg-white/50 text-brand-ink-soft uppercase text-[11px] font-semibold">
                    <th className="py-3.5 px-4">User</th>
                    <th className="py-3.5 px-4">Role</th>
                    <th className="py-3.5 px-4">Wallet Balance</th>
                    <th className="py-3.5 px-4">ID Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {filteredUsers.map((u) => {
                    const isSelf = u.id === currentUser?.id;
                    return (
                      <tr key={u.id} className="hover:bg-white/75 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-brand-ink flex items-center gap-1.5 flex-wrap">
                            <span>{displayName(u.name)}</span>
                            {isSelf && (
                              <span className="text-[10px] bg-black/[0.08] text-brand-ink px-2 py-0.5 rounded-full">
                                YOU
                              </span>
                            )}
                            {u.isSuspended && (
                              <span className="text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200 px-2 py-0.5 rounded-full">
                                SUSPENDED
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-brand-ink-soft">
                            {u.telegramHandle || 'No Telegram'} • {u.email}
                          </div>
                          {u.isSuspended && u.suspendReason && (
                            <div className="text-[10px] text-brand-sell mt-0.5">
                              Reason: {u.suspendReason}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              u.role === 'SUPERADMIN'
                                ? 'bg-brand-ink text-white border-brand-ink'
                                : u.role === 'ADMIN'
                                ? 'bg-sky-50 text-sky-800 border-sky-200'
                                : u.role === 'MERCHANT'
                                ? 'bg-brand-buy-50 text-brand-buy-800 border-brand-buy-300/60'
                                : 'bg-black/[0.04] text-brand-ink border-black/10'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 font-mono tabular-nums">
                          <div className="font-bold text-brand-ink">
                            {u.usdtBalance.toFixed(2)} USDT
                          </div>
                          {u.usdtLocked > 0 && (
                            <div className="text-[11px] text-amber-700">
                              <Lock className="w-3 h-3 inline mr-0.5" />
                              {u.usdtLocked.toFixed(2)} locked
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              u.kycStatus === 'VERIFIED'
                                ? 'bg-brand-buy-50 text-brand-buy-800 border-brand-buy-300/60'
                                : u.kycStatus === 'PENDING'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-black/[0.04] text-brand-ink-soft border-black/10'
                            }`}
                          >
                            {u.kycStatus}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                          {u.role === 'SUPERADMIN' ? (
                            <span className="text-[11px] text-brand-ink-soft font-medium">
                              Superadmin
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => handleToggleMerchant(u)}
                                disabled={actionLoadingId === u.id}
                                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
                                  u.role === 'MERCHANT'
                                    ? 'bg-white/80 border-rose-200 text-brand-sell hover:bg-rose-50'
                                    : 'bg-brand-buy-50 border-brand-buy-300/60 text-brand-buy-800 hover:bg-brand-buy-50/70'
                                }`}
                              >
                                {u.role === 'MERCHANT' ? 'Remove Merchant' : 'Make Merchant'}
                              </button>

                              {u.kycStatus !== 'VERIFIED' ? (
                                <button
                                  onClick={() => handleDirectKyc(u, 'VERIFIED')}
                                  disabled={actionLoadingId === u.id}
                                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-white/80 border border-black/10 text-brand-ink hover:bg-white transition-colors"
                                >
                                  Approve ID
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleDirectKyc(u, 'REJECTED')}
                                  disabled={actionLoadingId === u.id}
                                  className="px-3 py-1.5 rounded-full text-[11px] text-brand-ink-soft border border-black/10 bg-white/75 hover:text-brand-sell transition-colors"
                                >
                                  Reset ID
                                </button>
                              )}

                              {!isSelf && u.telegramHandle !== '@kanzedin' && (
                                <button
                                  onClick={() => handleToggleAdminRole(u)}
                                  disabled={actionLoadingId === u.id}
                                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                                    u.role === 'ADMIN'
                                      ? 'bg-brand-sell text-white hover:opacity-95'
                                      : 'bg-brand-ink text-white hover:bg-neutral-800'
                                  }`}
                                >
                                  {u.role === 'ADMIN' ? 'Remove Admin' : 'Make Admin'}
                                </button>
                              )}

                              {!isSelf && (
                                <button
                                  onClick={() => handleToggleSuspend(u)}
                                  disabled={actionLoadingId === u.id}
                                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                                    u.isSuspended
                                      ? 'bg-brand-buy-600 border-brand-buy-700 text-white hover:bg-brand-buy-700'
                                      : 'bg-rose-50 border-rose-200 text-brand-sell hover:bg-rose-100'
                                  }`}
                                >
                                  <Ban className="w-3 h-3" />
                                  <span>{u.isSuspended ? 'Unban' : 'Ban / Suspend'}</span>
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'MERCHANTS' ? (
        /* TAB: MERCHANT APPLICATIONS */
        <div className="liquid-glass-card rounded-[26px] overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black/[0.07] bg-white/50 text-brand-ink-soft uppercase text-[11px] font-semibold">
                  <th className="py-3.5 px-4">Merchant / Applicant</th>
                  <th className="py-3.5 px-4">Business Details & Terms</th>
                  <th className="py-3.5 px-4">Proof Document</th>
                  <th className="py-3.5 px-4">{t.balance}</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {merchantApps.map((app) => {
                  const isUnderfunded = (app.usdtBalance ?? 0) < 10.0;
                  const isPending = app.status === 'PENDING';

                  return (
                    <tr key={app.id} className="hover:bg-white/75 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-brand-ink">{displayName(app.userName)}</div>
                        <div className="text-[11px] text-brand-ink-soft">{app.telegramHandle || app.userEmail}</div>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-semibold text-brand-ink">
                          {app.businessName || 'Independent Merchant'}
                        </div>
                        <div className="text-[11px] text-brand-ink-soft truncate">
                          Exp: {app.tradeExperience || 'Experienced P2P trader'}
                        </div>
                        {app.terms && (
                          <div className="text-[11px] text-brand-ink-soft/75 italic truncate mt-0.5">
                            &ldquo;{app.terms}&rdquo;
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {app.proofDocumentUrl ? (
                          <button
                            type="button"
                            onClick={() => setInspectMerchantModal(app)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-buy-50 border border-brand-buy-300/60 text-brand-buy-800 font-semibold hover:bg-brand-buy-50/70 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Proof</span>
                          </button>
                        ) : (
                          <span className="text-brand-ink-soft/60 italic">No document</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-nums">
                        <div
                          className={`font-bold ${
                            isUnderfunded ? 'text-brand-sell' : 'text-brand-buy-700'
                          }`}
                        >
                          {(app.usdtBalance ?? 0).toFixed(2)} USDT
                        </div>
                        {isUnderfunded && (
                          <span className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                            Below 10 USDT
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            app.status === 'APPROVED'
                              ? 'bg-brand-buy-50 text-brand-buy-800 border-brand-buy-300/60'
                              : app.status === 'REJECTED'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {app.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {isPending ? (
                          <>
                            <button
                              onClick={() => handleReviewMerchant(app.id, 'APPROVE')}
                              disabled={actionLoadingId === app.id}
                              className="px-3.5 py-1.5 rounded-full bg-brand-buy-600 text-white font-bold hover:bg-brand-buy-700 transition-colors"
                            >
                              {t.approve}
                            </button>
                            <button
                              onClick={() => handleReviewMerchant(app.id, 'REJECT')}
                              disabled={actionLoadingId === app.id}
                              className="px-3.5 py-1.5 rounded-full border border-black/10 bg-white/80 text-brand-ink font-semibold hover:bg-white transition-colors"
                            >
                              {t.reject}
                            </button>
                          </>
                        ) : (
                          <span className="text-brand-ink-soft">
                            Reviewed by {app.reviewedBy || 'Admin'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'KYC' ? (
        /* TAB: ID CHECKS (KYC) */
        <div className="liquid-glass-card rounded-[26px] overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black/[0.07] bg-white/50 text-brand-ink-soft uppercase text-[11px] font-semibold">
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">{t.docType}</th>
                  <th className="py-3.5 px-4">ID Number</th>
                  <th className="py-3.5 px-4">ID Photo</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {kycSubmissions.map((sub) => {
                  const isPending = sub.status === 'PENDING';
                  return (
                    <tr key={sub.id} className="hover:bg-white/75 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-brand-ink">{displayName(sub.userName)}</div>
                        <div className="text-[11px] text-brand-ink-soft">{sub.userEmail}</div>
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-brand-ink">
                        {sub.kycDocType}
                      </td>

                      <td className="py-3.5 px-4 font-mono font-bold text-brand-ink">
                        {sub.kycDocNumber}
                      </td>

                      <td className="py-3.5 px-4">
                        {sub.docPhotoUrl ? (
                          <button
                            type="button"
                            onClick={() => setInspectKycModal(sub)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-50 border border-sky-200 text-sky-800 font-bold hover:bg-sky-100 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5 text-sky-600" />
                            <span>Inspect ID Photo</span>
                          </button>
                        ) : (
                          <span className="text-brand-ink-soft/60 italic">No photo attached</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            sub.status === 'VERIFIED'
                              ? 'bg-brand-buy-50 text-brand-buy-800 border-brand-buy-300/60'
                              : sub.status === 'REJECTED'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {sub.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {isPending ? (
                          <>
                            <button
                              onClick={() => handleReviewKyc(sub.id, 'APPROVE')}
                              disabled={actionLoadingId === sub.id}
                              className="px-3.5 py-1.5 rounded-full bg-brand-buy-600 text-white font-bold hover:bg-brand-buy-700 transition-colors"
                            >
                              {t.approve}
                            </button>
                            <button
                              onClick={() => handleReviewKyc(sub.id, 'REJECT')}
                              disabled={actionLoadingId === sub.id}
                              className="px-3.5 py-1.5 rounded-full border border-black/10 bg-white/80 text-brand-ink font-semibold hover:bg-white transition-colors"
                            >
                              {t.reject}
                            </button>
                          </>
                        ) : (
                          <span className="text-brand-ink-soft">
                            Reviewed by {sub.reviewedBy || 'Admin'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'WITHDRAWALS' ? (
        /* TAB: WITHDRAWAL PAYOUT QUEUE */
        <div className="space-y-3 text-xs">
          {withdrawals.length === 0 ? (
            <div className="p-10 text-center liquid-glass-card rounded-[26px] text-brand-ink-soft">
              No withdrawal requests recorded yet.
            </div>
          ) : (
            withdrawals.map((w) => (
              <div
                key={w.id}
                className="liquid-glass-card rounded-[24px] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-brand-ink text-sm">
                      {displayName(w.userName)}
                    </span>
                    <span className="text-brand-ink-soft">({w.userEmail || w.userId})</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        w.status === 'PENDING'
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : w.status === 'COMPLETED'
                          ? 'bg-brand-buy-50 text-brand-buy-800 border border-brand-buy-300/60'
                          : 'bg-rose-50 text-rose-800 border border-rose-200'
                      }`}
                    >
                      {w.status}
                    </span>
                  </div>
                  <div className="text-brand-ink font-semibold">
                    Amount: <span className="font-mono text-brand-sell font-bold">{w.amount.toFixed(2)} USDT</span> ({w.network})
                  </div>
                  <div className="font-mono text-[11px] text-brand-ink-soft break-all">
                    To Address: {w.address || 'N/A'}
                  </div>
                  {w.txHash && (
                    <div className="font-mono text-[11px] text-brand-buy-700 break-all">
                      TxHash: {w.txHash}
                    </div>
                  )}
                  {w.note && <div className="text-[11px] text-brand-ink-soft">Note: {w.note}</div>}
                </div>

                {w.status === 'PENDING' && (
                  <div className="flex flex-col sm:flex-row gap-2 lg:min-w-[440px]">
                    <input
                      type="text"
                      value={withdrawTxHashes[w.id] || ''}
                      onChange={(e) =>
                        setWithdrawTxHashes((prev) => ({ ...prev, [w.id]: e.target.value }))
                      }
                      placeholder="On-chain payout TxHash..."
                      className="flex-1 px-3.5 py-2 rounded-full border border-black/10 bg-white/80 font-mono text-[11px] text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                    <input
                      type="text"
                      value={withdrawNotes[w.id] || ''}
                      onChange={(e) =>
                        setWithdrawNotes((prev) => ({ ...prev, [w.id]: e.target.value }))
                      }
                      placeholder="Optional note / reason..."
                      className="sm:w-40 px-3.5 py-2 rounded-full border border-black/10 bg-white/80 text-[11px] text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleReviewWithdrawal(w.id, 'APPROVE')}
                        disabled={actionLoadingId === w.id}
                        className="px-3.5 py-2 rounded-full bg-brand-buy-600 text-white font-bold hover:bg-brand-buy-700 transition-colors disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReviewWithdrawal(w.id, 'REJECT')}
                        disabled={actionLoadingId === w.id}
                        className="px-3.5 py-2 rounded-full bg-brand-sell text-white font-bold hover:opacity-95 transition-colors disabled:opacity-50"
                      >
                        Reject &amp; Refund
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : activeTab === 'SUPPORT' ? (
        /* TAB: SUPPORT TICKETS */
        <div className="space-y-3 text-xs">
          {supportTickets.length === 0 ? (
            <div className="p-12 text-center liquid-glass-card rounded-[26px] text-brand-ink-soft">
              No support tickets or order complaints submitted yet.
            </div>
          ) : (
            supportTickets.map((ticket) => (
              <div
                key={ticket.id}
                className="liquid-glass-card rounded-[24px] p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-brand-ink">#{ticket.id}</span>
                    <span className="font-bold text-brand-ink">{displayName(ticket.userName)}</span>
                    <span className="text-brand-ink-soft">({ticket.userEmail})</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-black/[0.05] text-brand-ink">
                      {ticket.category} &bull; {ticket.source}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        ticket.status === 'RESOLVED'
                          ? 'bg-brand-buy-50 text-brand-buy-800 border border-brand-buy-300/60'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {ticket.status}
                    </span>
                  </div>
                  <div className="font-semibold text-brand-ink">
                    {ticket.subject}
                    {ticket.orderId && (
                      <Link
                        href={`/trade/${ticket.orderId}`}
                        className="ml-2 text-brand-buy-700 hover:underline font-mono"
                      >
                        Order #{ticket.orderId} →
                      </Link>
                    )}
                  </div>
                  <p className="text-brand-ink-soft leading-relaxed">{ticket.message}</p>
                  {ticket.adminReply && (
                    <div className="text-[11px] font-medium text-brand-buy-800 bg-brand-buy-50 px-3 py-1.5 rounded-xl border border-brand-buy-300/60">
                      Reply: {ticket.adminReply}
                    </div>
                  )}
                </div>

                {ticket.status !== 'RESOLVED' && (
                  <div className="flex flex-col sm:flex-row gap-2 lg:min-w-[360px]">
                    <input
                      type="text"
                      value={ticketReplies[ticket.id] || ''}
                      onChange={(e) =>
                        setTicketReplies((prev) => ({ ...prev, [ticket.id]: e.target.value }))
                      }
                      placeholder="Write private resolution note..."
                      className="flex-1 px-3.5 py-2 rounded-full border border-black/10 bg-white/80 text-[11px] text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                    <button
                      type="button"
                      disabled={actionLoadingId === ticket.id}
                      onClick={() => handleResolveSupportTicket(ticket.id)}
                      className="px-4 py-2 rounded-full bg-brand-buy-600 hover:bg-brand-buy-700 text-white font-bold transition-colors disabled:opacity-50"
                    >
                      Mark Resolved
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : activeTab === 'AUDIT' ? (
        /* TAB: SECURITY AUDIT LOG */
        <div className="liquid-glass-card rounded-[26px] overflow-hidden text-xs">
          <div className="liquid-glass-dark p-5 text-white flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">Immutable Security Audit Trail</h2>
              <p className="text-xs text-white/60">Latest 100 security, escrow, and admin actions</p>
            </div>
            <span className="font-mono text-[11px] text-brand-buy-300">
              {auditLogs.length} events
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black/[0.07] bg-white/50 text-brand-ink-soft uppercase text-[11px] font-semibold">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Target</th>
                  <th className="py-3 px-4">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/75 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-[11px] text-brand-ink-soft whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="px-2.5 py-0.5 rounded-full bg-black/[0.06] font-mono text-[10px] font-bold text-brand-ink">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-brand-ink">
                      {log.actorRole || 'SYSTEM'} &bull; {log.actorId ? `${log.actorId.slice(0, 12)}` : '—'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-brand-ink-soft">
                      {log.targetType ? `${log.targetType}:${log.targetId || ''}` : '—'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-brand-ink-soft">
                      {log.ip || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* TAB: SUPERADMIN ROLE MANAGEMENT */
        <div className="liquid-glass-card rounded-[26px] overflow-hidden text-xs">
          <div className="liquid-glass-dark p-5 text-white space-y-1">
            <h2 className="text-sm font-bold">Manage Admin Accounts</h2>
            <p className="text-xs text-white/60">
              Give or remove Admin access for platform users.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black/[0.07] bg-white/50 text-brand-ink-soft uppercase text-[11px] font-semibold">
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">Current Role</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {allUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-white/75 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-brand-ink">{displayName(u.name)}</div>
                      <div className="text-[11px] text-brand-ink-soft">{u.email}</div>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-brand-ink">{u.role}</td>
                    <td className="py-3.5 px-4 text-right">
                      {u.role === 'SUPERADMIN' ? (
                        <span className="text-brand-ink-soft">Superadmin</span>
                      ) : (
                        <button
                          onClick={() => handleToggleAdminRole(u)}
                          disabled={actionLoadingId === u.id}
                          className={`px-4 py-1.5 rounded-full font-bold transition-colors ${
                            u.role === 'ADMIN'
                              ? 'bg-brand-sell text-white hover:opacity-95'
                              : 'bg-brand-ink text-white hover:bg-neutral-800'
                          }`}
                        >
                          {u.role === 'ADMIN' ? 'Remove Admin' : 'Make Admin'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Inspect KYC ID Photo */}
      {inspectKycModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-md p-4">
          <div className="liquid-glass-card rounded-[28px] max-w-xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="liquid-glass-dark p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-brand-buy-400" />
                <h3 className="font-bold text-sm">KYC ID Document Inspection</h3>
              </div>
              <button
                onClick={() => setInspectKycModal(null)}
                className="text-white/70 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-2xl bg-white/65 border border-black/[0.08]">
                  <div className="text-brand-ink-soft font-medium">Applicant Name</div>
                  <div className="font-bold text-brand-ink text-sm mt-0.5">{displayName(inspectKycModal.userName)}</div>
                  <div className="text-[11px] text-brand-ink-soft">{inspectKycModal.userEmail}</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-white/65 border border-black/[0.08]">
                  <div className="text-brand-ink-soft font-medium">Document Details</div>
                  <div className="font-bold text-brand-ink text-sm mt-0.5">{inspectKycModal.kycDocType}</div>
                  <div className="font-mono text-[11px] text-brand-buy-700 font-bold">{inspectKycModal.kycDocNumber}</div>
                </div>
              </div>

              {inspectKycModal.docPhotoUrl ? (
                <div className="rounded-2xl border border-black/10 overflow-hidden bg-neutral-950 flex flex-col items-center justify-center p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={inspectKycModal.docPhotoUrl}
                    alt="KYC Document"
                    onClick={() =>
                      setLightboxPhoto({
                        src: inspectKycModal.docPhotoUrl!,
                        title: `KYC — ${displayName(inspectKycModal.userName)}`,
                      })
                    }
                    className="max-h-[360px] w-auto object-contain rounded-xl shadow cursor-zoom-in hover:opacity-95 transition-opacity"
                  />
                  <div className="pt-2 flex items-center gap-4 text-[11px] text-white/70">
                    <button
                      type="button"
                      onClick={() =>
                        setLightboxPhoto({
                          src: inspectKycModal.docPhotoUrl!,
                          title: `KYC — ${displayName(inspectKycModal.userName)}`,
                        })
                      }
                      className="text-brand-buy-300 hover:underline flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      Zoom Inspection
                    </button>
                    <a
                      href={inspectKycModal.docPhotoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open Original Tab
                    </a>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-brand-ink-soft bg-white/50 rounded-2xl border border-dashed border-black/15 text-xs">
                  No image photo was uploaded with this submission.
                </div>
              )}
            </div>

            <div className="p-4 bg-white/70 border-t border-black/[0.07] flex items-center justify-between gap-3">
              <span className="text-xs text-brand-ink-soft">
                Current Status: <b className="text-brand-ink">{inspectKycModal.status}</b>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInspectKycModal(null)}
                  className="px-4 py-2 rounded-full border border-black/10 bg-white text-brand-ink text-xs font-semibold hover:bg-black/[0.04]"
                >
                  Close
                </button>
                {inspectKycModal.status === 'PENDING' && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleReviewKyc(inspectKycModal.id, 'REJECT');
                        setInspectKycModal(null);
                      }}
                      className="px-4 py-2 rounded-full bg-brand-sell text-white text-xs font-bold hover:opacity-95"
                    >
                      Reject ID
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleReviewKyc(inspectKycModal.id, 'APPROVE');
                        setInspectKycModal(null);
                      }}
                      className="px-4 py-2 rounded-full bg-brand-buy-600 text-white text-xs font-bold hover:bg-brand-buy-700"
                    >
                      Approve ID
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Inspect Merchant Proof Document */}
      {inspectMerchantModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-md p-4">
          <div className="liquid-glass-card rounded-[28px] max-w-xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="liquid-glass-dark p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-brand-buy-400" />
                <h3 className="font-bold text-sm">Merchant Application Review</h3>
              </div>
              <button
                onClick={() => setInspectMerchantModal(null)}
                className="text-white/70 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl bg-white/65 border border-black/[0.08] space-y-0.5">
                  <div className="text-brand-ink-soft font-medium">Business / Trade Name</div>
                  <div className="font-bold text-brand-ink text-sm">
                    {inspectMerchantModal.businessName || inspectMerchantModal.userName}
                  </div>
                  <div className="text-[11px] text-brand-ink-soft">{inspectMerchantModal.userEmail}</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-white/65 border border-black/[0.08] space-y-0.5">
                  <div className="text-brand-ink-soft font-medium">USDT Balance</div>
                  <div className="font-mono font-bold text-brand-buy-700 text-sm tabular-nums">
                    {(inspectMerchantModal.usdtBalance ?? 0).toFixed(2)} USDT
                  </div>
                  <div className="text-[11px] text-brand-ink-soft">
                    {(inspectMerchantModal.usdtBalance ?? 0) >= 10 ? 'Eligible (>=10 USDT)' : 'Low Balance'}
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/65 border border-black/[0.08] space-y-1">
                <div className="text-brand-ink-soft font-medium">P2P Trade Experience</div>
                <p className="text-brand-ink leading-relaxed">
                  {inspectMerchantModal.tradeExperience || 'Standard P2P trader'}
                </p>
              </div>

              {inspectMerchantModal.terms && (
                <div className="p-3.5 rounded-2xl bg-white/65 border border-black/[0.08] space-y-1">
                  <div className="text-brand-ink-soft font-medium">Merchant Trade Terms</div>
                  <p className="text-brand-ink italic leading-relaxed">
                    &ldquo;{inspectMerchantModal.terms}&rdquo;
                  </p>
                </div>
              )}

              {inspectMerchantModal.proofDocumentUrl && (
                <div className="rounded-2xl border border-black/10 overflow-hidden bg-neutral-950 p-2 flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={inspectMerchantModal.proofDocumentUrl}
                    alt="Merchant Proof"
                    onClick={() =>
                      setLightboxPhoto({
                        src: inspectMerchantModal.proofDocumentUrl!,
                        title: `Merchant Proof — ${inspectMerchantModal.businessName || displayName(inspectMerchantModal.userName)}`,
                      })
                    }
                    className="max-h-[300px] w-auto object-contain rounded-xl shadow cursor-zoom-in hover:opacity-95 transition-opacity"
                  />
                  <div className="pt-2 flex items-center gap-4 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setLightboxPhoto({
                          src: inspectMerchantModal.proofDocumentUrl!,
                          title: `Merchant Proof — ${inspectMerchantModal.businessName || displayName(inspectMerchantModal.userName)}`,
                        })
                      }
                      className="text-brand-buy-300 hover:underline flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      Zoom Inspection
                    </button>
                    <a
                      href={inspectMerchantModal.proofDocumentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open Original Tab
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-white/70 border-t border-black/[0.07] flex items-center justify-between gap-3">
              <span className="text-xs text-brand-ink-soft">
                Status: <b className="text-brand-ink">{inspectMerchantModal.status}</b>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInspectMerchantModal(null)}
                  className="px-4 py-2 rounded-full border border-black/10 bg-white text-brand-ink text-xs font-semibold hover:bg-black/[0.04]"
                >
                  Close
                </button>
                {inspectMerchantModal.status === 'PENDING' && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleReviewMerchant(inspectMerchantModal.id, 'REJECT');
                        setInspectMerchantModal(null);
                      }}
                      className="px-4 py-2 rounded-full bg-brand-sell text-white text-xs font-bold hover:opacity-95"
                    >
                      Reject Merchant
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleReviewMerchant(inspectMerchantModal.id, 'APPROVE');
                        setInspectMerchantModal(null);
                      }}
                      className="px-4 py-2 rounded-full bg-brand-buy-600 text-white text-xs font-bold hover:bg-brand-buy-700"
                    >
                      Approve Merchant
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Shared Lightbox for zoomed document verification */}
      <ImageLightbox
        src={lightboxPhoto?.src ?? null}
        title={lightboxPhoto?.title}
        onClose={() => setLightboxPhoto(null)}
      />
    </div>
    </ProtectedRoute>
  );
}
