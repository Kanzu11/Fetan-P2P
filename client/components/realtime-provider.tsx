'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, P2POrder, displayName, isAdminRole } from '@/client/types';

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

export interface OtpRequestResult {
  success: boolean;
  message?: string;
  error?: string;
}

interface RealtimeContextType {
  currentUser: User | null;
  googleClientId: string | null;
  loadingUser: boolean;
  isLoggedIn: boolean;
  isAuthModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  requestLoginOtp: (email: string) => Promise<OtpRequestResult>;
  verifyLoginOtp: (email: string, code: string, name?: string) => Promise<AuthResult>;
  loginWithGoogle: (idToken: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  connected: boolean;
  notification: string | null;
  setNotification: (msg: string | null) => void;
  activeOrdersCount: number;
  latestActiveOrderId: string;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null
  );
  const [loadingUser, setLoadingUser] = useState<boolean>(true);
  const [connected, setConnected] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [activeOrdersCount, setActiveOrdersCount] = useState<number>(0);
  const [latestActiveOrderId, setLatestActiveOrderId] = useState<string>('');
  const [isAuthModalOpen, setAuthModalOpen] = useState<boolean>(false);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/current-user');
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user || null);
        if (data.googleClientId !== undefined) {
          setGoogleClientId(data.googleClientId || null);
        }

        if (data.user?.id) {
          const isAdmin = isAdminRole(data.user.role);
          const ordRes = await fetch(
            isAdmin ? '/api/orders' : `/api/orders?userId=${data.user.id}`
          );
          if (ordRes.ok) {
            const ordData = await ordRes.json();
            const orders: P2POrder[] = ordData.orders || [];
            const active = orders.filter(
              (o) =>
                o.status === 'PENDING_PAYMENT' ||
                o.status === 'PAYMENT_SENT' ||
                o.status === 'DISPUTED'
            );
            setActiveOrdersCount(active.length);
            if (active.length > 0) {
              setLatestActiveOrderId(active[0].id);
            } else if (orders.length > 0) {
              setLatestActiveOrderId(orders[0].id);
            } else {
              setLatestActiveOrderId('');
            }
          }
        } else {
          setActiveOrdersCount(0);
          setLatestActiveOrderId('');
        }
      }
    } catch (e) {
      console.error('Failed to fetch user:', e);
    } finally {
      setLoadingUser(false);
    }
  }, []);

  const requestLoginOtp = async (email: string): Promise<OtpRequestResult> => {
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), purpose: 'LOGIN' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, message: data.message };
      }
      return { success: false, error: data.error || 'Could not send verification code' };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  };

  const verifyLoginOtp = async (
    email: string,
    code: string,
    name?: string
  ): Promise<AuthResult> => {
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim(),
          ...(name?.trim() ? { name: name.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.user) {
        setCurrentUser(data.user);
        await fetchCurrentUser();
        return { success: true, user: data.user };
      }
      return { success: false, error: data.error || 'Invalid or expired verification code' };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  };

  const loginWithGoogle = async (idToken: string): Promise<AuthResult> => {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.user) {
        setCurrentUser(data.user);
        await fetchCurrentUser();
        return { success: true, user: data.user };
      }
      return { success: false, error: data.error || 'Google authentication failed' };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Google OAuth error' };
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setCurrentUser(null);
      setActiveOrdersCount(0);
      setLatestActiveOrderId('');
      setNotification('Logged out successfully.');
    } catch (e) {
      console.error('Logout failed:', e);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  // Connect to authenticated SSE stream
  useEffect(() => {
    if (!currentUser) return;

    const eventSource = new EventSource('/api/events');

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.event === 'balance_updated') {
          fetchCurrentUser();
          setNotification(
            data.data?.message ||
              `Wallet balance updated: ${Number(data.data.usdtBalance).toFixed(2)} USDT`
          );
        } else if (data.event === 'user_updated') {
          fetchCurrentUser();
        } else if (data.event === 'merchant_status_updated') {
          fetchCurrentUser();
          setNotification('Merchant account approved! You can now post Buy & Sell ads.');
        } else if (data.event === 'kyc_status_updated') {
          fetchCurrentUser();
          setNotification(`ID Check: ${data.data.message}`);
        } else if (
          data.event === 'new_merchant_request' &&
          isAdminRole(currentUser.role)
        ) {
          setNotification(
            `New Merchant Request: ${displayName(data.data.userName)} (${data.data.usdtBalance} USDT)`
          );
        } else if (
          data.event === 'new_kyc_submission' &&
          isAdminRole(currentUser.role)
        ) {
          setNotification(
            `New ID Check: ${displayName(data.data.userName)} (${data.data.kycDocType})`
          );
        } else if (data.event === 'payment_alert') {
          fetchCurrentUser();
          setNotification(
            `Buyer marked ${Number(data.data.etbAmount).toLocaleString()} ETB as paid on Order #${data.data.orderId}`
          );
        } else if (data.event === 'dispute_alert' && isAdminRole(currentUser.role)) {
          fetchCurrentUser();
          setNotification(`New appeal opened on Order #${data.data.id}`);
        }
      } catch {
        // ignore ping
      }
    };

    return () => {
      eventSource.close();
    };
  }, [currentUser?.id, currentUser?.role, fetchCurrentUser]);

  return (
    <RealtimeContext.Provider
      value={{
        currentUser,
        googleClientId,
        loadingUser,
        isLoggedIn: Boolean(currentUser),
        isAuthModalOpen,
        setAuthModalOpen,
        openAuthModal: () => setAuthModalOpen(true),
        closeAuthModal: () => setAuthModalOpen(false),
        requestLoginOtp,
        verifyLoginOtp,
        loginWithGoogle,
        logout,
        refreshUser: fetchCurrentUser,
        connected,
        notification,
        setNotification,
        activeOrdersCount,
        latestActiveOrderId,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return context;
}
