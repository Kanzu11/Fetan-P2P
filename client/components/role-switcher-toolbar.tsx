'use client';

import React, { useState } from 'react';
import { useRealtime } from './realtime-provider';
import { displayName } from '@/lib/types';
import {
  Bot,
  PlusCircle,
  CheckCircle2,
  X,
  SlidersHorizontal,
  RefreshCw,
} from 'lucide-react';

export function RoleSwitcherToolbar() {
  const {
    currentUser,
    availableUsers,
    setCurrentUserId,
    depositUsdt,
    notification,
    setNotification,
  } = useRealtime();
  const [isOpen, setIsOpen] = useState(false);
  const [tgModalOpen, setTgModalOpen] = useState(false);
  const [tgLogs, setTgLogs] = useState<any[]>([]);
  const [tgLoading, setTgLoading] = useState(false);

  const fetchTgLogs = async () => {
    setTgLoading(true);
    try {
      const res = await fetch('/api/telegram/webhook');
      if (res.ok) {
        const data = await res.json();
        setTgLogs(data.logs || []);
      }
    } catch (e) {
      console.error('Failed to fetch TG logs:', e);
    } finally {
      setTgLoading(false);
    }
  };

  const handleSimulateTgCallback = async (callbackData: string) => {
    try {
      const res = await fetch('/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'simulate_callback', callbackData }),
      });
      if (res.ok) {
        await fetchTgLogs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      {/* Toast Notification Banner */}
      {notification && (
        <div className="fixed top-20 right-4 z-50 bg-slate-900 text-white text-xs px-4 py-3 rounded-xl shadow-lg border border-slate-700 flex items-center gap-2.5 max-w-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <p className="flex-1 text-xs font-medium leading-relaxed">{notification}</p>
          <button
            onClick={() => setNotification(null)}
            className="text-slate-400 hover:text-white p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Floating Account Switcher Pill */}
      <div className="fixed bottom-20 md:bottom-5 right-4 z-40">
        {isOpen ? (
          <div className="w-80 sm:w-96 rounded-2xl bg-slate-900 text-white border border-slate-700 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-bold tracking-wide uppercase text-slate-200">
                  Switch Test Account
                </span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 space-y-3">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Switch between Buyer, Seller (Merchant), and Admin accounts to test the full order flow.
              </p>

              <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
                {availableUsers.map((u) => {
                  const active = currentUser?.id === u.id;
                  return (
                    <button
                      key={u.id}
                      onClick={() => {
                        setCurrentUserId(u.id);
                        setIsOpen(false);
                      }}
                      className={`w-full px-3 py-2 rounded-xl text-left transition-colors flex items-center justify-between border ${
                        active
                          ? 'bg-emerald-600/20 border-emerald-500 text-white'
                          : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-semibold text-white truncate">
                          {displayName(u.name)}
                        </div>
                        <div className="text-[10px] text-slate-400 tabular-nums">
                          {u.usdtBalance.toFixed(2)} USDT available
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider flex-shrink-0 ${
                          u.role === 'SUPERADMIN'
                            ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                            : u.role === 'ADMIN'
                            ? 'bg-sky-400/20 text-sky-300 border border-sky-400/30'
                            : u.role === 'MERCHANT'
                            ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {u.role}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-slate-800 grid grid-cols-2 gap-2">
                <button
                  onClick={() => depositUsdt(50.0)}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>+50 USDT</span>
                </button>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    setTgModalOpen(true);
                    fetchTgLogs();
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-sky-600/25 hover:bg-sky-600/35 text-sky-200 border border-sky-500/40 text-xs font-semibold transition-colors"
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>Telegram Bot</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 shadow-lg text-xs font-medium transition-colors"
            title="Switch Account or Open Telegram Bot"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="font-semibold">
              {currentUser ? displayName(currentUser.name).split(' ')[0] : 'Account'}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300">
              {currentUser?.role}
            </span>
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
          </button>
        )}
      </div>

      {/* Telegram Bot Simulator Modal */}
      {tgModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-sky-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight">Telegram Admin Alerts</h3>
                  <p className="text-xs text-slate-400">
                    Approve merchant requests and ID checks from Telegram
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTgModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content List */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 bg-slate-50 text-xs">
              <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-xs leading-relaxed">
                When a user applies to become a merchant, submits an ID check, or opens an appeal, Fetan sends a message to the Admin Telegram channel. You can click the buttons below to test approving or rejecting them.
              </div>

              {tgLoading ? (
                <div className="py-12 text-center text-slate-500">Loading Telegram messages...</div>
              ) : tgLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-500 rounded-xl border border-dashed border-slate-300 bg-white p-6">
                  No Telegram messages sent in this session yet. Submit a Merchant Request, ID Check, or Order Appeal to see it here.
                </div>
              ) : (
                tgLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-3"
                  >
                    <div className="flex justify-between items-center text-[11px] text-slate-500 border-b border-slate-100 pb-2">
                      <span className="font-bold text-slate-800 uppercase tracking-wider">
                        {log.type}
                      </span>
                      <span className="font-mono">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                      {log.text}
                    </pre>
                    {log.buttons && log.buttons.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {log.buttons.map((btn: any, idx: number) => (
                          <button
                            key={idx}
                            onClick={() => handleSimulateTgCallback(btn.callbackData)}
                            className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                          >
                            {btn.text}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 border-t border-slate-200 bg-white flex justify-between items-center">
              <button
                onClick={fetchTgLogs}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
              <button
                onClick={() => setTgModalOpen(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
