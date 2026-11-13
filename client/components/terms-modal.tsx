'use client';

import React from 'react';
import { ShieldCheck, X, FileText, CheckCircle2, AlertTriangle, Scale, Lock } from 'lucide-react';

interface TermsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TermsModal({ isOpen, onClose }: TermsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-md p-4">
      <div className="liquid-glass-card rounded-[28px] max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="liquid-glass-dark p-4 sm:p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-brand-buy-500/20 border border-brand-buy-400/30 flex items-center justify-center text-brand-buy-400">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight">Terms of Service & Escrow Agreement</h3>
              <p className="text-[11px] text-white/65">Fetan P2P Ethiopia • Operational & Safety Standards</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-xs text-brand-ink-soft leading-relaxed">
          <div className="p-4 rounded-2xl bg-brand-buy-50/85 border border-brand-buy-300/60 text-brand-buy-900 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-brand-buy-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-xs">Fetan Automated Escrow Guarantee</span>
              <p className="mt-0.5 text-[11px] text-brand-buy-900/80">
                All USDT involved in trades is pre-locked in escrow before the buyer is authorized to send fiat Birr.
                Neither party can withdraw or cancel an order once locked without mutual release or dispute resolution.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-brand-ink text-sm flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-black/[0.06] flex items-center justify-center text-[11px] font-mono text-brand-ink">1</span>
              Identity Verification & Name Matching Policy
            </h4>
            <p>
              Users must complete Platform KYC (Fayda National ID, Passport, or Driver&apos;s License) prior to trading.
              For regulatory compliance and anti-money laundering (AML) safeguards, the legal name on your Fetan account
              <strong className="text-brand-ink"> must strictly match </strong> the account holder name of the Telebirr, CBE, Bank of Abyssinia,
              or Awash Bank account used to make payment. Third-party transfers are strictly prohibited and will be rejected.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-brand-ink text-sm flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-black/[0.06] flex items-center justify-center text-[11px] font-mono text-brand-ink">2</span>
              Payment Remarks & Transfer Notes
            </h4>
            <p>
              When initiating payments via Telebirr, CBE Mobile Banking, or other local bank apps, users must
              <strong className="text-brand-ink"> leave the transaction remark/purpose blank</strong> or state &ldquo;Personal Transfer&rdquo;.
              Do NOT include words such as &ldquo;crypto&rdquo;, &ldquo;USDT&rdquo;, &ldquo;P2P&rdquo;, &ldquo;Bitcoin&rdquo;,
              or order numbers in the remark. Accounts causing banking freeze due to prohibited remarks may forfeit appeal rights.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-brand-ink text-sm flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-black/[0.06] flex items-center justify-center text-[11px] font-mono text-brand-ink">3</span>
              Order Payment & Automatic Release Protocol
            </h4>
            <p>
              Buyers must click &ldquo;I Have Paid&rdquo; only AFTER the funds have been successfully debited from their account
              and provide genuine payment transaction receipts. Once marked as paid, the seller must verify receipt in their
              mobile banking application. Unresponsive orders with verified payment receipts may be automatically released by
              the automated escrow engine or platform administration.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-brand-ink text-sm flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-black/[0.06] flex items-center justify-center text-[11px] font-mono text-brand-ink">4</span>
              Dispute Resolution & Evidence Submission
            </h4>
            <p>
              If a dispute arises, both parties agree to upload unedited digital receipts and bank SMS notifications
              directly in the encrypted trade room. Administration will examine the evidence against banking records.
              Falsifying receipts or opening fraudulent appeals will result in immediate permanent account suspension and
              forfeiture of escrowed funds.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-brand-ink text-sm flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-black/[0.06] flex items-center justify-center text-[11px] font-mono text-brand-ink">5</span>
              Certified Merchant Privileges & Obligations
            </h4>
            <p>
              Certified Merchants are permitted to publish public Buy &amp; Sell advertisements. Merchants must maintain a
              minimum operating balance of 10 USDT, maintain a completion rate of at least 85%, and respond to open orders
              within 15 minutes. Failure to meet service level standards may result in merchant badge revocation.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-white/70 border-t border-black/[0.07] flex items-center justify-between gap-2">
          <div className="text-[11px] text-brand-ink-soft">
            Last updated: November 2026 • Fetan P2P Security Team
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-full bg-brand-ink hover:bg-neutral-800 text-white font-bold text-xs transition-colors shadow-sm"
          >
            I Understand &amp; Agree
          </button>
        </div>
      </div>
    </div>
  );
}

