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
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-brand-ink">
            {t.ordersTitle}
          </h1>
          <p className="text-xs sm:text-sm text-brand-ink-soft mt-0.5">{t.ordersSub}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="liquid-pill-track inline-flex p-1 rounded-full text-xs font-semibold">
            <button
              onClick={() => setMainTab('ORDERS')}
              className={`px-4 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                mainTab === 'ORDERS'
                  ? 'bg-white text-brand-ink shadow-sm font-bold'
                  : 'text-brand-ink-soft hover:text-brand-ink'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Orders ({orders.length})</span>
            </button>
            <button
              onClick={() => setMainTab('MY_ADS')}
              className={`px-4 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                mainTab === 'MY_ADS'
                  ? 'bg-white text-brand-ink shadow-sm font-bold'
                  : 'text-brand-ink-soft hover:text-brand-ink'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>My Ads ({myOffers.length})</span>
            </button>
          </div>

          {isMerchant && (
            <button
              onClick={() => setCreateModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand-ink text-white text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 text-brand-buy-400" />
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
                className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
                  statusFilter === tab.id
                    ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
                    : 'bg-white/70 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="liquid-glass-card rounded-[24px] p-5 space-y-3 animate-pulse"
                >
                  <div className="flex justify-between">
                    <div className="h-4 w-40 rounded-full bg-black/[0.08]" />
                    <div className="h-5 w-28 rounded-full bg-black/[0.08]" />
                  </div>
                  <div className="h-10 w-full rounded-2xl bg-black/[0.06]" />
                </div>
              ))}
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-12 text-center liquid-glass-card rounded-[26px] space-y-3">
              <p className="text-sm font-medium text-brand-ink-soft">
                No orders in this view yet.
              </p>
              <Link
                href="/market"
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-brand-buy-600 text-white text-xs font-bold hover:bg-brand-buy-700 shadow-sm transition-colors"
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
                    ? 'Confirm & Release'
                    : order.status === 'DISPUTED' && isAdminRole(currentUser?.role)
                    ? 'Resolve Appeal'
                    : 'Open Escrow';

                return (
                  <Link
                    key={order.id}
                    href={`/trade/${order.id}`}
                    className="block liquid-glass-card rounded-[24px] p-4 sm:p-5 hover:border-black/20 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/[0.06] pb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                            isSeller
                              ? 'bg-rose-50 text-brand-sell border border-rose-200'
                              : 'bg-brand-buy-50 text-brand-buy-700 border border-brand-buy-300/60'
                          }`}
                        >
                          {isSeller ? 'Sell USDT' : 'Buy USDT'}
                        </span>
                        <span className="font-mono text-xs font-bold text-brand-ink">
                          #{order.id}
                        </span>
                        <span className="text-xs text-brand-ink-soft/50">•</span>
                        <span className="text-xs font-mono text-brand-ink-soft">
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
                          className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border ${
                            order.status === 'COMPLETED'
                              ? 'bg-brand-buy-50 text-brand-buy-800 border-brand-buy-300/60'
                              : order.status === 'PAYMENT_SENT'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : order.status === 'DISPUTED'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : order.status === 'CANCELLED'
                              ? 'bg-black/[0.05] text-brand-ink-soft border-black/10'
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
                              ? 'Buyer Paid — Waiting Release'
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
                        <div className="text-brand-ink-soft text-[11px]">
                          {isBuyer ? 'Seller' : isSeller ? 'Buyer' : 'Counterparties'}
                        </div>
                        <div className="font-bold text-brand-ink mt-0.5 truncate">
                          {counterparty}
                        </div>
                      </div>

                      <div>
                        <div className="text-brand-ink-soft text-[11px]">Birr Amount</div>
                        <div className="font-mono font-bold text-brand-ink text-sm tabular-nums mt-0.5">
                          {order.etbAmount.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          ETB
                        </div>
                      </div>

                      <div>
                        <div className="text-brand-ink-soft text-[11px]">USDT Amount</div>
                        <div className="font-mono font-bold text-brand-buy-700 text-sm tabular-nums mt-0.5">
                          {order.usdtAmount.toFixed(2)} USDT{' '}
                          <span className="text-[11px] font-normal text-brand-ink-soft">
                            (@ {order.unitPriceEtb.toFixed(2)})
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/75 border border-black/10 text-brand-ink font-medium">
                          <span
                            className="w-1.5 h-3 rounded-full"
                            style={{ backgroundColor: railMeta.accentColor }}
                          />
                          <span>{railMeta.shortName}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 font-bold text-brand-ink">
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
            <div className="p-12 text-center liquid-glass-card rounded-[26px] space-y-3">
              <p className="text-sm font-medium text-brand-ink-soft">
                You have not posted any ads yet.
              </p>
              {isMerchant && (
                <button
                  onClick={() => setCreateModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-brand-ink text-white text-xs font-bold hover:bg-neutral-800 shadow-sm transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-brand-buy-400" />
                  <span>Post Your First Ad</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {myOffers.map((offer) => (
                <div
                  key={offer.id}
                  className={`liquid-glass-card rounded-[24px] p-5 space-y-4 transition-all ${
                    offer.isActive ? '' : 'opacity-70'
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                          offer.offerType === 'SELL'
                            ? 'bg-brand-buy-50 text-brand-buy-700 border border-brand-buy-300/60'
                            : 'bg-rose-50 text-brand-sell border border-rose-200'
                        }`}
                      >
                        {offer.offerType === 'SELL' ? 'Sell USDT Ad' : 'Buy USDT Ad'}
                      </span>
                      <span className="text-xs font-semibold text-brand-ink">
                        {offer.merchantName}
                      </span>
                    </div>

                    <span
                      className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                        offer.isActive
                          ? 'bg-brand-buy-50 text-brand-buy-700 border border-brand-buy-300/60'
                          : 'bg-black/[0.06] text-brand-ink-soft'
                      }`}
                    >
                      {offer.isActive ? '● Online' : 'Paused'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono tabular-nums">
                    <div>
                      <div className="text-brand-ink-soft font-sans">Price</div>
                      <div className="text-lg font-bold text-brand-ink">
                        {offer.pricePerUsdtEtb.toFixed(2)} ETB
                      </div>
                    </div>
                    <div>
                      <div className="text-brand-ink-soft font-sans">Available USDT</div>
                      <div className="text-lg font-bold text-brand-ink">
                        {offer.totalAvailable.toFixed(2)} USDT
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-brand-ink-soft font-sans">Order Limits</div>
                      <div className="font-semibold text-brand-ink">
                        {offer.minLimitEtb.toLocaleString()} – {offer.maxLimitEtb.toLocaleString()} ETB
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-black/[0.06] text-xs">
                    <div className="flex flex-wrap gap-1">
                      {offer.paymentMethods.map((m) => (
                        <span
                          key={m}
                          className="px-2.5 py-0.5 rounded-full bg-white/75 border border-black/10 text-[10px] font-medium text-brand-ink"
                        >
                          {PAYMENT_METHODS_META[m]?.shortName || m}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleOfferStatus(offer)}
                        className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full border border-black/10 bg-white/80 hover:bg-white font-semibold text-brand-ink transition-colors"
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{offer.isActive ? 'Pause' : 'Turn On'}</span>
                      </button>
                      <button
                        onClick={() => handleDeleteOffer(offer.id)}
                        className="p-2 rounded-full border border-rose-200 bg-white/75 text-brand-sell hover:bg-rose-50 transition-colors"
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
        fallback={
          <div className="liquid-glass-card rounded-[26px] p-12 text-center text-brand-ink-soft text-xs animate-pulse">
            Loading orders...
          </div>
        }
      >
        <OrdersContent />
      </Suspense>
    </ProtectedRoute>
  );
}
