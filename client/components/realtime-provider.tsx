'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, P2POrder, displayName, isAdminRole } from '@/client/types';

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

interface RealtimeContextType {
  currentUser: User | null;
  availableUsers: User[];
  isLoggedIn: boolean;
  isAuthModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  loginWithEmail: (email: string, name?: string) => Promise<AuthResult>;
  loginWithGoogle: () => Promise<AuthResult>;
  logout: () => Promise<void>;
  setCurrentUserId: (id: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  depositUsdt: (amount: number) => Promise<void>;
  connected: boolean;
  notification: string | null;
  setNotification: (msg: string | null) => void;
  activeOrdersCount: number;
  latestActiveOrderId: string;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [activeOrdersCount, setActiveOrdersCount] = useState<number>(1);
  const [latestActiveOrderId, setLatestActiveOrderId] = useState<string>('20261109000101');
  const [isAuthModalOpen, setAuthModalOpen] = useState<boolean>(false);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/current-user');
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user);
        setAvailableUsers(data.availableUsers || []);

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
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch user:', e);
    }
  }, []);

  const loginWithEmail = async (email: string, name?: string): Promise<AuthResult> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, provider: 'email' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentUser(data.user);
        await fetchCurrentUser();
        return { success: true, user: data.user };
      }
      return { success: false, error: data.error || 'Login failed' };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  };

  const loginWithGoogle = async (): Promise<AuthResult> => {
    try {
      // Realistic Google Identity Profile simulation / integration
      const googleUser = {
        email: 'dawit.google@fetan.et',
        name: 'Dawit Mekonnen (Google)',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop',
        provider: 'google',
      };

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(googleUser),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentUser(data.user);
        await fetchCurrentUser();
        return { success: true, user: data.user };
      }
      return { success: false, error: data.error || 'Google login failed' };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Google OAuth error' };
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setCurrentUser(null);
      setNotification('Logged out successfully.');
    } catch (e) {
      console.error('Logout failed:', e);
    }
  };

  const setCurrentUserId = async (id: string) => {
    try {
      const res = await fetch('/api/auth/current-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id }),
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user);
        await fetchCurrentUser();
        setNotification(
          `Switched to ${displayName(data.user.name)} (${data.user.role})`
        );
      }
    } catch (e) {
      console.error('Failed to switch user:', e);
    }
  };

  const depositUsdt = async (amount: number) => {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/user/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, amountUsdt: amount }),
      });
      if (res.ok) {
        await fetchCurrentUser();
        setNotification(`Added +${amount.toFixed(2)} USDT to your wallet.`);
      }
    } catch (e) {
      console.error('Failed deposit:', e);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  // Connect to SSE stream
  useEffect(() => {
    if (!currentUser) return;

    const query = new URLSearchParams({
      userId: currentUser.id,
      role: currentUser.role,
    });

    const eventSource = new EventSource(`/api/events?${query.toString()}`);

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.event === 'balance_updated') {
          fetchCurrentUser();
          setNotification(
            `Wallet balance updated: ${Number(data.data.usdtBalance).toFixed(2)} USDT`
          );
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
        availableUsers,
        isLoggedIn: Boolean(currentUser),
        isAuthModalOpen,
        setAuthModalOpen,
        openAuthModal: () => setAuthModalOpen(true),
        closeAuthModal: () => setAuthModalOpen(false),
        loginWithEmail,
        loginWithGoogle,
        logout,
        setCurrentUserId,
        refreshUser: fetchCurrentUser,
        depositUsdt,
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
