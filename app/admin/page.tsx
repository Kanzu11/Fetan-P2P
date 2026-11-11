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
  P2POrder,
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
} from 'lucide-react';
import { ProtectedRoute } from '@/client/components/protected-route';

export default function AdminDashboardPage() {
  const { currentUser, connected, refreshUser, setNotification } = useRealtime();
  const { t } = useI18n();

  const [activeTab, setActiveTab] = useState<
    'DISPUTES' | 'USERS' | 'MERCHANTS' | 'KYC' | 'SUPERADMIN'
  >('DISPUTES');

  // State
  const [merchantApps, setMerchantApps] = useState<MerchantApplication[]>([]);
  const [kycSubmissions, setKycSubmissions] = useState<KycSubmission[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [allOrders, setAllOrders] = useState<P2POrder[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState<
    'ALL' | 'OPEN' | 'DISPUTED' | 'COMPLETED' | 'CANCELLED'
  >('ALL');

  // Inspection Lightbox Modals
  const [inspectKycModal, setInspectKycModal] = useState<KycSubmission | null>(null);
  const [inspectMerchantModal, setInspectMerchantModal] = useState<MerchantApplication | null>(null);

  // Filters for All Users Tab
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'USER' | 'MERCHANT' | 'ADMIN'>('ALL');

  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  const fetchAdminData = async () => {
    try {
      setLoading(true);
      const [merchantsRes, kycRes, usersRes, ordersRes] = await Promise.all([
        fetch('/api/admin/merchants'),
        fetch('/api/admin/kyc'),
        fetch('/api/admin/users'),
        fetch('/api/orders'),
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

  // Admin & Superadmin Action: Promote/Demote ADMIN
  const handleToggleAdminRole = async (targetUser: User) => {
    if (currentUser?.role !== 'SUPERADMIN' && currentUser?.role !== 'ADMIN') {
      setAdminError('Only Administrators or Superadmin can manage Admin privileges.');
      return;
    }

    if (targetUser.role === 'SUPERADMIN' || targetUser.telegramHandle === '@kanzedin') {
      setAdminError('Security Guard: Superadmin account (@kanzedin) cannot be modified or demoted.');
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
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
            <Building2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t.adminTitle}</h1>
            <p className="text-xs text-slate-500">{t.adminSub}</p>
          </div>
        </div>

        {/* Live Status Pill */}
        <div className="inline-flex items-center gap-2 bg-white border border-slate-200 px-3.5 py-2 rounded-xl text-xs self-start sm:self-auto shadow-sm">
          <span
            className={`inline-flex rounded-full h-2.5 w-2.5 ${
              connected ? 'bg-emerald-600' : 'bg-amber-500'
            }`}
          />
          <span className="font-semibold text-slate-800">
            {connected ? 'Live Updates Active' : 'Connecting...'}
          </span>
        </div>
      </div>

      {adminError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
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
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Open Orders & Appeals</div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">{openOrdersCount}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Verified Merchants</div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums">
            {allUsers.filter((u) => u.role === 'MERCHANT').length}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Pending Requests</div>
          <div className="text-2xl font-bold text-amber-600 tabular-nums">
            {merchantApps.filter((a) => a.status === 'PENDING').length +
              kycSubmissions.filter((k) => k.status === 'PENDING').length}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Total Users</div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">{allUsers.length}</div>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-slate-200 pb-2 text-xs">
        <button
          onClick={() => setActiveTab('DISPUTES')}
          className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-colors ${
            activeTab === 'DISPUTES'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          Orders & Appeals ({allOrders.length})
        </button>

        <button
          onClick={() => setActiveTab('USERS')}
          className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-colors ${
            activeTab === 'USERS'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          Users & Merchants ({allUsers.length})
        </button>

        <button
          onClick={() => setActiveTab('MERCHANTS')}
          className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-colors ${
            activeTab === 'MERCHANTS'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          {t.tabPendingMerchants} ({merchantApps.filter((a) => a.status === 'PENDING').length})
        </button>

        <button
          onClick={() => setActiveTab('KYC')}
          className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-colors ${
            activeTab === 'KYC'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          {t.tabKyc} ({kycSubmissions.filter((k) => k.status === 'PENDING').length})
        </button>

        {(isSuperadmin || currentUser?.role === 'ADMIN') && (
          <button
            onClick={() => setActiveTab('SUPERADMIN')}
            className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'SUPERADMIN'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Admin Roles</span>
          </button>
        )}
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 text-xs text-slate-500">
          Loading records...
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
                className={`px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
                  orderStatusFilter === f.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase text-[11px] font-semibold">
                    <th className="py-3.5 px-4">Order & Status</th>
                    <th className="py-3.5 px-4">Buyer / Seller</th>
                    <th className="py-3.5 px-4">Amount</th>
                    <th className="py-3.5 px-4">Appeal / Info</th>
                    <th className="py-3.5 px-4 text-right">Admin Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredAdminOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 space-y-1">
                        <Link
                          href={`/trade/${ord.id}`}
                          className="font-mono font-bold text-slate-900 hover:text-emerald-700 underline"
                        >
                          #{ord.id}
                        </Link>
                        <div>
                          <span
                            className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              ord.status === 'DISPUTED'
                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                : ord.status === 'COMPLETED'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : ord.status === 'PAYMENT_SENT'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : ord.status === 'CANCELLED'
                                ? 'bg-slate-100 text-slate-500 border-slate-200'
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
                          <span className="text-slate-400">Buyer:</span>{' '}
                          <strong className="text-slate-900">{displayName(ord.buyerName)}</strong>
                        </div>
                        <div>
                          <span className="text-slate-400">Seller:</span>{' '}
                          <strong className="text-slate-900">{displayName(ord.sellerName)}</strong>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 tabular-nums">
                        <div className="font-bold text-slate-900">
                          {ord.usdtAmount.toFixed(2)} USDT
                        </div>
                        <div className="text-slate-500">
                          {ord.etbAmount.toLocaleString()} ETB ({ord.paymentMethod})
                        </div>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs">
                        {ord.disputeReason ? (
                          <span className="text-rose-700 font-medium">
                            &ldquo;{ord.disputeReason}&rdquo;
                          </span>
                        ) : ord.cancelReason ? (
                          <span className="text-slate-500">
                            Cancelled: &ldquo;{ord.cancelReason}&rdquo;
                          </span>
                        ) : (
                          <span className="text-slate-400">Normal order</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {ord.status !== 'COMPLETED' && ord.status !== 'CANCELLED' ? (
                          <>
                            <button
                              onClick={() => handleResolveOrder(ord.id, 'RELEASE')}
                              disabled={actionLoadingId === ord.id}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700"
                            >
                              Complete (Pay Buyer)
                            </button>
                            <button
                              onClick={() => handleResolveOrder(ord.id, 'CANCEL')}
                              disabled={actionLoadingId === ord.id}
                              className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100"
                            >
                              Cancel Order (Refund Seller)
                            </button>
                          </>
                        ) : (
                          <Link
                            href={`/trade/${ord.id}`}
                            className="text-slate-600 hover:text-slate-900 font-semibold"
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
      ) : activeTab === 'USERS' ? (
        /* TAB: ALL USERS & MERCHANTS */
        <div className="space-y-4 text-xs">
          {/* Search & Filter */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-3 justify-between items-center shadow-sm">
            <div className="relative w-full sm:w-80">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search name, email, Telegram..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:bg-white focus:border-slate-900"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
              {(['ALL', 'USER', 'MERCHANT', 'ADMIN'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  className={`px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
                    roleFilter === r
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase text-[11px] font-semibold">
                    <th className="py-3.5 px-4">User</th>
                    <th className="py-3.5 px-4">Role</th>
                    <th className="py-3.5 px-4">Wallet Balance</th>
                    <th className="py-3.5 px-4">ID Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredUsers.map((u) => {
                    const isSelf = u.id === currentUser?.id;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span>{displayName(u.name)}</span>
                            {isSelf && (
                              <span className="text-[10px] bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">
                                YOU
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {u.telegramHandle || 'No Telegram'} • {u.email}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${
                              u.role === 'SUPERADMIN'
                                ? 'bg-slate-900 text-white border-slate-900'
                                : u.role === 'ADMIN'
                                ? 'bg-sky-50 text-sky-800 border-sky-200'
                                : u.role === 'MERCHANT'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 tabular-nums">
                          <div className="font-bold text-slate-900">
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
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              u.kycStatus === 'VERIFIED'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : u.kycStatus === 'PENDING'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}
                          >
                            {u.kycStatus}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                          {u.role === 'SUPERADMIN' ? (
                            <span className="text-[11px] text-slate-400 font-medium">
                              Superadmin
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => handleToggleMerchant(u)}
                                disabled={actionLoadingId === u.id}
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                                  u.role === 'MERCHANT'
                                    ? 'bg-white border-rose-200 text-rose-700 hover:bg-rose-50'
                                    : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                                }`}
                              >
                                {u.role === 'MERCHANT' ? 'Remove Merchant' : 'Make Merchant'}
                              </button>

                              {u.kycStatus !== 'VERIFIED' ? (
                                <button
                                  onClick={() => handleDirectKyc(u, 'VERIFIED')}
                                  disabled={actionLoadingId === u.id}
                                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                                >
                                  Approve ID
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleDirectKyc(u, 'REJECTED')}
                                  disabled={actionLoadingId === u.id}
                                  className="px-2.5 py-1.5 rounded-lg text-[11px] text-slate-400 border border-slate-200 hover:text-rose-600"
                                >
                                  Reset ID
                                </button>
                              )}

                              {!isSelf && u.telegramHandle !== '@kanzedin' && (
                                <button
                                  onClick={() => handleToggleAdminRole(u)}
                                  disabled={actionLoadingId === u.id}
                                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                                    u.role === 'ADMIN'
                                      ? 'bg-rose-600 text-white hover:bg-rose-700'
                                      : 'bg-slate-900 text-white hover:bg-slate-800'
                                  }`}
                                >
                                  {u.role === 'ADMIN' ? 'Remove Admin' : 'Make Admin'}
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase text-[11px] font-semibold">
                  <th className="py-3.5 px-4">Merchant / Applicant</th>
                  <th className="py-3.5 px-4">Business Details & Terms</th>
                  <th className="py-3.5 px-4">Proof Document</th>
                  <th className="py-3.5 px-4">{t.balance}</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {merchantApps.map((app) => {
                  const isUnderfunded = (app.usdtBalance ?? 0) < 10.0;
                  const isPending = app.status === 'PENDING';

                  return (
                    <tr key={app.id} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{displayName(app.userName)}</div>
                        <div className="text-[11px] text-slate-500">{app.telegramHandle || app.userEmail}</div>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-semibold text-slate-800">
                          {app.businessName || 'Independent Merchant'}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          Exp: {app.tradeExperience || 'Experienced P2P trader'}
                        </div>
                        {app.terms && (
                          <div className="text-[11px] text-slate-400 italic truncate mt-0.5">
                            &ldquo;{app.terms}&rdquo;
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {app.proofDocumentUrl ? (
                          <button
                            type="button"
                            onClick={() => setInspectMerchantModal(app)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold hover:bg-emerald-100 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Proof</span>
                          </button>
                        ) : (
                          <span className="text-slate-400 italic">No document</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 tabular-nums">
                        <div
                          className={`font-bold ${
                            isUnderfunded ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                        >
                          {(app.usdtBalance ?? 0).toFixed(2)} USDT
                        </div>
                        {isUnderfunded && (
                          <span className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                            Below 10 USDT
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            app.status === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
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
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700"
                            >
                              {t.approve}
                            </button>
                            <button
                              onClick={() => handleReviewMerchant(app.id, 'REJECT')}
                              disabled={actionLoadingId === app.id}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50"
                            >
                              {t.reject}
                            </button>
                          </>
                        ) : (
                          <span className="text-slate-400">
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase text-[11px] font-semibold">
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">{t.docType}</th>
                  <th className="py-3.5 px-4">ID Number</th>
                  <th className="py-3.5 px-4">ID Photo</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {kycSubmissions.map((sub) => {
                  const isPending = sub.status === 'PENDING';
                  return (
                    <tr key={sub.id} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{displayName(sub.userName)}</div>
                        <div className="text-[11px] text-slate-500">{sub.userEmail}</div>
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-slate-800">
                        {sub.kycDocType}
                      </td>

                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        {sub.kycDocNumber}
                      </td>

                      <td className="py-3.5 px-4">
                        {sub.docPhotoUrl ? (
                          <button
                            type="button"
                            onClick={() => setInspectKycModal(sub)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 font-bold hover:bg-sky-100 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5 text-sky-600" />
                            <span>Inspect ID Photo</span>
                          </button>
                        ) : (
                          <span className="text-slate-400 italic">No photo attached</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            sub.status === 'VERIFIED'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
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
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700"
                            >
                              {t.approve}
                            </button>
                            <button
                              onClick={() => handleReviewKyc(sub.id, 'REJECT')}
                              disabled={actionLoadingId === sub.id}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50"
                            >
                              {t.reject}
                            </button>
                          </>
                        ) : (
                          <span className="text-slate-400">
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
      ) : (
        /* TAB: SUPERADMIN ROLE MANAGEMENT */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden text-xs">
          <div className="p-5 bg-slate-900 text-white space-y-1">
            <h2 className="text-sm font-bold">Manage Admin Accounts</h2>
            <p className="text-xs text-slate-400">
              Give or remove Admin access for platform users.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase text-[11px] font-semibold">
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">Current Role</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {allUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{displayName(u.name)}</div>
                      <div className="text-[11px] text-slate-500">{u.email}</div>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-800">{u.role}</td>
                    <td className="py-3.5 px-4 text-right">
                      {u.role === 'SUPERADMIN' ? (
                        <span className="text-slate-400">Superadmin</span>
                      ) : (
                        <button
                          onClick={() => handleToggleAdminRole(u)}
                          disabled={actionLoadingId === u.id}
                          className={`px-3.5 py-1.5 rounded-lg font-bold transition-colors ${
                            u.role === 'ADMIN'
                              ? 'bg-rose-600 text-white hover:bg-rose-700'
                              : 'bg-slate-900 text-white hover:bg-slate-800'
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

      {/* Lightbox Modal: Inspect KYC ID Photo */}
      {inspectKycModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">KYC ID Document Inspection</h3>
              </div>
              <button
                onClick={() => setInspectKycModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500 font-medium">Applicant Name</div>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">{displayName(inspectKycModal.userName)}</div>
                  <div className="text-[11px] text-slate-400">{inspectKycModal.userEmail}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500 font-medium">Document Details</div>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">{inspectKycModal.kycDocType}</div>
                  <div className="font-mono text-[11px] text-emerald-700 font-bold">{inspectKycModal.kycDocNumber}</div>
                </div>
              </div>

              {inspectKycModal.docPhotoUrl ? (
                <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-950 flex flex-col items-center justify-center p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={inspectKycModal.docPhotoUrl}
                    alt="KYC Document"
                    className="max-h-[360px] w-auto object-contain rounded-lg shadow"
                  />
                  <div className="pt-2 text-[11px] text-slate-400 flex items-center gap-2">
                    <a
                      href={inspectKycModal.docPhotoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open Full Resolution Image
                    </a>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs">
                  No image photo was uploaded with this submission.
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Current Status: <b className="text-slate-800">{inspectKycModal.status}</b>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInspectKycModal(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-100"
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
                      className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700"
                    >
                      Reject ID
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleReviewKyc(inspectKycModal.id, 'APPROVE');
                        setInspectKycModal(null);
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
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

      {/* Lightbox Modal: Inspect Merchant Proof Document */}
      {inspectMerchantModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">Merchant Application Review</h3>
              </div>
              <button
                onClick={() => setInspectMerchantModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-0.5">
                  <div className="text-slate-500 font-medium">Business / Trade Name</div>
                  <div className="font-bold text-slate-900 text-sm">
                    {inspectMerchantModal.businessName || inspectMerchantModal.userName}
                  </div>
                  <div className="text-[11px] text-slate-400">{inspectMerchantModal.userEmail}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-0.5">
                  <div className="text-slate-500 font-medium">USDT Balance</div>
                  <div className="font-bold text-emerald-700 text-sm">
                    {(inspectMerchantModal.usdtBalance ?? 0).toFixed(2)} USDT
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {(inspectMerchantModal.usdtBalance ?? 0) >= 10 ? 'Eligible (>=10 USDT)' : 'Low Balance'}
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="text-slate-500 font-medium">P2P Trade Experience</div>
                <p className="text-slate-800 leading-relaxed">
                  {inspectMerchantModal.tradeExperience || 'Standard P2P trader'}
                </p>
              </div>

              {inspectMerchantModal.terms && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <div className="text-slate-500 font-medium">Merchant Trade Terms</div>
                  <p className="text-slate-800 italic leading-relaxed">
                    &ldquo;{inspectMerchantModal.terms}&rdquo;
                  </p>
                </div>
              )}

              {inspectMerchantModal.proofDocumentUrl && (
                <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-950 p-2 flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={inspectMerchantModal.proofDocumentUrl}
                    alt="Merchant Proof"
                    className="max-h-[300px] w-auto object-contain rounded-lg shadow"
                  />
                  <a
                    href={inspectMerchantModal.proofDocumentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pt-2 text-sky-400 hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open Full Image
                  </a>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Status: <b className="text-slate-800">{inspectMerchantModal.status}</b>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInspectMerchantModal(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-100"
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
                      className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700"
                    >
                      Reject Merchant
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleReviewMerchant(inspectMerchantModal.id, 'APPROVE');
                        setInspectMerchantModal(null);
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
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
    </div>
    </ProtectedRoute>
  );
}
