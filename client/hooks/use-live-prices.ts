'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MarketPriceStats } from '@/client/pricing';

export type PriceDirection = 'up' | 'down' | 'flat';

interface LivePriceSnapshot {
  stats: MarketPriceStats | null;
  connected: boolean;
  priceDirection: PriceDirection;
  lastUpdatedAt: string | null;
}

type Listener = (snapshot: LivePriceSnapshot) => void;

const listeners = new Set<Listener>();
let currentSnapshot: LivePriceSnapshot = {
  stats: null,
  connected: false,
  priceDirection: 'flat',
  lastUpdatedAt: null,
};

let eventSource: EventSource | null = null;
let socket: WebSocket | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function notifyListeners() {
  for (const listener of listeners) {
    listener(currentSnapshot);
  }
}

function applyIncomingStats(nextStats: MarketPriceStats, timestamp?: string) {
  const prevPrice = currentSnapshot.stats?.referencePriceEtb ?? null;
  const nextPrice = nextStats.referencePriceEtb;
  let direction: PriceDirection = currentSnapshot.priceDirection;

  if (prevPrice !== null && Math.abs(nextPrice - prevPrice) >= 0.01) {
    direction = nextPrice > prevPrice ? 'up' : 'down';
  }

  currentSnapshot = {
    stats: nextStats,
    connected: true,
    priceDirection: direction,
    lastUpdatedAt: timestamp || new Date().toISOString(),
  };
  notifyListeners();
}

function startTransport() {
  if (typeof window === 'undefined') return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (wsUrl && !socket) {
    try {
      const url = wsUrl.includes('?') ? `${wsUrl}&channel=prices` : `${wsUrl}?channel=prices`;
      socket = new WebSocket(url);
      socket.onopen = () => {
        currentSnapshot = { ...currentSnapshot, connected: true };
        notifyListeners();
      };
      socket.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as {
            event?: string;
            data?: { stats?: MarketPriceStats };
          };
          if (parsed?.event === 'price_updated' && parsed.data?.stats) {
            applyIncomingStats(parsed.data.stats);
          }
        } catch {
          // Ignore malformed frame
        }
      };
      socket.onclose = () => {
        socket = null;
      };
    } catch {
      socket = null;
    }
  }

  if (!eventSource) {
    eventSource = new EventSource('/api/prices/stream');
    eventSource.onopen = () => {
      currentSnapshot = { ...currentSnapshot, connected: true };
      notifyListeners();
    };
    eventSource.addEventListener('price_updated', (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data) as {
          stats?: MarketPriceStats;
          timestamp?: string;
        };
        if (parsed?.stats) {
          applyIncomingStats(parsed.stats, parsed.timestamp);
        }
      } catch {
        // Ignore malformed payload
      }
    });
    eventSource.onerror = () => {
      currentSnapshot = { ...currentSnapshot, connected: false };
      notifyListeners();
    };
  }
}

function stopTransportIfIdle() {
  if (listeners.size > 0) return;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (listeners.size > 0) return;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (socket) {
      socket.close();
      socket = null;
    }
    currentSnapshot = { ...currentSnapshot, connected: false };
  }, 500);
}

export function useLivePrices() {
  const [snapshot, setSnapshot] = useState<LivePriceSnapshot>(currentSnapshot);

  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot(currentSnapshot);
    startTransport();

    return () => {
      listeners.delete(setSnapshot);
      stopTransportIfIdle();
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/prices/live', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { stats?: MarketPriceStats };
      if (data?.stats) {
        applyIncomingStats(data.stats);
      }
    } catch {
      // Non-fatal fallback
    }
  }, []);

  return {
    ...snapshot,
    refresh,
  };
}
