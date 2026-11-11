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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight">Terms of Service & Escrow Agreement</h3>
              <p className="text-[11px] text-slate-400">Fetan P2P Ethiopia • Operational & Safety Standards</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-xs text-slate-600 leading-relaxed">
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-xs">Fetan Automated Escrow Guarantee</span>
              <p className="mt-0.5 text-[11px] text-emerald-800">
                All USDT involved in trades is pre-locked in escrow before the buyer is authorized to send fiat Birr.
                Neither party can withdraw or cancel an order once locked without mutual release or dispute resolution.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[11px] text-slate-700">1</span>
              Identity Verification & Name Matching Policy
            </h4>
            <p>
              Users must complete Platform KYC (Fayda National ID, Passport, or Driver&apos;s License) prior to trading.
              For regulatory compliance and anti-money laundering (AML) safeguards, the legal name on your Fetan account
              <strong> must strictly match </strong> the account holder name of the Telebirr, CBE, Bank of Abyssinia,
              or Awash Bank account used to make payment. Third-party transfers are strictly prohibited and will be rejected.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[11px] text-slate-700">2</span>
              Payment Remarks & Transfer Notes
            </h4>
            <p>
              When initiating payments via Telebirr, CBE Mobile Banking, or other local bank apps, users must
              <strong> leave the transaction remark/purpose blank</strong> or state &ldquo;Personal Transfer&rdquo;.
              Do NOT include words such as &ldquo;crypto&rdquo;, &ldquo;USDT&rdquo;, &ldquo;P2P&rdquo;, &ldquo;Bitcoin&rdquo;,
              or order numbers in the remark. Accounts causing banking freeze due to prohibited remarks may forfeit appeal rights.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[11px] text-slate-700">3</span>
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
            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[11px] text-slate-700">4</span>
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
            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[11px] text-slate-700">5</span>
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
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            Last updated: November 2026 • Fetan P2P Security Team
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors"
          >
            I Understand &amp; Agree
          </button>
        </div>
      </div>
    </div>
  );
}

