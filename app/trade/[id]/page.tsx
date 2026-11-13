'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRealtime } from '@/client/components/realtime-provider';
import { useI18n } from '@/client/i18n';
import {
  P2POrder,
  ChatMessage,
  PAYMENT_METHODS_META,
  displayName,
  isAdminRole,
} from '@/client/types';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  Send,
  Upload,
  Building,
  ShieldCheck,
  FileCheck,
  Copy,
  Check,
  ArrowLeft,
  MessageSquare,
  XCircle,
  X,
  Eye,
  ThumbsUp,
  ThumbsDown,
  UserCheck,
  ImageIcon,
  Loader2,
  Zap,
} from 'lucide-react';
import { ProtectedRoute } from '@/client/components/protected-route';
import { ImageLightbox } from '@/client/components/image-lightbox';

export default function EscrowRoomPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params?.id as string;

  const {
    currentUser,
    refreshUser,
    setNotification,
  } = useRealtime();
  const { t } = useI18n();

  const [order, setOrder] = useState<P2POrder | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);

  // Mobile View Tab ('DETAILS' | 'CHAT')
  const [mobileTab, setMobileTab] = useState<'DETAILS' | 'CHAT'>('DETAILS');

  // Payment reference / receipt upload & preview
  const [paymentRefInput, setPaymentRefInput] = useState<string>('');
  const [receiptUrl, setReceiptUrl] = useState<string>('');
  const [receiptName, setReceiptName] = useState<string>('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadingChatImage, setUploadingChatImage] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Seller release safety confirmation checkbox
  const [sellerConfirmedBankCheck, setSellerConfirmedBankCheck] = useState(false);

  // Inline Cancel Confirmation State
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('Changed my mind');

  // Admin Resolution Note
  const [adminNote, setAdminNote] = useState('');

  // Post-Order Feedback State
  const [feedbackRating, setFeedbackRating] = useState<'POSITIVE' | 'NEGATIVE'>('POSITIVE');
  const [feedbackComment, setFeedbackComment] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // Actions loading & modals
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  // 15-Minute Countdown Timer
  const [timeLeft, setTimeLeft] = useState<number>(15 * 60);

  // Auto-Release Countdown (seconds)
  const [autoReleaseCountdown, setAutoReleaseCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (order?.status !== 'PAYMENT_SENT' || !order.autoReleaseAt) {
      setAutoReleaseCountdown(null);
      return;
    }

    const update = () => {
      const diff = Math.max(
        0,
        Math.ceil((new Date(order.autoReleaseAt!).getTime() - Date.now()) / 1000)
      );
      setAutoReleaseCountdown(diff);
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [order?.status, order?.autoReleaseAt]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchOrderAndChat = async () => {
    try {
      const [orderRes, chatRes] = await Promise.all([
        fetch(`/api/orders/${orderId}`),
        fetch(`/api/orders/${orderId}/chat`),
      ]);

      if (orderRes.ok) {
        const orderData = await orderRes.json();
        setOrder(orderData.order);

        if (orderData.order?.expiresAt) {
          const diff = Math.floor(
            (new Date(orderData.order.expiresAt).getTime() - Date.now()) / 1000
          );
          setTimeLeft(diff > 0 ? diff : 0);
        }
      }

      if (chatRes.ok) {
        const chatData = await chatRes.json();
        setMessages(chatData.messages || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrderAndChat();
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;

    const eventSource = new EventSource(`/api/events?orderId=${orderId}`);

    eventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (
          payload.event === 'escrow_locked' ||
          payload.event === 'payment_confirmed' ||
          payload.event === 'escrow_released' ||
          payload.event === 'dispute_alert'
        ) {
          setOrder(payload.data);
          fetchOrderAndChat();
          refreshUser();
        } else if (payload.event === 'chat_message') {
          setMessages((prev) => [...prev, payload.data]);
        }
      } catch {
        // ignore
      }
    };

    return () => {
      eventSource.close();
    };
  }, [orderId, refreshUser]);

  // Countdown timer tick
  useEffect(() => {
    if (order?.status !== 'PENDING_PAYMENT') return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [order?.status]);

  // Scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, mobileTab]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setNotification(`Copied ${field}`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptName(file.name);
    setUploadingReceipt(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'fetan_p2p/receipts');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success && data.url) {
        setReceiptUrl(data.url);
        setNotification('Payment proof uploaded successfully!');
      } else {
        // Fallback to local Data URI if serverless upload fails
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') setReceiptUrl(reader.result);
        };
        reader.readAsDataURL(file);
      }
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') setReceiptUrl(reader.result);
      };
      reader.readAsDataURL(file);
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleChatImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    setUploadingChatImage(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'fetan_p2p/chat');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success && data.url) {
        await fetch(`/api/orders/${orderId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderId: currentUser.id,
            text: 'Screenshot / Payment Receipt',
            imageUrl: data.url,
            type: 'IMAGE',
          }),
        });
        await fetchOrderAndChat();
        setNotification('Image sent in chat successfully!');
      } else {
        setNotification('Could not upload image');
      }
    } catch (err) {
      console.error(err);
      setNotification('Failed to send image');
    } finally {
      setUploadingChatImage(false);
    }
  };

  const handleAttachSampleReceipt = () => {
    const sampleRef = `FT-${orderId.slice(-6)}`;
    setPaymentRefInput(sampleRef);
    setReceiptName(`Payment_Receipt_${orderId.slice(-4)}.jpg`);
    setReceiptUrl(
      'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop'
    );
    setNotification('Sample receipt attached.');
  };

  // 1. Mark Paid (Buyer)
  const handleMarkPaid = async () => {
    if (!currentUser || !order) return;
    setActionLoading(true);
    setActionError(null);

    try {
      const proof =
        receiptUrl ||
        paymentRefInput.trim() ||
        `Paid via ${PAYMENT_METHODS_META[order.paymentMethod]?.shortName || order.paymentMethod}`;

      const res = await fetch(`/api/orders/${orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerId: currentUser.id,
          proofReceiptUrl: proof,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not mark order as paid');

      setOrder(data.order);
      setShowCancelConfirm(false);
      setNotification('Order marked as paid! Waiting for seller to confirm and release USDT.');
      await fetchOrderAndChat();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error');
    } finally {
      setActionLoading(false);
    }
  };

  // 2. Complete Order & Release USDT (Seller or Admin)
  const handleReleaseCrypto = async (asAdminOverride = false) => {
    if (!currentUser || !order) return;

    if (!asAdminOverride && !sellerConfirmedBankCheck) {
      setActionError(
        'Please tick the confirmation box above to confirm you received the Birr in your account.'
      );
      return;
    }

    setActionLoading(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/orders/${orderId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId: currentUser.id,
          note: asAdminOverride ? adminNote || 'Completed by Admin' : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not complete order');

      setOrder(data.order);
      await refreshUser();
      setNotification(`Order completed! ${order.usdtAmount.toFixed(2)} USDT sent to buyer.`);
      await fetchOrderAndChat();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error');
    } finally {
      setActionLoading(false);
    }
  };

  // 3. Cancel Order (Buyer or Admin)
  const handleCancelOrder = async (customReason?: string) => {
    if (!currentUser || !order) return;
    setActionLoading(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          reason: customReason || cancelReason,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel order');

      setOrder(data.order);
      setShowCancelConfirm(false);
      await refreshUser();
      setNotification('Order cancelled. Locked USDT was returned to the seller.');
      await fetchOrderAndChat();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error');
    } finally {
      setActionLoading(false);
    }
  };

  // 4. Open Appeal / Dispute
  const handleDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !order || !disputeReason.trim()) return;
    setActionLoading(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/orders/${orderId}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          reason: disputeReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open appeal');

      setOrder(data.order);
      setDisputeOpen(false);
      setNotification('Appeal opened. Admin support has been notified.');
      await fetchOrderAndChat();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error');
    } finally {
      setActionLoading(false);
    }
  };

  // 5. Leave Post-Order Feedback
  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !order) return;
    setSubmittingFeedback(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          rating: feedbackRating,
          comment: feedbackComment,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save review');

      setOrder(data.order);
      setNotification('Thank you! Your review has been saved.');
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  // 6. Send Chat Message
  const sendChatText = async (textToSend: string) => {
    if (!textToSend.trim() || !currentUser) return;
    try {
      await fetch(`/api/orders/${orderId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: currentUser.id,
          text: textToSend.trim(),
        }),
      });
      await fetchOrderAndChat();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const text = newMessage;
    setNewMessage('');
    await sendChatText(text);
  };

  if (loading) {
    return (
      <div className="liquid-glass-card rounded-[26px] p-12 text-center text-brand-ink-soft text-xs space-y-3 animate-pulse">
        <div className="w-6 h-6 border-2 border-black/15 border-t-brand-ink rounded-full animate-spin mx-auto" />
        <p>Loading Escrow Room #{orderId}...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="liquid-glass-card rounded-[26px] p-12 text-center space-y-4">
        <p className="text-brand-ink-soft text-sm font-medium">Order #{orderId} was not found.</p>
        <button
          onClick={() => router.push('/market')}
          className="px-5 py-2.5 rounded-full bg-brand-ink text-white text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-sm"
        >
          Back to P2P Market
        </button>
      </div>
    );
  }

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isBuyer = currentUser?.id === order.buyerId;
  const isSeller = currentUser?.id === order.sellerId;
  const isAdmin = isAdminRole(currentUser?.role);
  const railMeta = PAYMENT_METHODS_META[order.paymentMethod] || PAYMENT_METHODS_META.TELEBIRR;
  const activeReceiptUrl = order.proofReceiptUrl || receiptUrl;
  const isImageReceipt =
    activeReceiptUrl &&
    (activeReceiptUrl.startsWith('/api/uploads/') ||
      activeReceiptUrl.startsWith('http') ||
      activeReceiptUrl.startsWith('data:image'));

  const currentStep =
    order.status === 'PENDING_PAYMENT'
      ? 2
      : order.status === 'PAYMENT_SENT'
      ? 3
      : order.status === 'COMPLETED'
      ? 4
      : 3;

  const myExistingFeedback = isBuyer
    ? order.buyerFeedback
    : isSeller
    ? order.sellerFeedback
    : undefined;

  const quickChatChips = isBuyer
    ? [
        'I sent the Birr, please check your account.',
        'Payment receipt is attached.',
        'Please complete the order when ready.',
      ]
    : [
        'Checking my bank / Telebirr balance now.',
        'Please share your payment reference or receipt.',
        'Got the payment, releasing USDT now!',
      ];

  return (
    <ProtectedRoute>
      <div className="space-y-4 pb-10">
      {/* Trade Room Security & Order Identification Header */}
      <div className="liquid-glass-dark text-white rounded-[22px] px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand-buy-400 flex-shrink-0" />
          <span>
            Trading as:{' '}
            <strong className="text-brand-buy-300">
              {isBuyer
                ? `Buyer (${displayName(order.buyerName)})`
                : isSeller
                ? `Seller (${displayName(order.sellerName)})`
                : `Admin Inspector (${displayName(currentUser?.name)})`}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-2 text-white/75 text-[11px]">
          <span className="w-2 h-2 rounded-full bg-brand-buy-400" />
          <span>Fetan Encrypted Escrow Room</span>
        </div>
      </div>

      {/* Top Bar: Back Button, Order ID, Status Pill & Countdown */}
      <div className="liquid-glass-card rounded-[26px] p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/orders')}
              className="p-2.5 rounded-full border border-black/10 bg-white/75 text-brand-ink-soft hover:bg-white hover:text-brand-ink transition-colors"
              title="Back to Orders"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
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
                <h1 className="text-base sm:text-lg font-bold text-brand-ink">
                  Order <span className="font-mono text-sm">#{order.id}</span>
                </h1>
                <span
                  className={`text-[11px] font-bold px-3 py-0.5 rounded-full border ${
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
                  {order.status === 'PENDING_PAYMENT'
                    ? 'Waiting for Buyer Payment'
                    : order.status === 'PAYMENT_SENT'
                    ? 'Buyer Paid — Waiting Release'
                    : order.status === 'COMPLETED'
                    ? 'Completed'
                    : order.status === 'CANCELLED'
                    ? 'Cancelled'
                    : 'Appeal in Review'}
                </span>
              </div>
              <p className="text-xs text-brand-ink-soft mt-0.5">
                Buyer: <strong className="text-brand-ink">{displayName(order.buyerName)}</strong> •
                Seller: <strong className="text-brand-ink">{displayName(order.sellerName)}</strong>
              </p>
            </div>
          </div>

          {/* 15-Minute Countdown Timer */}
          {order.status === 'PENDING_PAYMENT' && (
            <div className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 rounded-full text-xs self-start sm:self-auto shadow-sm">
              <Clock className="w-4 h-4 text-brand-buy-400" />
              <span className="text-white/70">{t.paymentWindow}:</span>
              <span className="font-mono font-bold text-sm text-brand-buy-400 tabular-nums">
                {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
              </span>
            </div>
          )}
        </div>

        {/* 4-Step Progress Bar */}
        {order.status !== 'CANCELLED' && (
          <div className="grid grid-cols-4 gap-2 pt-3 border-t border-black/[0.06] text-[11px]">
            {[
              { step: 1, label: '1. Order Created' },
              { step: 2, label: '2. Buyer Pays Birr' },
              { step: 3, label: '3. Seller Confirms' },
              { step: 4, label: '4. Completed' },
            ].map((item) => {
              const done = currentStep > item.step || order.status === 'COMPLETED';
              const active = currentStep === item.step && order.status !== 'COMPLETED';
              return (
                <div key={item.step} className="space-y-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-colors ${
                      done ? 'bg-brand-buy-600' : active ? 'bg-brand-ink' : 'bg-black/10'
                    }`}
                  />
                  <div
                    className={`font-semibold truncate ${
                      done
                        ? 'text-brand-buy-700'
                        : active
                        ? 'text-brand-ink'
                        : 'text-brand-ink-soft/60'
                    }`}
                  >
                    {item.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mobile View Switcher (Order Details vs Live Chat) */}
      <div className="lg:hidden liquid-pill-track grid grid-cols-2 gap-1.5 p-1 rounded-full text-xs font-bold">
        <button
          onClick={() => setMobileTab('DETAILS')}
          className={`py-2.5 rounded-full transition-all ${
            mobileTab === 'DETAILS'
              ? 'bg-white text-brand-ink shadow-sm'
              : 'text-brand-ink-soft hover:text-brand-ink'
          }`}
        >
          Order Details & Actions
        </button>
        <button
          onClick={() => setMobileTab('CHAT')}
          className={`py-2.5 rounded-full transition-all flex items-center justify-center gap-1.5 ${
            mobileTab === 'CHAT'
              ? 'bg-white text-brand-ink shadow-sm'
              : 'text-brand-ink-soft hover:text-brand-ink'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 text-brand-buy-600" />
          <span>Order Chat ({messages.length})</span>
        </button>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Amounts, Payment Credentials, Receipt & Role Actions */}
        <div
          className={`lg:col-span-7 space-y-5 ${
            mobileTab === 'CHAT' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* 1. Order Summary Card */}
          <div className="liquid-glass-card rounded-[26px] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
              <div className="flex items-center gap-2 text-xs font-bold text-brand-ink">
                <ShieldCheck className="w-4 h-4 text-brand-buy-600" />
                <span>Escrow Protection</span>
              </div>
              <span className="text-[11px] font-mono font-semibold text-brand-buy-700 bg-brand-buy-50 border border-brand-buy-300/60 px-3 py-0.5 rounded-full">
                {order.status === 'COMPLETED'
                  ? `✓ ${order.usdtAmount.toFixed(2)} USDT Released`
                  : order.status === 'CANCELLED'
                  ? `↺ ${order.usdtAmount.toFixed(2)} USDT Returned`
                  : `🔒 ${order.usdtAmount.toFixed(2)} USDT Locked`}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-white/65 border border-black/[0.08] space-y-1">
                <div className="text-brand-ink-soft text-xs">
                  {isBuyer ? 'You Pay (Birr)' : isSeller ? 'You Receive (Birr)' : t.youSend}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xl sm:text-2xl font-mono font-bold text-brand-ink tabular-nums">
                    {order.etbAmount.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-xs font-sans font-semibold text-brand-ink-soft">ETB</span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(order.etbAmount.toFixed(2), 'Birr Amount')}
                    className="p-2 rounded-full bg-white/85 border border-black/10 text-brand-ink-soft hover:text-brand-ink transition-colors"
                    title="Copy exact Birr amount"
                  >
                    {copiedField === 'Birr Amount' ? (
                      <Check className="w-3.5 h-3.5 text-brand-buy-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-brand-buy-50/85 border border-brand-buy-300/60 space-y-1">
                <div className="text-brand-buy-900/80 text-xs">
                  {isBuyer ? 'You Get (USDT)' : isSeller ? 'You Sell (USDT)' : t.youReceive}
                </div>
                <div className="text-xl sm:text-2xl font-mono font-bold text-brand-buy-700 tabular-nums">
                  {order.usdtAmount.toFixed(2)}{' '}
                  <span className="text-xs font-sans font-semibold text-brand-buy-600">USDT</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-brand-ink-soft pt-1">
              <span>
                Price:{' '}
                <strong className="font-mono text-brand-ink tabular-nums">
                  1 USDT = {order.unitPriceEtb.toFixed(2)} ETB
                </strong>
              </span>
              <span>
                Fee: <strong className="font-mono text-brand-buy-700">0.00 USDT</strong>
              </span>
            </div>
          </div>

          {/* 2. Seller Payment Account Card (With 1-Tap Copy Buttons) */}
          <div className="liquid-glass-card rounded-[26px] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
              <div className="flex items-center gap-2 font-bold text-sm text-brand-ink">
                <Building className="w-4 h-4 text-brand-ink-soft" />
                <span>{t.bankDetails}</span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/75 border border-black/10 text-xs font-semibold text-brand-ink">
                <span
                  className="w-1.5 h-3 rounded-full"
                  style={{ backgroundColor: railMeta.accentColor }}
                />
                <span>{railMeta.name}</span>
              </span>
            </div>

            <div className="rounded-2xl bg-white/65 border border-black/[0.08] divide-y divide-black/[0.06] text-xs">
              <div className="p-3.5 flex justify-between items-center gap-2">
                <span className="text-brand-ink-soft font-medium">{t.accountName}</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-brand-ink text-sm">
                    {order.paymentDetails.accountName}
                  </span>
                  <button
                    onClick={() =>
                      copyToClipboard(order.paymentDetails.accountName, 'Account Name')
                    }
                    className="p-2 rounded-full border border-black/10 bg-white/85 text-brand-ink-soft hover:text-brand-ink transition-colors"
                  >
                    {copiedField === 'Account Name' ? (
                      <Check className="w-3.5 h-3.5 text-brand-buy-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="p-3.5 flex justify-between items-center gap-2">
                <span className="text-brand-ink-soft font-medium">{railMeta.accountLabel}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-base text-brand-ink tabular-nums">
                    {order.paymentDetails.accountNumber}
                  </span>
                  <button
                    onClick={() =>
                      copyToClipboard(order.paymentDetails.accountNumber, 'Account Number')
                    }
                    className="p-2 rounded-full border border-black/10 bg-white/85 text-brand-ink-soft hover:text-brand-ink transition-colors"
                  >
                    {copiedField === 'Account Number' ? (
                      <Check className="w-3.5 h-3.5 text-brand-buy-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="p-3.5 flex justify-between items-center gap-2">
                <span className="text-brand-ink-soft font-medium">{t.paymentMethod}</span>
                <span className="text-brand-ink font-semibold">
                  {order.paymentDetails.bankName}
                </span>
              </div>
            </div>

            {/* Payment Safety Tip */}
            <div className="p-3.5 rounded-2xl bg-amber-50/85 border border-amber-300/60 text-xs text-amber-950 leading-relaxed flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Important: </span>
                {t.instructions}
              </div>
            </div>
          </div>

          {/* 3. Payment Reference / Receipt Card */}
          {order.status !== 'CANCELLED' && (
            <div className="liquid-glass-card rounded-[26px] p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-brand-ink">{t.proofReceipt}</span>
                {!activeReceiptUrl && order.status === 'PENDING_PAYMENT' && (
                  <button
                    type="button"
                    onClick={handleAttachSampleReceipt}
                    className="text-[11px] font-semibold text-brand-buy-700 hover:text-brand-buy-900 underline"
                  >
                    Fill Sample Receipt
                  </button>
                )}
              </div>

              {order.status === 'PENDING_PAYMENT' && isBuyer && (
                <div>
                  <input
                    type="text"
                    value={paymentRefInput}
                    onChange={(e) => setPaymentRefInput(e.target.value)}
                    placeholder="Optional: Enter Telebirr or bank transfer reference number..."
                    className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/75 font-mono text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                  />
                </div>
              )}

              {activeReceiptUrl ? (
                <div className="rounded-2xl border border-black/[0.08] p-3.5 bg-white/65 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-2xl bg-brand-buy-50 border border-brand-buy-300/50 text-brand-buy-700 flex items-center justify-center flex-shrink-0">
                      <FileCheck className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-brand-ink truncate">
                        {isImageReceipt
                          ? receiptName || `Payment_Receipt_${order.id}.jpg`
                          : activeReceiptUrl}
                      </div>
                      <div className="text-[11px] text-brand-buy-700 font-medium">
                        Payment proof attached
                      </div>
                    </div>
                  </div>
                  {isImageReceipt && (
                    <button
                      type="button"
                      onClick={() => setLightboxSrc(activeReceiptUrl)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/85 border border-black/10 hover:bg-white text-brand-ink font-semibold flex-shrink-0 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View</span>
                    </button>
                  )}
                </div>
              ) : (
                <label className="rounded-2xl border-2 border-dashed border-black/15 bg-white/50 p-4 text-center cursor-pointer hover:bg-white/80 transition-colors flex flex-col items-center justify-center">
                  <Upload className="w-5 h-5 text-brand-ink-soft mb-1" />
                  <span className="font-semibold text-brand-ink">{t.attachProof}</span>
                  <span className="text-[11px] text-brand-ink-soft mt-0.5">
                    Optional screenshot from your Telebirr or bank app
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              )}
            </div>
          )}

          {/* 4. Role-Specific Order Action Panel */}
          <div className="liquid-glass-card rounded-[26px] p-5 space-y-4 text-xs">
            {actionError && (
              <div className="p-3 rounded-2xl bg-rose-50/90 border border-rose-200 text-rose-800 font-medium flex items-center justify-between">
                <span>{actionError}</span>
                <button
                  onClick={() => setActionError(null)}
                  className="text-rose-500 hover:text-rose-800 ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            {/* STATE A: ORDER COMPLETED */}
            {order.status === 'COMPLETED' ? (
              <div className="space-y-4">
                <div className="p-5 rounded-2xl bg-brand-buy-50/90 border border-brand-buy-300/60 text-center space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-brand-buy-600 mx-auto" />
                  <h4 className="font-bold text-brand-buy-900 text-base">{t.completedTitle}</h4>
                  <p className="text-xs text-brand-buy-900/80 max-w-md mx-auto leading-relaxed">
                    <span className="font-mono font-bold">{order.usdtAmount.toFixed(2)} USDT</span> has been added to{' '}
                    <strong>{displayName(order.buyerName)}</strong>&apos;s wallet with <span className="font-mono">0.00 USDT</span> fee.
                  </p>
                  {order.resolvedBy && (
                    <p className="text-[11px] text-brand-buy-700 font-medium">
                      Resolved by {order.resolvedBy}
                      {order.resolutionNote ? ` — "${order.resolutionNote}"` : ''}
                    </p>
                  )}
                  <div className="pt-2 flex justify-center gap-2">
                    <button
                      onClick={() => router.push('/wallet')}
                      className="px-5 py-2.5 rounded-full bg-brand-buy-600 text-white font-bold hover:bg-brand-buy-700 transition-colors shadow-sm"
                    >
                      Open Wallet
                    </button>
                    <button
                      onClick={() => router.push('/market')}
                      className="px-5 py-2.5 rounded-full bg-white/85 border border-brand-buy-300 text-brand-buy-900 font-semibold hover:bg-white transition-colors"
                    >
                      New Trade
                    </button>
                  </div>
                </div>

                {/* Post-Order Feedback Section (Buyer or Seller) */}
                {(isBuyer || isSeller) && (
                  <div className="p-4 rounded-2xl border border-black/[0.08] bg-white/65 space-y-3">
                    <div className="font-bold text-brand-ink text-sm">
                      How was your trade with{' '}
                      {isBuyer ? displayName(order.sellerName) : displayName(order.buyerName)}?
                    </div>

                    {myExistingFeedback ? (
                      <div className="flex items-center gap-2 text-xs text-brand-buy-900 bg-brand-buy-50 border border-brand-buy-300/60 p-3 rounded-2xl">
                        {myExistingFeedback.rating === 'POSITIVE' ? (
                          <ThumbsUp className="w-4 h-4 text-brand-buy-600" />
                        ) : (
                          <ThumbsDown className="w-4 h-4 text-brand-sell" />
                        )}
                        <span>
                          Your review: <strong>{myExistingFeedback.rating}</strong> — &ldquo;
                          {myExistingFeedback.comment}&rdquo;
                        </span>
                      </div>
                    ) : (
                      <form onSubmit={handleSubmitFeedback} className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setFeedbackRating('POSITIVE')}
                            className={`py-2.5 px-3 rounded-full border font-bold flex items-center justify-center gap-1.5 transition-all ${
                              feedbackRating === 'POSITIVE'
                                ? 'bg-brand-buy-600 text-white border-brand-buy-600 shadow-sm'
                                : 'bg-white/75 text-brand-ink border-black/10 hover:bg-white'
                            }`}
                          >
                            <ThumbsUp className="w-4 h-4" />
                            <span>Positive</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setFeedbackRating('NEGATIVE')}
                            className={`py-2.5 px-3 rounded-full border font-bold flex items-center justify-center gap-1.5 transition-all ${
                              feedbackRating === 'NEGATIVE'
                                ? 'bg-brand-sell text-white border-brand-sell shadow-sm'
                                : 'bg-white/75 text-brand-ink border-black/10 hover:bg-white'
                            }`}
                          >
                            <ThumbsDown className="w-4 h-4" />
                            <span>Negative</span>
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={feedbackComment}
                            onChange={(e) => setFeedbackComment(e.target.value)}
                            placeholder="Optional comment (e.g. Fast payment and release!)"
                            className="flex-1 px-3.5 py-2 rounded-full border border-black/10 bg-white/85 text-xs text-brand-ink focus:outline-none focus:border-brand-ink"
                          />
                          <button
                            type="submit"
                            disabled={submittingFeedback}
                            className="px-4 py-2 rounded-full bg-brand-ink text-white font-semibold hover:bg-neutral-800 transition-colors"
                          >
                            {submittingFeedback ? 'Saving...' : 'Save Review'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>
            ) : order.status === 'CANCELLED' ? (
              /* STATE B: ORDER CANCELLED */
              <div className="p-5 rounded-2xl bg-black/[0.04] border border-black/[0.08] text-center space-y-2">
                <XCircle className="w-9 h-9 text-brand-ink-soft mx-auto" />
                <h4 className="font-bold text-brand-ink text-base">{t.cancelledTitle}</h4>
                <p className="text-xs text-brand-ink-soft">
                  This order was cancelled
                  {order.cancelledBy === 'ADMIN'
                    ? ' by Admin'
                    : order.cancelledBy === 'BUYER'
                    ? ' by the Buyer'
                    : ''}
                  . The <span className="font-mono font-semibold">{order.usdtAmount.toFixed(2)} USDT</span> was unlocked and returned to{' '}
                  <strong className="text-brand-ink">{displayName(order.sellerName)}</strong>.
                </p>
                {order.cancelReason && (
                  <p className="text-xs text-brand-ink-soft">Reason: &ldquo;{order.cancelReason}&rdquo;</p>
                )}
                <div className="pt-2">
                  <button
                    onClick={() => router.push('/market')}
                    className="px-5 py-2.5 rounded-full bg-brand-ink text-white font-semibold hover:bg-neutral-800 transition-colors"
                  >
                    Back to P2P Market
                  </button>
                </div>
              </div>
            ) : (
              /* STATE C: OPEN ORDER (PENDING_PAYMENT, PAYMENT_SENT, OR DISPUTED) */
              <div className="space-y-4">
                {order.status === 'DISPUTED' && (
                  <div className="p-4 rounded-2xl bg-rose-50/90 border border-rose-200 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-rose-900 text-sm">
                      <AlertTriangle className="w-4 h-4 text-brand-sell" />
                      <span>
                        {t.disputedTitle}
                        {order.appealedBy ? ` (Opened by ${order.appealedBy})` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-rose-800">
                      Reason: &ldquo;{order.disputeReason}&rdquo;
                    </p>
                    <p className="text-[11px] text-rose-700 pt-1">
                      The {order.usdtAmount.toFixed(2)} USDT is safely locked while Admin checks the
                      payment proof.
                    </p>
                  </div>
                )}

                {/* 1. BUYER CONTROLS */}
                {isBuyer && (
                  <div className="space-y-3">
                    {order.status === 'PENDING_PAYMENT' && (
                      <div className="p-3.5 rounded-2xl bg-sky-50/85 border border-sky-200 text-sky-950 space-y-1">
                        <div className="font-bold">Next step for you (Buyer):</div>
                        <p className="leading-relaxed">
                          Send <strong className="font-mono">{order.etbAmount.toLocaleString()} ETB</strong> to{' '}
                          <strong>{order.paymentDetails.accountName}</strong> (
                          <span className="font-mono">{order.paymentDetails.accountNumber}</span>) via {railMeta.shortName}, then tap{' '}
                          <strong>&ldquo;{t.markPaidBtn}&rdquo;</strong> below.
                        </p>
                      </div>
                    )}

                    {order.status === 'PAYMENT_SENT' && (
                      <div className="p-4 rounded-2xl bg-brand-buy-50/85 border border-brand-buy-300/60 text-brand-buy-900 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-bold text-xs text-brand-buy-800">
                            <Zap className="w-4 h-4 text-amber-500 fill-amber-500 animate-bounce" />
                            <span>Automated Escrow Release Active</span>
                          </div>
                          {autoReleaseCountdown !== null && (
                            <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-full bg-brand-buy-600 text-white tabular-nums shadow-sm">
                              {autoReleaseCountdown > 0 ? `Auto-Release in ${autoReleaseCountdown}s` : 'Releasing now...'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-brand-ink">
                          Payment has been registered. <strong>{displayName(order.sellerName)}</strong> has been notified.
                          Our automated escrow engine will automatically complete the order and credit{' '}
                          <strong className="font-mono text-brand-buy-700">{order.usdtAmount.toFixed(2)} USDT</strong> directly to your wallet.
                        </p>
                        {autoReleaseCountdown !== null && (
                          <div className="w-full bg-brand-buy-300/40 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-brand-buy-600 h-1.5 rounded-full transition-all duration-1000"
                              style={{
                                width: `${Math.min(100, Math.max(5, ((15 - (autoReleaseCountdown ?? 0)) / 15) * 100))}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2.5">
                      {order.status === 'PENDING_PAYMENT' && (
                        <button
                          onClick={handleMarkPaid}
                          disabled={actionLoading}
                          className="flex-1 py-3 px-5 rounded-full bg-brand-buy-600 text-white font-bold text-sm hover:bg-brand-buy-700 transition-colors shadow-sm disabled:opacity-50"
                        >
                          {actionLoading ? 'Updating...' : t.markPaidBtn}
                        </button>
                      )}

                      {order.status !== 'DISPUTED' && (
                        <button
                          type="button"
                          onClick={() => setShowCancelConfirm(!showCancelConfirm)}
                          disabled={actionLoading}
                          className="py-3 px-4 rounded-full border border-black/10 bg-white/75 text-brand-ink font-semibold hover:bg-white transition-colors"
                        >
                          {t.cancelOrderBtn}
                        </button>
                      )}

                      {order.status !== 'DISPUTED' && (
                        <button
                          type="button"
                          onClick={() => setDisputeOpen(true)}
                          className="py-3 px-4 rounded-full border border-rose-200 text-brand-sell font-semibold bg-white/80 hover:bg-rose-50 transition-colors"
                        >
                          {t.disputeBtn}
                        </button>
                      )}
                    </div>

                    {/* Inline Buyer Cancel Confirmation */}
                    {showCancelConfirm && (
                      <div className="p-4 rounded-2xl bg-white/75 border border-black/[0.08] space-y-3">
                        <div className="font-bold text-brand-ink">
                          Are you sure you want to cancel this order?
                        </div>
                        <p className="text-brand-ink-soft">
                          Do <strong>not</strong> cancel if you have already sent Birr to the
                          seller.
                        </p>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-semibold text-brand-ink-soft">
                            Reason for cancelling:
                          </label>
                          <select
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-2xl border border-black/10 bg-white text-xs text-brand-ink focus:outline-none"
                          >
                            <option value="Changed my mind">Changed my mind</option>
                            <option value="Placed order by mistake">Placed order by mistake</option>
                            <option value="Payment app issue">Payment app issue</option>
                            <option value="Found a better price">Found a better price</option>
                          </select>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowCancelConfirm(false)}
                            className="px-4 py-2 rounded-full border border-black/10 bg-white font-semibold text-brand-ink"
                          >
                            Keep Order
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancelOrder(cancelReason)}
                            disabled={actionLoading}
                            className="px-4 py-2 rounded-full bg-brand-sell text-white font-bold hover:opacity-95"
                          >
                            {actionLoading ? 'Cancelling...' : 'Yes, Cancel Order'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. SELLER CONTROLS */}
                {isSeller && (
                  <div className="space-y-3">
                    {order.status === 'PENDING_PAYMENT' ? (
                      <div className="p-4 rounded-2xl bg-white/65 border border-black/[0.08] space-y-2.5">
                        <div className="font-bold text-brand-ink">
                          Waiting for buyer ({displayName(order.buyerName)}) to send{' '}
                          <span className="font-mono">{order.etbAmount.toLocaleString()} ETB</span>
                        </div>
                        <p className="text-brand-ink-soft leading-relaxed">
                          Your <strong className="font-mono text-brand-ink">{order.usdtAmount.toFixed(2)} USDT</strong> is locked in
                          escrow. Do not release the USDT until the buyer marks the order as paid and
                          you see the money in your {railMeta.shortName} account.
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled
                            className="py-2.5 px-4 rounded-full bg-black/[0.07] text-brand-ink-soft font-bold cursor-not-allowed"
                          >
                            Complete Order (Waiting for Buyer Payment)
                          </button>
                          <button
                            type="button"
                            onClick={() => setDisputeOpen(true)}
                            className="py-2.5 px-4 rounded-full border border-rose-200 bg-white/80 text-brand-sell font-semibold hover:bg-rose-50"
                          >
                            {t.disputeBtn}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Seller sees PAYMENT_SENT or DISPUTED -> can Confirm & Complete Order */
                      <div className="space-y-3">
                        <div className="p-3.5 rounded-2xl bg-brand-buy-50/85 border border-brand-buy-300/60 text-brand-buy-900 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-bold flex items-center gap-1.5">
                              <Zap className="w-4 h-4 text-brand-buy-600" />
                              <span>Buyer marked {order.etbAmount.toLocaleString()} ETB as paid!</span>
                            </div>
                            {autoReleaseCountdown !== null && (
                              <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-full bg-brand-buy-600 text-white tabular-nums">
                                {autoReleaseCountdown > 0 ? `Auto-Release in ${autoReleaseCountdown}s` : 'Processing release...'}
                              </span>
                            )}
                          </div>
                          <p className="leading-relaxed text-xs">
                            Please check your <strong>{railMeta.shortName}</strong> account. Confirm
                            the money arrived and click <strong>&ldquo;{t.releaseBtn}&rdquo;</strong>, or the automated escrow will auto-release to the buyer once the countdown ends.
                          </p>
                        </div>

                        <label className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-white/65 border border-black/[0.08] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={sellerConfirmedBankCheck}
                            onChange={(e) => {
                              setSellerConfirmedBankCheck(e.target.checked);
                              if (e.target.checked) setActionError(null);
                            }}
                            className="mt-0.5 rounded accent-emerald-600"
                          />
                          <span className="text-brand-ink leading-relaxed">
                            I checked my <strong>{railMeta.shortName}</strong> balance and confirmed
                            that <strong className="font-mono">{order.etbAmount.toLocaleString()} ETB</strong> arrived from{' '}
                            <strong>{displayName(order.buyerName)}</strong>.
                          </span>
                        </label>

                        <div className="flex flex-wrap gap-2.5">
                          <button
                            type="button"
                            onClick={() => handleReleaseCrypto(false)}
                            disabled={actionLoading}
                            className="flex-1 py-3 px-5 rounded-full bg-brand-buy-600 text-white font-bold text-sm hover:bg-brand-buy-700 transition-colors shadow-sm disabled:opacity-50"
                          >
                            {actionLoading ? 'Completing Order...' : t.releaseBtn}
                          </button>

                          {order.status !== 'DISPUTED' && (
                            <button
                              type="button"
                              onClick={() => setDisputeOpen(true)}
                              className="py-3 px-4 rounded-full border border-rose-200 text-brand-sell font-semibold bg-white/80 hover:bg-rose-50 transition-colors"
                            >
                              {t.disputeBtn}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. ADMIN CONTROLS (Cancel Order or Complete Order at any open stage) */}
                {isAdmin && (
                  <div className="liquid-glass-dark p-4 rounded-2xl text-white space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-brand-buy-400">
                        Admin Order Controls
                      </span>
                      <span className="text-[11px] text-white/60">
                        Cancel (refund seller) or Complete (pay buyer)
                      </span>
                    </div>

                    <input
                      type="text"
                      value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)}
                      placeholder="Optional admin reason or note (e.g. Verified payment receipt / Buyer did not pay)..."
                      className="w-full px-3.5 py-2 rounded-2xl bg-white/10 border border-white/15 text-white text-xs placeholder:text-white/45 focus:outline-none focus:border-brand-buy-400"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleReleaseCrypto(true)}
                        disabled={actionLoading}
                        className="py-2.5 px-4 rounded-full bg-brand-buy-500 text-neutral-950 font-bold hover:bg-brand-buy-400 transition-colors"
                      >
                        Complete Order (Send USDT to Buyer)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleCancelOrder(adminNote.trim() || 'Cancelled by Admin')
                        }
                        disabled={actionLoading}
                        className="py-2.5 px-4 rounded-full bg-brand-sell text-white font-bold hover:opacity-95 transition-colors"
                      >
                        Cancel Order (Return USDT to Seller)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Order Chat & Timeline */}
        <div
          className={`lg:col-span-5 space-y-5 ${
            mobileTab === 'DETAILS' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Chat Card */}
          <div className="liquid-glass-card rounded-[26px] flex flex-col h-[520px] overflow-hidden">
            <div className="liquid-glass-dark p-4 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <MessageSquare className="w-4 h-4 text-brand-buy-400" />
                <div>
                  <div className="text-xs font-bold">{t.chatTitle}</div>
                  <div className="text-[10px] text-white/60">
                    Chat directly with {isBuyer ? displayName(order.sellerName) : displayName(order.buyerName)}
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold bg-brand-buy-500/20 text-brand-buy-300 border border-brand-buy-400/30 px-2.5 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-buy-400" />
                Live
              </span>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-white/40 text-xs">
              {messages.map((msg) => {
                const isMe = msg.senderId === currentUser?.id;
                if (msg.isSystem) {
                  return (
                    <div
                      key={msg.id}
                      className="p-3 rounded-2xl bg-black/[0.05] text-brand-ink-soft border border-black/[0.08] text-[11px] leading-relaxed"
                    >
                      <span className="font-bold text-brand-ink mr-1">{msg.senderName}:</span>
                      {msg.text}
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col max-w-[85%] ${
                      isMe ? 'ml-auto items-end' : 'mr-auto items-start'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] text-brand-ink-soft mb-1 px-1">
                      <span className="font-semibold text-brand-ink">
                        {displayName(msg.senderName)}
                      </span>
                      <span>•</span>
                      <span className="font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div
                      className={`px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                        isMe
                          ? 'bg-brand-ink text-white rounded-br-sm shadow-sm'
                          : 'bg-white/90 text-brand-ink border border-black/10 rounded-bl-sm shadow-sm'
                      }`}
                    >
                      {msg.imageUrl && (
                        <div className="mb-2 overflow-hidden rounded-xl border border-black/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={msg.imageUrl}
                            alt="Receipt attachment"
                            className="max-h-56 max-w-full rounded-lg object-cover cursor-zoom-in hover:opacity-95 transition-opacity"
                            onClick={() => {
                              setReceiptUrl(msg.imageUrl!);
                              setLightboxSrc(msg.imageUrl!);
                            }}
                          />
                        </div>
                      )}
                      {msg.text && <div>{msg.text}</div>}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Reply Chips */}
            {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
              <div className="px-3 py-2 bg-white/75 border-t border-black/[0.06] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {quickChatChips.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => sendChatText(chip)}
                    className="px-3 py-1 rounded-full bg-white border border-black/10 hover:bg-black/[0.04] text-brand-ink text-[11px] font-medium whitespace-nowrap transition-colors"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            {/* Chat Input */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 border-t border-black/[0.07] bg-white/80 flex items-center gap-2"
            >
              <label
                title="Attach Image / Receipt"
                className="p-2.5 rounded-full text-brand-ink-soft hover:text-brand-ink hover:bg-black/[0.05] cursor-pointer transition-colors relative"
              >
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleChatImageUpload}
                  disabled={uploadingChatImage}
                  className="hidden"
                />
                {uploadingChatImage ? (
                  <Loader2 className="w-4 h-4 animate-spin text-brand-buy-600" />
                ) : (
                  <ImageIcon className="w-4 h-4" />
                )}
              </label>

              <input
                type="text"
                placeholder={t.chatPlaceholder}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="flex-1 px-4 py-2 rounded-full border border-black/10 bg-white/85 text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-full bg-brand-ink text-white text-xs font-semibold hover:bg-neutral-800 flex items-center justify-center transition-colors shadow-sm"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>

          {/* Order Timeline Card */}
          <div className="liquid-glass-card rounded-[26px] p-4 sm:p-5 space-y-3 text-xs">
            <div className="font-bold text-brand-ink text-xs uppercase tracking-wider border-b border-black/[0.06] pb-2">
              {t.systemAuditLog}
            </div>

            <div className="space-y-2.5">
              {order.auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="border-l-2 border-brand-buy-500 pl-3 py-0.5 space-y-0.5"
                >
                  <div className="text-[10px] font-mono text-brand-ink-soft">
                    {new Date(log.timestamp).toLocaleTimeString()} • {log.actor}
                  </div>
                  <div className="text-brand-ink leading-relaxed">{log.message}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Shared Image Lightbox */}
      <ImageLightbox
        src={lightboxSrc}
        title="Payment Receipt"
        onClose={() => setLightboxSrc(null)}
      />

      {/* Appeal / Dispute Modal */}
      {disputeOpen && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="liquid-glass-card rounded-t-[28px] sm:rounded-[28px] w-full max-w-md overflow-hidden text-xs">
            <div className="p-4 bg-brand-sell text-white flex justify-between items-center font-bold">
              <span>Need Help / Open Appeal</span>
              <button
                onClick={() => setDisputeOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/15 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleDispute} className="p-5 space-y-4">
              <p className="text-brand-ink-soft leading-relaxed">
                While under appeal, the <strong className="font-mono text-brand-ink">{order.usdtAmount.toFixed(2)} USDT</strong> stays
                locked in escrow. An Admin will check the chat and payment details to resolve the
                order.
              </p>
              <div>
                <label className="block text-brand-ink font-semibold mb-1.5">
                  What is the issue?
                </label>
                <textarea
                  required
                  rows={3}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="e.g. I sent the Birr via Telebirr 15 minutes ago, but the seller has not completed the order."
                  className="w-full p-3.5 rounded-2xl border border-black/10 bg-white/85 text-xs text-brand-ink focus:outline-none focus:border-brand-ink"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDisputeOpen(false)}
                  className="px-4 py-2 rounded-full border border-black/10 bg-white/75 text-brand-ink font-semibold hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-full bg-brand-sell text-white font-bold hover:opacity-95 transition-colors shadow-sm"
                >
                  {actionLoading ? 'Sending...' : 'Open Appeal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </ProtectedRoute>
  );
}
