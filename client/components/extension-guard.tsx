'use client';

import { useEffect } from 'react';

/**
 * ExtensionGuard prevents unhandled promise rejections from third-party
 * browser extensions (e.g. MetaMask inpage.js, Phantom, Coinbase Wallet)
 * from crashing the React tree or triggering full-screen development error overlays.
 */
export function ExtensionGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = String(reason?.message || reason || '');
      const stack = String(reason?.stack || '');

      // Identify third-party extension injection errors
      const isExtensionError =
        message.includes('MetaMask') ||
        message.includes('Failed to connect to MetaMask') ||
        message.includes('wallet') ||
        stack.includes('chrome-extension://') ||
        stack.includes('moz-extension://') ||
        stack.includes('inpage.js');

      if (isExtensionError) {
        // Prevent default browser / Next.js error overlay crash
        event.preventDefault();
        event.stopImmediatePropagation();
        console.warn('[ExtensionGuard] Caught and suppressed external browser extension rejection:', message);
      }
    };

    const handleError = (event: ErrorEvent) => {
      const filename = event.filename || '';
      const message = event.message || '';

      if (
        filename.includes('chrome-extension://') ||
        filename.includes('moz-extension://') ||
        filename.includes('inpage.js') ||
        message.includes('MetaMask')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        console.warn('[ExtensionGuard] Caught and suppressed external browser extension error:', message);
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);

  return null;
}

