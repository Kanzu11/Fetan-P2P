'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRealtime } from '@/client/components/realtime-provider';
import { useI18n } from '@/client/i18n';
import {
  P2POrder,
  P2POffer,
  PAYMENT_METHODS_META,
  displayName,
  isAdminRole,
} from '@/client/types';
import {
  ClipboardList,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  Tag,
  Trash2,
  Power,
} from 'lucide-react';
import { CreateOfferModal } from '@/client/components/create-offer-modal';
import { ProtectedRoute } from '@/client/components/protected-route';

function OrdersContent() {
  const searchParams = useSearchParams();
  const { currentUser, setNotification } = useRealtime();
  const { t } = useI18n();

  const [mainTab, setMainTab] = useState<'ORDERS' | 'MY_ADS'>('ORDERS');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'ACTIVE' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED'
  >('ALL');

  const [orders, setOrders] = useState<P2POrder[]>([]);
  const [myOffers, setMyOffers] = useState<P2POffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get('tab') === 'ads') {
      setMainTab('MY_ADS');
    }
  }, [searchParams]);

  const fetchOrdersAndAds = async () => {
    if (!currentUser) return;
    try {
      setLoading(true);
      const isAdmin = isAdminRole(currentUser.role);
      const [ordRes, offRes] = await Promise.all([
        fetch(isAdmin ? '/api/orders' : `/api/orders?userId=${currentUser.id}`),
        fetch('/api/offers?includeInactive=true'),
      ]);

      if (ordRes.ok) {
        const ordData = await ordRes.json();
        setOrders(ordData.orders || []);
      }

      if (offRes.ok) {
        const offData = await offRes.json();
        const allOffers: P2POffer[] = offData.offers || [];
        setMyOffers(
          isAdmin ? allOffers : allOffers.filter((o) => o.merchantId === currentUser.id)
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrdersAndAds();
  }, [currentUser?.id, currentUser?.role]);

  const handleToggleOfferStatus = async (offer: P2POffer) => {
    try {
      const res = await fetch(`/api/offers/${offer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !offer.isActive }),
      });
      if (res.ok) {
        setNotification(
          `Ad is now ${!offer.isActive ? 'Online & Visible' : 'Paused'}`
        );
        fetchOrdersAndAds();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteOffer = async (offerId: string) => {
    try {
      const res = await fetch(`/api/offers/${offerId}`, { method: 'DELETE' });
      if (res.ok) {
        setNotification('Ad removed from market.');
        fetchOrdersAndAds();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'ACTIVE') {
      return o.status === 'PENDING_PAYMENT' || o.status === 'PAYMENT_SENT';
    }
    return o.status === statusFilter;
  });

  const activeCount = orders.filter(
    (o) => o.status === 'PENDING_PAYMENT' || o.status === 'PAYMENT_SENT'
  ).length;

  const isMerchant =
    currentUser?.role === 'MERCHANT' ||
    currentUser?.role === 'ADMIN' ||
    currentUser?.role === 'SUPERADMIN';

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            {t.ordersTitle}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{t.ordersSub}</p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="inline-flex p-1 rounded-xl bg-slate-200 border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setMainTab('ORDERS')}
              className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                mainTab === 'ORDERS'
                  ? 'bg-white text-slate-900 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Orders ({orders.length})</span>
            </button>
            <button
              onClick={() => setMainTab('MY_ADS')}
              className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                mainTab === 'MY_ADS'
                  ? 'bg-white text-slate-900 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>My Ads ({myOffers.length})</span>
            </button>
          </div>

          {isMerchant && (
            <button
              onClick={() => setCreateModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t.postAd}</span>
            </button>
          )}
        </div>
      </div>

      {mainTab === 'ORDERS' ? (
        /* TAB 1: ORDERS */
        <div className="space-y-4">
          {/* Status Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {[
              { id: 'ALL', label: `All (${orders.length})` },
              { id: 'ACTIVE', label: `Open (${activeCount})` },
              {
                id: 'COMPLETED',
                label: `Completed (${orders.filter((o) => o.status === 'COMPLETED').length})`,
              },
              {
                id: 'DISPUTED',
                label: `Appeals (${orders.filter((o) => o.status === 'DISPUTED').length})`,
              },
              {
                id: 'CANCELLED',
                label: `Cancelled (${orders.filter((o) => o.status === 'CANCELLED').length})`,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id as any)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors border ${
                  statusFilter === tab.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 text-xs text-slate-500">
              Loading orders...
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
              <p className="text-sm font-medium text-slate-600">
                No orders in this list yet.
              </p>
              <Link
                href="/market"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
              >
                <span>Open P2P Market</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((order) => {
                const isBuyer = currentUser?.id === order.buyerId;
                const isSeller = currentUser?.id === order.sellerId;
                const counterparty = isBuyer
                  ? displayName(order.sellerName)
                  : isSeller
                  ? displayName(order.buyerName)
                  : `${displayName(order.buyerName)} → ${displayName(order.sellerName)}`;

                const railMeta =
                  PAYMENT_METHODS_META[order.paymentMethod] || PAYMENT_METHODS_META.TELEBIRR;

                const actionLabel =
                  order.status === 'PENDING_PAYMENT' && isBuyer
                    ? 'Pay Now'
                    : order.status === 'PAYMENT_SENT' && isSeller
                    ? 'Confirm & Complete'
                    : order.status === 'DISPUTED' && isAdminRole(currentUser?.role)
                    ? 'Resolve Appeal'
                    : 'Open Order';

                return (
                  <Link
                    key={order.id}
                    href={`/trade/${order.id}`}
                    className="block bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 hover:border-slate-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md uppercase ${
                            isSeller
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {isSeller ? 'Sell USDT' : 'Buy USDT'}
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-900">
                          #{order.id}
                        </span>
                        <span className="text-xs text-slate-400">•</span>
                        <span className="text-xs text-slate-500">
                          {new Date(order.createdAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border ${
                            order.status === 'COMPLETED'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : order.status === 'PAYMENT_SENT'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : order.status === 'DISPUTED'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : order.status === 'CANCELLED'
                              ? 'bg-slate-100 text-slate-500 border-slate-200'
                              : 'bg-sky-50 text-sky-800 border-sky-200'
                          }`}
                        >
                          {order.status === 'COMPLETED' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {order.status === 'PENDING_PAYMENT' && <Clock className="w-3.5 h-3.5" />}
                          {order.status === 'PAYMENT_SENT' && <Clock className="w-3.5 h-3.5" />}
                          {order.status === 'DISPUTED' && <AlertTriangle className="w-3.5 h-3.5" />}
                          {order.status === 'CANCELLED' && <XCircle className="w-3.5 h-3.5" />}
                          <span>
                            {order.status === 'PENDING_PAYMENT'
                              ? 'Waiting for Payment'
                              : order.status === 'PAYMENT_SENT'
                              ? 'Buyer Paid — Waiting for Seller'
                              : order.status === 'DISPUTED'
                              ? 'Appeal in Review'
                              : order.status === 'COMPLETED'
                              ? 'Completed'
                              : 'Cancelled'}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 grid grid-cols-2 sm:grid-cols-4 gap-4 items-center text-xs">
                      <div>
                        <div className="text-slate-400 text-[11px]">
                          {isBuyer ? 'Seller' : isSeller ? 'Buyer' : 'Users'}
                        </div>
                        <div className="font-bold text-slate-900 mt-0.5 truncate">
                          {counterparty}
                        </div>
                      </div>

                      <div>
                        <div className="text-slate-400 text-[11px]">Birr Amount</div>
                        <div className="font-bold text-slate-900 text-sm tabular-nums mt-0.5">
                          {order.etbAmount.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          ETB
                        </div>
                      </div>

                      <div>
                        <div className="text-slate-400 text-[11px]">USDT Amount</div>
                        <div className="font-bold text-emerald-700 text-sm tabular-nums mt-0.5">
                          {order.usdtAmount.toFixed(2)} USDT{' '}
                          <span className="text-[11px] font-normal text-slate-400">
                            (@ {order.unitPriceEtb.toFixed(2)})
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-medium">
                          <span
                            className="w-1.5 h-3 rounded-full"
                            style={{ backgroundColor: railMeta.accentColor }}
                          />
                          <span>{railMeta.shortName}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 font-bold text-slate-900">
                          <span>{actionLabel}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* TAB 2: MY MERCHANT ADS */
        <div className="space-y-4">
          {myOffers.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
              <p className="text-sm font-medium text-slate-600">
                You have not posted any ads yet.
              </p>
              {isMerchant && (
                <button
                  onClick={() => setCreateModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Post Your First Ad</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {myOffers.map((offer) => (
                <div
                  key={offer.id}
                  className={`rounded-2xl border p-5 space-y-4 transition-colors ${
                    offer.isActive
                      ? 'bg-white border-slate-200 shadow-sm'
                      : 'bg-slate-50 border-slate-200 opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md uppercase ${
                          offer.offerType === 'SELL'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {offer.offerType === 'SELL' ? 'Sell USDT Ad' : 'Buy USDT Ad'}
                      </span>
                      <span className="text-xs font-semibold text-slate-700">
                        {offer.merchantName}
                      </span>
                    </div>

                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        offer.isActive
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {offer.isActive ? '● Online' : 'Paused'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs tabular-nums">
                    <div>
                      <div className="text-slate-400">Price</div>
                      <div className="text-lg font-bold text-slate-900">
                        {offer.pricePerUsdtEtb.toFixed(2)} ETB
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">Available USDT</div>
                      <div className="text-lg font-bold text-slate-900">
                        {offer.totalAvailable.toFixed(2)} USDT
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-slate-400">Order Limits</div>
                      <div className="font-semibold text-slate-800">
                        {offer.minLimitEtb.toLocaleString()} – {offer.maxLimitEtb.toLocaleString()} ETB
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <div className="flex flex-wrap gap-1">
                      {offer.paymentMethods.map((m) => (
                        <span
                          key={m}
                          className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-medium text-slate-700"
                        >
                          {PAYMENT_METHODS_META[m]?.shortName || m}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleOfferStatus(offer)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-semibold text-slate-700"
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{offer.isActive ? 'Pause' : 'Turn On'}</span>
                      </button>
                      <button
                        onClick={() => handleDeleteOffer(offer.id)}
                        className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                        title="Delete Ad"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <CreateOfferModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={fetchOrdersAndAds}
      />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={<div className="p-12 text-center text-slate-500 text-xs">Loading orders...</div>}
      >
        <OrdersContent />
      </Suspense>
    </ProtectedRoute>
  );
}
