'use client';

import React, { useEffect, useState } from 'react';
import { useRealtime } from './realtime-provider';
import { SupportTicket } from '@/client/types';
import { X, LifeBuoy, Send, CheckCircle2, Clock } from 'lucide-react';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultOrderId?: string;
}

export function SupportModal({ isOpen, onClose, defaultOrderId = '' }: SupportModalProps) {
  const { currentUser, setNotification, openAuthModal } = useRealtime();
  const [category, setCategory] = useState<SupportTicket['category']>('ORDER_COMPLAINT');
  const [orderId, setOrderId] = useState(defaultOrderId);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  const loadTickets = async () => {
    if (!currentUser) return;
    setLoadingTickets(true);
    try {
      const res = await fetch('/api/support');
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    if (isOpen && currentUser) {
      setOrderId(defaultOrderId);
      void loadTickets();
    }
  }, [isOpen, currentUser?.id, defaultOrderId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onClose();
      openAuthModal();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE',
          category,
          orderId: orderId.trim() || undefined,
          subject: subject.trim(),
          message: message.trim(),
          source: 'WEB',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not submit support ticket.');
      }
      setNotification('Support ticket submitted to operations.');
      setSubject('');
      setMessage('');
      await loadTickets();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="liquid-glass-card rounded-[24px] max-w-lg w-full overflow-hidden shadow-modal flex flex-col max-h-[88vh]">
        <div className="px-5 py-4 border-b border-black/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-brand-ink text-white flex items-center justify-center">
              <LifeBuoy className="w-4 h-4 text-brand-buy-400" />
            </span>
            <div>
              <h3 className="font-semibold text-sm text-brand-ink tracking-tight">Support Desk</h3>
              <p className="text-[11px] text-brand-ink-soft">Escrow appeals, payment help, and KYC review</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-brand-ink-soft hover:text-brand-ink hover:bg-black/5 transition-colors"
            aria-label="Close support"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {!currentUser ? (
            <div className="text-center py-6 space-y-3">
              <p className="text-xs text-brand-ink-soft">Sign in to open or track support tickets.</p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  openAuthModal();
                }}
                className="px-4 py-2 rounded-full bg-brand-ink text-white text-xs font-semibold"
              >
                Sign In
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-3">
                {error && (
                  <div className="p-2.5 rounded-xl bg-brand-sell/10 border border-brand-sell/20 text-brand-sell text-xs">
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-brand-ink-soft mb-1">
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as SupportTicket['category'])}
                      className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white/80 text-xs text-brand-ink focus:outline-none focus:border-brand-buy"
                    >
                      <option value="ORDER_COMPLAINT">Order Appeal</option>
                      <option value="PAYMENT_ISSUE">Payment / Deposit</option>
                      <option value="KYC_HELP">KYC Verification</option>
                      <option value="GENERAL_SUPPORT">General Question</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-brand-ink-soft mb-1">
                      Order ID (optional)
                    </label>
                    <input
                      type="text"
                      value={orderId}
                      onChange={(e) => setOrderId(e.target.value)}
                      placeholder="e.g. ORD-..."
                      className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white/80 text-xs font-mono text-brand-ink focus:outline-none focus:border-brand-buy"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-brand-ink-soft mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Brief summary of the issue"
                    className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white/80 text-xs text-brand-ink focus:outline-none focus:border-brand-buy"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-brand-ink-soft mb-1">
                    Details
                  </label>
                  <textarea
                    required
                    minLength={5}
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Include transaction reference or steps so support can act fast..."
                    className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white/80 text-xs text-brand-ink focus:outline-none focus:border-brand-buy resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-full bg-brand-ink hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Submitting...' : 'Send Support Request'}</span>
                </button>
              </form>

              <div className="border-t border-black/[0.06] pt-4 space-y-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-ink-soft">
                  Recent Tickets
                </div>
                {loadingTickets ? (
                  <p className="text-xs text-brand-ink-soft">Loading tickets...</p>
                ) : tickets.length === 0 ? (
                  <p className="text-xs text-brand-ink-soft">No open or past support tickets.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {tickets.slice(0, 5).map((tk) => (
                      <div
                        key={tk.id}
                        className="p-3 rounded-2xl bg-white/70 border border-black/[0.06] space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-brand-ink truncate">{tk.subject}</span>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              tk.status === 'RESOLVED'
                                ? 'bg-brand-buy/10 text-brand-buy'
                                : 'bg-amber-500/15 text-amber-800'
                            }`}
                          >
                            {tk.status === 'RESOLVED' ? (
                              <CheckCircle2 className="w-2.5 h-2.5" />
                            ) : (
                              <Clock className="w-2.5 h-2.5" />
                            )}
                            {tk.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-brand-ink-soft line-clamp-2">{tk.message}</p>
                        {tk.adminReply && (
                          <div className="mt-1.5 pt-1.5 border-t border-black/[0.05] text-[11px] text-brand-ink">
                            <span className="font-semibold">Reply:</span> {tk.adminReply}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

