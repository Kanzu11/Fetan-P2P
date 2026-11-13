'use client';

import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  FileText,
  Upload,
  AlertCircle,
  Send,
  ExternalLink,
} from 'lucide-react';
import { useRealtime } from '@/client/components/realtime-provider';
import { KycDocType } from '@/client/types';

interface KycModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KycModal({ isOpen, onClose }: KycModalProps) {
  const { currentUser, refreshUser, setNotification } = useRealtime();
  const [docType, setDocType] = useState<KycDocType>('NATIONAL_ID');
  const [docNumber, setDocNumber] = useState('');
  const [docPhotoUrl, setDocPhotoUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !currentUser) return null;

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'fetanp2probot';
  const miniAppUrl = process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_URL || 'https://app9136159373.tgcloud.ai/';

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'fetan_p2p/kyc');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success && data.url) {
        setDocPhotoUrl(data.url);
        setNotification('ID image uploaded successfully!');
      } else {
        setError(data.error || 'Failed to upload image');
      }
    } catch {
      setError('Network error while uploading image');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!docNumber.trim()) {
      setError('Please enter your ID number.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/user/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          docType,
          docNumber: docNumber.trim(),
          docPhotoUrl: docPhotoUrl.trim() || undefined,
          source: 'WEB',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
        setNotification('ID submitted! Our compliance team was notified via Telegram and email.');
        await refreshUser();
      } else {
        setError(data.error || 'Could not submit ID.');
      }
    } catch {
      setError('Network error while submitting ID.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-md p-4">
      <div className="liquid-glass-card rounded-[28px] max-w-md w-full overflow-hidden flex flex-col max-h-[92vh]">
        <div className="liquid-glass-dark flex items-center justify-between px-5 py-4 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-brand-buy-500/20 border border-brand-buy-400/30 flex items-center justify-center text-brand-buy-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold tracking-tight">
                Verify Your Identity (KYC)
              </h3>
              <p className="text-[11px] text-white/65">
                Required before buying or selling USDT
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submitted || currentUser.kycStatus === 'PENDING' ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-bold text-brand-ink">
                ID Verification in Review
              </h4>
              <p className="text-xs text-brand-ink-soft mt-1 leading-relaxed">
                Your ID details were sent to our compliance team via Telegram and email. Once approved, you can immediately buy and sell USDT.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <a
                href={`https://t.me/${botUsername}?start=kyc_${currentUser.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2.5 px-4 rounded-full border border-black/10 bg-white/80 text-brand-ink text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-white transition-colors"
              >
                <Send className="w-3.5 h-3.5 text-sky-600" />
                Open @{botUsername}
              </a>
              <button
                onClick={onClose}
                className="flex-1 py-2.5 px-4 rounded-full bg-brand-ink hover:bg-neutral-800 text-white text-xs font-bold transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
            <div className="p-3.5 rounded-2xl bg-sky-50/85 border border-sky-200 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-sky-950">
                  Prefer verifying on Telegram?
                </div>
                <div className="text-[11px] text-sky-800 mt-0.5">
                  Submit KYC directly in @{botUsername} or Mini App
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={`https://t.me/${botUsername}?start=kyc_${currentUser.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-full bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold flex items-center gap-1"
                >
                  <Send className="w-3 h-3" /> Bot
                </a>
                <a
                  href={miniAppUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-full bg-brand-ink text-white text-[11px] font-bold flex items-center gap-1"
                >
                  Mini App <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-2xl bg-rose-50/90 border border-rose-200 flex items-center gap-2 text-xs text-rose-800">
                <AlertCircle className="w-4 h-4 text-brand-sell shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-brand-ink mb-1.5">
                Select ID Type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'NATIONAL_ID', label: 'Fayda / Kebele' },
                    { id: 'PASSPORT', label: 'Passport' },
                    { id: 'DRIVERS_LICENSE', label: 'Driver License' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDocType(item.id)}
                    className={`py-2.5 px-2.5 rounded-2xl border text-xs font-semibold transition-all ${
                      docType === item.id
                        ? 'border-brand-ink bg-brand-ink text-white shadow-sm'
                        : 'border-black/10 bg-white/70 text-brand-ink-soft hover:bg-white hover:text-brand-ink'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-brand-ink mb-1.5">
                ID Document Number
              </label>
              <div className="relative">
                <FileText className="w-4 h-4 text-brand-ink-soft absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder="e.g. FAYDA-8829-1029 or EP-492019"
                  className="w-full pl-9 pr-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-xs font-mono text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-brand-ink mb-1.5">
                Upload ID Photo / Document
              </label>

              {docPhotoUrl ? (
                <div className="relative rounded-2xl border border-brand-buy-300/60 bg-brand-buy-50/80 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={docPhotoUrl}
                      alt="Uploaded ID preview"
                      className="w-12 h-12 object-cover rounded-xl border border-brand-buy-300"
                    />
                    <div>
                      <div className="text-xs font-bold text-brand-buy-900 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-brand-buy-600" />
                        <span>Image Uploaded</span>
                      </div>
                      <a
                        href={docPhotoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-brand-buy-700 underline truncate block max-w-[200px]"
                      >
                        View Full Image
                      </a>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDocPhotoUrl('')}
                    className="text-xs text-brand-sell font-semibold hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="flex flex-col items-center justify-center p-4 rounded-2xl border-2 border-dashed border-black/15 hover:border-brand-buy-500 bg-white/60 hover:bg-white cursor-pointer transition-colors text-center">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                      disabled={uploadingImage}
                    />
                    {uploadingImage ? (
                      <div className="flex items-center gap-2 text-xs text-brand-ink font-semibold">
                        <Loader2 className="w-4 h-4 animate-spin text-brand-buy-600" />
                        <span>Uploading image...</span>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-brand-ink-soft mb-1" />
                        <span className="text-xs font-bold text-brand-ink">
                          Click to upload ID photo
                        </span>
                        <span className="text-[10px] text-brand-ink-soft">
                          JPG, PNG, WEBP (stored securely)
                        </span>
                      </>
                    )}
                  </label>

                  <div className="relative">
                    <input
                      type="url"
                      value={docPhotoUrl}
                      onChange={(e) => setDocPhotoUrl(e.target.value)}
                      placeholder="Or paste image URL directly..."
                      className="w-full px-3.5 py-2 rounded-2xl border border-black/10 bg-white/75 text-[11px] text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-2xl bg-white/65 border border-black/[0.08] text-[11px] text-brand-ink-soft leading-relaxed">
              Your legal name on Fetan P2P (<strong className="text-brand-ink">{currentUser.name}</strong>) must match the name on your ID and your bank/Telebirr account.
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-full bg-brand-buy-600 hover:bg-brand-buy-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-sm"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Submit ID for Verification
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

