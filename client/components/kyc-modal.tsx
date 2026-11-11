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
        setNotification('ID submitted! Superadmin @kanzedin was notified via Telegram and email.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Verify Your Identity (KYC)
              </h3>
              <p className="text-xs text-slate-500">
                Required for all users before buying or selling USDT
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submitted || currentUser.kycStatus === 'PENDING' ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-900 dark:text-white">
                ID Verification in Review
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                Your ID details were sent to Superadmin <strong>@kanzedin</strong> via Telegram and email. Once approved, you can immediately buy and sell USDT.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <a
                href={`https://t.me/${botUsername}?start=kyc_${currentUser.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2.5 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-slate-200"
              >
                <Send className="w-3.5 h-3.5 text-sky-500" />
                Open @{botUsername}
              </a>
              <button
                onClick={onClose}
                className="flex-1 py-2.5 px-3 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900/60 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-sky-900 dark:text-sky-200">
                  Prefer verifying on Telegram?
                </div>
                <div className="text-[11px] text-sky-700 dark:text-sky-300 mt-0.5">
                  Submit KYC directly in @{botUsername} or the Mini App
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={`https://t.me/${botUsername}?start=kyc_${currentUser.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold flex items-center gap-1"
                >
                  <Send className="w-3 h-3" /> Bot
                </a>
                <a
                  href={miniAppUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-[11px] font-bold flex items-center gap-1"
                >
                  Mini App <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 flex items-center gap-2 text-xs text-red-700 dark:text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
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
                    className={`py-2 px-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                      docType === item.id
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                ID Document Number
              </label>
              <div className="relative">
                <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder="e.g. FAYDA-8829-1029 or EP-492019"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Upload ID Photo / Document
              </label>

              {docPhotoUrl ? (
                <div className="relative rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={docPhotoUrl}
                      alt="Uploaded ID preview"
                      className="w-12 h-12 object-cover rounded-lg border border-emerald-300"
                    />
                    <div>
                      <div className="text-xs font-bold text-emerald-900 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Image Uploaded</span>
                      </div>
                      <a
                        href={docPhotoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-emerald-700 underline truncate block max-w-[200px]"
                      >
                        View Full Image
                      </a>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDocPhotoUrl('')}
                    className="text-xs text-rose-600 font-semibold hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 bg-slate-50 dark:bg-slate-950/50 cursor-pointer transition-colors text-center">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                      disabled={uploadingImage}
                    />
                    {uploadingImage ? (
                      <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                        <span>Uploading image...</span>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-slate-400 mb-1" />
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          Click to upload ID photo
                        </span>
                        <span className="text-[10px] text-slate-500">
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
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-[11px] text-slate-600 dark:text-slate-300 focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              Your legal name on Fetan P2P (<strong>{currentUser.name}</strong>) must match the name on your ID and your bank/Telebirr account.
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
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

