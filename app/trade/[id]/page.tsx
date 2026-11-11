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

export default function EscrowRoomPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params?.id as string;

  const {
    currentUser,
    availableUsers,
    setCurrentUserId,
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
  const [previewReceiptModal, setPreviewReceiptModal] = useState(false);
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
        setNotification('Payment proof uploaded to Cloudinary!');
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
        setNotification('Image sent in chat via Cloudinary!');
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
      <div className="p-12 text-center text-slate-500 text-xs space-y-2">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mx-auto" />
        <p>Loading Order #{orderId}...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-12 text-center space-y-4 bg-white rounded-2xl border border-slate-200">
        <p className="text-slate-600 text-sm font-medium">Order #{orderId} was not found.</p>
        <button
          onClick={() => router.push('/market')}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
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
  const adminAccount =
    availableUsers.find((u) => u.role === 'ADMIN') ||
    availableUsers.find((u) => u.role === 'SUPERADMIN');

  const railMeta = PAYMENT_METHODS_META[order.paymentMethod] || PAYMENT_METHODS_META.TELEBIRR;
  const activeReceiptUrl = order.proofReceiptUrl || receiptUrl;
  const isImageReceipt =
    activeReceiptUrl &&
    (activeReceiptUrl.startsWith('http') || activeReceiptUrl.startsWith('data:image'));

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
      <div className="bg-slate-900 text-white rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>
            Trading as:{' '}
            <strong className="text-emerald-300">
              {isBuyer
                ? `Buyer (${displayName(order.buyerName)})`
                : isSeller
                ? `Seller (${displayName(order.sellerName)})`
                : `Admin Inspector (${displayName(currentUser?.name)})`}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-2 text-slate-300 text-[11px]">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>Fetan Encrypted Escrow Room</span>
        </div>
      </div>

      {/* Top Bar: Back Button, Order ID, Status Pill & Countdown */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/orders')}
              className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              title="Back to Orders"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase ${
                    isSeller
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  {isSeller ? 'Sell USDT' : 'Buy USDT'}
                </span>
                <h1 className="text-base sm:text-lg font-bold text-slate-900">
                  Order <span className="font-mono text-sm">#{order.id}</span>
                </h1>
                <span
                  className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
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
                  {order.status === 'PENDING_PAYMENT'
                    ? 'Waiting for Buyer Payment'
                    : order.status === 'PAYMENT_SENT'
                    ? 'Buyer Paid — Waiting for Seller'
                    : order.status === 'COMPLETED'
                    ? 'Completed'
                    : order.status === 'CANCELLED'
                    ? 'Cancelled'
                    : 'Appeal in Review'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Buyer: <strong className="text-slate-700">{displayName(order.buyerName)}</strong> •
                Seller: <strong className="text-slate-700">{displayName(order.sellerName)}</strong>
              </p>
            </div>
          </div>

          {/* 15-Minute Countdown Timer */}
          {order.status === 'PENDING_PAYMENT' && (
            <div className="flex items-center gap-2 bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs self-start sm:self-auto">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-300">{t.paymentWindow}:</span>
              <span className="font-mono font-bold text-sm text-emerald-400 tabular-nums">
                {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
              </span>
            </div>
          )}
        </div>

        {/* 4-Step Progress Bar */}
        {order.status !== 'CANCELLED' && (
          <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-100 text-[11px]">
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
                      done ? 'bg-emerald-600' : active ? 'bg-slate-900' : 'bg-slate-200'
                    }`}
                  />
                  <div
                    className={`font-semibold truncate ${
                      done ? 'text-emerald-700' : active ? 'text-slate-900' : 'text-slate-400'
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
      <div className="lg:hidden grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-200 border border-slate-200 text-xs font-bold">
        <button
          onClick={() => setMobileTab('DETAILS')}
          className={`py-2.5 rounded-lg transition-colors ${
            mobileTab === 'DETAILS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Order Details & Actions
        </button>
        <button
          onClick={() => setMobileTab('CHAT')}
          className={`py-2.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
            mobileTab === 'CHAT' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
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
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Escrow Protection</span>
              </div>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                {order.status === 'COMPLETED'
                  ? `✓ ${order.usdtAmount.toFixed(2)} USDT Released`
                  : order.status === 'CANCELLED'
                  ? `↺ ${order.usdtAmount.toFixed(2)} USDT Returned`
                  : `🔒 ${order.usdtAmount.toFixed(2)} USDT Locked`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="text-slate-500 text-xs">
                  {isBuyer ? 'You Pay (Birr)' : isSeller ? 'You Receive (Birr)' : t.youSend}
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
                    {order.etbAmount.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-xs font-semibold text-slate-500">ETB</span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(order.etbAmount.toFixed(2), 'Birr Amount')}
                    className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900"
                    title="Copy exact Birr amount"
                  >
                    {copiedField === 'Birr Amount' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 space-y-1">
                <div className="text-emerald-800 text-xs">
                  {isBuyer ? 'You Get (USDT)' : isSeller ? 'You Sell (USDT)' : t.youReceive}
                </div>
                <div className="text-xl sm:text-2xl font-bold text-emerald-700 tabular-nums">
                  {order.usdtAmount.toFixed(2)}{' '}
                  <span className="text-xs font-semibold text-emerald-600">USDT</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-1">
              <span>
                Price:{' '}
                <strong className="text-slate-900 tabular-nums">
                  1 USDT = {order.unitPriceEtb.toFixed(2)} ETB
                </strong>
              </span>
              <span>
                Fee: <strong className="text-emerald-700">0.00 USDT</strong>
              </span>
            </div>
          </div>

          {/* 2. Seller Payment Account Card (With 1-Tap Copy Buttons) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
                <Building className="w-4 h-4 text-slate-700" />
                <span>{t.bankDetails}</span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-800">
                <span
                  className="w-1.5 h-3 rounded-full"
                  style={{ backgroundColor: railMeta.accentColor }}
                />
                <span>{railMeta.name}</span>
              </span>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 divide-y divide-slate-200 text-xs">
              <div className="p-3.5 flex justify-between items-center">
                <span className="text-slate-500 font-medium">{t.accountName}</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-sm">
                    {order.paymentDetails.accountName}
                  </span>
                  <button
                    onClick={() =>
                      copyToClipboard(order.paymentDetails.accountName, 'Account Name')
                    }
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900"
                  >
                    {copiedField === 'Account Name' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="p-3.5 flex justify-between items-center">
                <span className="text-slate-500 font-medium">{railMeta.accountLabel}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-base text-slate-900 tabular-nums">
                    {order.paymentDetails.accountNumber}
                  </span>
                  <button
                    onClick={() =>
                      copyToClipboard(order.paymentDetails.accountNumber, 'Account Number')
                    }
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900"
                  >
                    {copiedField === 'Account Number' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="p-3.5 flex justify-between items-center">
                <span className="text-slate-500 font-medium">{t.paymentMethod}</span>
                <span className="text-slate-800 font-semibold">
                  {order.paymentDetails.bankName}
                </span>
              </div>
            </div>

            {/* Payment Safety Tip */}
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 leading-relaxed flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Important: </span>
                {t.instructions}
              </div>
            </div>
          </div>

          {/* 3. Payment Reference / Receipt Card */}
          {order.status !== 'CANCELLED' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 shadow-sm text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-900">{t.proofReceipt}</span>
                {!activeReceiptUrl && order.status === 'PENDING_PAYMENT' && (
                  <button
                    type="button"
                    onClick={handleAttachSampleReceipt}
                    className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 underline"
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
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                  />
                </div>
              )}

              {activeReceiptUrl ? (
                <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
                      <FileCheck className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 truncate">
                        {isImageReceipt
                          ? receiptName || `Payment_Receipt_${order.id}.jpg`
                          : activeReceiptUrl}
                      </div>
                      <div className="text-[11px] text-emerald-700 font-medium">
                        Payment proof attached
                      </div>
                    </div>
                  </div>
                  {isImageReceipt && (
                    <button
                      type="button"
                      onClick={() => setPreviewReceiptModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold flex-shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View</span>
                    </button>
                  )}
                </div>
              ) : (
                <label className="rounded-xl border-2 border-dashed border-slate-300 p-4 text-center cursor-pointer hover:bg-slate-50 transition-colors flex flex-col items-center justify-center">
                  <Upload className="w-5 h-5 text-slate-400 mb-1" />
                  <span className="font-semibold text-slate-700">{t.attachProof}</span>
                  <span className="text-[11px] text-slate-400 mt-0.5">
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
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm text-xs">
            {actionError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-medium flex items-center justify-between">
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
                <div className="p-5 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                  <h4 className="font-bold text-emerald-950 text-base">{t.completedTitle}</h4>
                  <p className="text-xs text-emerald-800 max-w-md mx-auto leading-relaxed">
                    {order.usdtAmount.toFixed(2)} USDT has been added to{' '}
                    <strong>{displayName(order.buyerName)}</strong>&apos;s wallet with 0.00 USDT
                    fee.
                  </p>
                  {order.resolvedBy && (
                    <p className="text-[11px] text-emerald-700 font-medium">
                      Resolved by {order.resolvedBy}
                      {order.resolutionNote ? ` — "${order.resolutionNote}"` : ''}
                    </p>
                  )}
                  <div className="pt-2 flex justify-center gap-2">
                    <button
                      onClick={() => router.push('/wallet')}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700"
                    >
                      Open Wallet
                    </button>
                    <button
                      onClick={() => router.push('/market')}
                      className="px-4 py-2 rounded-xl bg-white border border-emerald-300 text-emerald-900 font-semibold hover:bg-emerald-100"
                    >
                      New Trade
                    </button>
                  </div>
                </div>

                {/* Post-Order Feedback Section (Buyer or Seller) */}
                {(isBuyer || isSeller) && (
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                    <div className="font-bold text-slate-900 text-sm">
                      How was your trade with{' '}
                      {isBuyer ? displayName(order.sellerName) : displayName(order.buyerName)}?
                    </div>

                    {myExistingFeedback ? (
                      <div className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 p-3 rounded-lg">
                        {myExistingFeedback.rating === 'POSITIVE' ? (
                          <ThumbsUp className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <ThumbsDown className="w-4 h-4 text-rose-600" />
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
                            className={`py-2.5 px-3 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-colors ${
                              feedbackRating === 'POSITIVE'
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white text-slate-700 border-slate-200'
                            }`}
                          >
                            <ThumbsUp className="w-4 h-4" />
                            <span>Positive</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setFeedbackRating('NEGATIVE')}
                            className={`py-2.5 px-3 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-colors ${
                              feedbackRating === 'NEGATIVE'
                                ? 'bg-rose-600 text-white border-rose-600'
                                : 'bg-white text-slate-700 border-slate-200'
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
                            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs focus:outline-none focus:border-slate-900"
                          />
                          <button
                            type="submit"
                            disabled={submittingFeedback}
                            className="px-4 py-2 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
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
              <div className="p-5 rounded-xl bg-slate-100 border border-slate-200 text-center space-y-2">
                <XCircle className="w-9 h-9 text-slate-500 mx-auto" />
                <h4 className="font-bold text-slate-900 text-base">{t.cancelledTitle}</h4>
                <p className="text-xs text-slate-600">
                  This order was cancelled
                  {order.cancelledBy === 'ADMIN'
                    ? ' by Admin'
                    : order.cancelledBy === 'BUYER'
                    ? ' by the Buyer'
                    : ''}
                  . The {order.usdtAmount.toFixed(2)} USDT was unlocked and returned to{' '}
                  <strong>{displayName(order.sellerName)}</strong>.
                </p>
                {order.cancelReason && (
                  <p className="text-xs text-slate-500">Reason: &ldquo;{order.cancelReason}&rdquo;</p>
                )}
                <div className="pt-2">
                  <button
                    onClick={() => router.push('/market')}
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800"
                  >
                    Back to P2P Market
                  </button>
                </div>
              </div>
            ) : (
              /* STATE C: OPEN ORDER (PENDING_PAYMENT, PAYMENT_SENT, OR DISPUTED) */
              <div className="space-y-4">
                {order.status === 'DISPUTED' && (
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-rose-900 text-sm">
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
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
                      <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-950 space-y-1">
                        <div className="font-bold">Next step for you (Buyer):</div>
                        <p className="leading-relaxed">
                          Send <strong>{order.etbAmount.toLocaleString()} ETB</strong> to{' '}
                          <strong>{order.paymentDetails.accountName}</strong> (
                          {order.paymentDetails.accountNumber}) via {railMeta.shortName}, then tap{' '}
                          <strong>&ldquo;{t.markPaidBtn}&rdquo;</strong> below.
                        </p>
                      </div>
                    )}

                    {order.status === 'PAYMENT_SENT' && (
                      <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-bold text-xs text-emerald-800">
                            <Zap className="w-4 h-4 text-amber-500 fill-amber-500 animate-bounce" />
                            <span>Automated Escrow Release Active</span>
                          </div>
                          {autoReleaseCountdown !== null && (
                            <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-600 text-white tabular-nums shadow-sm">
                              {autoReleaseCountdown > 0 ? `Auto-Release in ${autoReleaseCountdown}s` : 'Releasing now...'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-slate-700">
                          Payment has been registered. <strong>{displayName(order.sellerName)}</strong> has been notified.
                          Our automated escrow engine will automatically complete the order and credit{' '}
                          <strong className="text-emerald-700">{order.usdtAmount.toFixed(2)} USDT</strong> directly to your wallet.
                        </p>
                        {autoReleaseCountdown !== null && (
                          <div className="w-full bg-emerald-200 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-emerald-600 h-1.5 rounded-full transition-all duration-1000"
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
                          className="flex-1 py-3 px-5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? 'Updating...' : t.markPaidBtn}
                        </button>
                      )}

                      {order.status !== 'DISPUTED' && (
                        <button
                          type="button"
                          onClick={() => setShowCancelConfirm(!showCancelConfirm)}
                          disabled={actionLoading}
                          className="py-3 px-4 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
                        >
                          {t.cancelOrderBtn}
                        </button>
                      )}

                      {order.status !== 'DISPUTED' && (
                        <button
                          type="button"
                          onClick={() => setDisputeOpen(true)}
                          className="py-3 px-4 rounded-xl border border-rose-200 text-rose-700 font-semibold bg-white hover:bg-rose-50 transition-colors"
                        >
                          {t.disputeBtn}
                        </button>
                      )}
                    </div>

                    {/* Inline Buyer Cancel Confirmation */}
                    {showCancelConfirm && (
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                        <div className="font-bold text-slate-900">
                          Are you sure you want to cancel this order?
                        </div>
                        <p className="text-slate-600">
                          Do <strong>not</strong> cancel if you have already sent Birr to the
                          seller.
                        </p>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-semibold text-slate-600">
                            Reason for cancelling:
                          </label>
                          <select
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs"
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
                            className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700"
                          >
                            Keep Order
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancelOrder(cancelReason)}
                            disabled={actionLoading}
                            className="px-4 py-2 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700"
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
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                        <div className="font-bold text-slate-900">
                          Waiting for buyer ({displayName(order.buyerName)}) to send{' '}
                          {order.etbAmount.toLocaleString()} ETB
                        </div>
                        <p className="text-slate-600 leading-relaxed">
                          Your <strong>{order.usdtAmount.toFixed(2)} USDT</strong> is locked in
                          escrow. Do not release the USDT until the buyer marks the order as paid and
                          you see the money in your {railMeta.shortName} account.
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled
                            className="py-2.5 px-4 rounded-xl bg-slate-200 text-slate-500 font-bold cursor-not-allowed"
                          >
                            Complete Order (Waiting for Buyer Payment)
                          </button>
                          <button
                            type="button"
                            onClick={() => setDisputeOpen(true)}
                            className="py-2.5 px-3.5 rounded-xl border border-rose-200 text-rose-700 font-semibold hover:bg-rose-50"
                          >
                            {t.disputeBtn}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Seller sees PAYMENT_SENT or DISPUTED -> can Confirm & Complete Order */
                      <div className="space-y-3">
                        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="font-bold flex items-center gap-1.5">
                              <Zap className="w-4 h-4 text-emerald-600" />
                              <span>Buyer marked {order.etbAmount.toLocaleString()} ETB as paid!</span>
                            </div>
                            {autoReleaseCountdown !== null && (
                              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white tabular-nums">
                                {autoReleaseCountdown > 0 ? `Auto-Release in ${autoReleaseCountdown}s` : 'Processing release...'}
                              </span>
                            )}
                          </div>
                          <p className="leading-relaxed text-xs">
                            Please check your <strong>{railMeta.shortName}</strong> account. Confirm
                            the money arrived and click <strong>&ldquo;{t.releaseBtn}&rdquo;</strong>, or the automated escrow will auto-release to the buyer once the countdown ends.
                          </p>
                        </div>

                        <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={sellerConfirmedBankCheck}
                            onChange={(e) => {
                              setSellerConfirmedBankCheck(e.target.checked);
                              if (e.target.checked) setActionError(null);
                            }}
                            className="mt-0.5 rounded accent-emerald-600"
                          />
                          <span className="text-slate-700 leading-relaxed">
                            I checked my <strong>{railMeta.shortName}</strong> balance and confirmed
                            that <strong>{order.etbAmount.toLocaleString()} ETB</strong> arrived from{' '}
                            <strong>{displayName(order.buyerName)}</strong>.
                          </span>
                        </label>

                        <div className="flex flex-wrap gap-2.5">
                          <button
                            type="button"
                            onClick={() => handleReleaseCrypto(false)}
                            disabled={actionLoading}
                            className="flex-1 py-3 px-5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            {actionLoading ? 'Completing Order...' : t.releaseBtn}
                          </button>

                          {order.status !== 'DISPUTED' && (
                            <button
                              type="button"
                              onClick={() => setDisputeOpen(true)}
                              className="py-3 px-4 rounded-xl border border-rose-200 text-rose-700 font-semibold bg-white hover:bg-rose-50 transition-colors"
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
                  <div className="p-4 rounded-xl bg-slate-900 text-white space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        Admin Order Controls
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Cancel (refund seller) or Complete (pay buyer)
                      </span>
                    </div>

                    <input
                      type="text"
                      value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)}
                      placeholder="Optional admin reason or note (e.g. Verified payment receipt / Buyer did not pay)..."
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs placeholder:text-slate-400 focus:outline-none focus:border-emerald-400"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleReleaseCrypto(true)}
                        disabled={actionLoading}
                        className="py-2.5 px-4 rounded-xl bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 transition-colors"
                      >
                        Complete Order (Send USDT to Buyer)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleCancelOrder(adminNote.trim() || 'Cancelled by Admin')
                        }
                        disabled={actionLoading}
                        className="py-2.5 px-4 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-500 transition-colors"
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
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[520px] overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <div>
                  <div className="text-xs font-bold">{t.chatTitle}</div>
                  <div className="text-[10px] text-slate-400">
                    Chat directly with {isBuyer ? displayName(order.sellerName) : displayName(order.buyerName)}
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Online
              </span>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50 text-xs">
              {messages.map((msg) => {
                const isMe = msg.senderId === currentUser?.id;
                if (msg.isSystem) {
                  return (
                    <div
                      key={msg.id}
                      className="p-3 rounded-xl bg-slate-200/80 text-slate-700 border border-slate-300 text-[11px] leading-relaxed"
                    >
                      <span className="font-bold text-slate-900 mr-1">{msg.senderName}:</span>
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
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-1 px-1">
                      <span className="font-semibold text-slate-600">
                        {displayName(msg.senderName)}
                      </span>
                      <span>•</span>
                      <span>
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div
                      className={`px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                        isMe
                          ? 'bg-slate-900 text-white rounded-br-sm'
                          : 'bg-white text-slate-900 border border-slate-200 rounded-bl-sm shadow-sm'
                      }`}
                    >
                      {msg.imageUrl && (
                        <div className="mb-2 overflow-hidden rounded-xl border border-slate-200/40">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={msg.imageUrl}
                            alt="Receipt attachment"
                            className="max-h-56 max-w-full rounded-lg object-cover cursor-pointer hover:opacity-95 transition-opacity"
                            onClick={() => {
                              setReceiptUrl(msg.imageUrl!);
                              setPreviewReceiptModal(true);
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
              <div className="px-3 py-2 bg-white border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {quickChatChips.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => sendChatText(chip)}
                    className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium whitespace-nowrap transition-colors"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            {/* Chat Input */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
            >
              <label
                title="Attach Image / Receipt (Cloudinary)"
                className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer transition-colors relative"
              >
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleChatImageUpload}
                  disabled={uploadingChatImage}
                  className="hidden"
                />
                {uploadingChatImage ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                ) : (
                  <ImageIcon className="w-4 h-4" />
                )}
              </label>

              <input
                type="text"
                placeholder={t.chatPlaceholder}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:bg-white focus:border-slate-900"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 flex items-center justify-center transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>

          {/* Order Timeline Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3 shadow-sm text-xs">
            <div className="font-bold text-slate-900 text-xs uppercase tracking-wider border-b border-slate-100 pb-2">
              {t.systemAuditLog}
            </div>

            <div className="space-y-2.5">
              {order.auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="border-l-2 border-emerald-500 pl-3 py-0.5 space-y-0.5"
                >
                  <div className="text-[10px] font-mono text-slate-400">
                    {new Date(log.timestamp).toLocaleTimeString()} • {log.actor}
                  </div>
                  <div className="text-slate-700 leading-relaxed">{log.message}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Receipt Lightbox Modal */}
      {previewReceiptModal && isImageReceipt && (
        <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <span className="font-bold text-xs text-slate-900">Payment Receipt</span>
              <button
                onClick={() => setPreviewReceiptModal(false)}
                className="p-1 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-900 flex items-center justify-center max-h-[70vh] overflow-auto">
              <img
                src={activeReceiptUrl}
                alt="Payment Receipt"
                className="max-h-[60vh] w-auto rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* Appeal / Dispute Modal */}
      {disputeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 w-full max-w-md shadow-2xl overflow-hidden text-xs">
            <div className="p-4 border-b border-slate-200 bg-rose-700 text-white flex justify-between items-center font-bold">
              <span>Need Help / Open Appeal</span>
              <button onClick={() => setDisputeOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleDispute} className="p-5 space-y-4">
              <p className="text-slate-600 leading-relaxed">
                While under appeal, the <strong>{order.usdtAmount.toFixed(2)} USDT</strong> stays
                locked in escrow. An Admin will check the chat and payment details to resolve the
                order.
              </p>
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  What is the issue?
                </label>
                <textarea
                  required
                  rows={3}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="e.g. I sent the Birr via Telebirr 15 minutes ago, but the seller has not completed the order."
                  className="w-full p-3 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDisputeOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700"
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
