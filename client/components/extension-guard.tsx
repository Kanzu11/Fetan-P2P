'use client';

import { useEffect } from 'react';
import { isBrowserExtensionError } from '@/client/extension-guard-script';

/**
 * Defense-in-depth capture-phase guard paired with the synchronous <head> bootstrap.
 * Intercepts late third-party browser extension rejections/errors before bubbling
 * to React or Next.js dev overlay handlers.
 */
export function ExtensionGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason && typeof reason === 'object' && 'message' in reason
          ? String(reason.message)
          : String(reason || '');
      const stack =
        reason && typeof reason === 'object' && 'stack' in reason
          ? String(reason.stack)
          : '';

      if (isBrowserExtensionError({ message, stack })) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    const handleError = (event: ErrorEvent) => {
      const stack =
        event.error && typeof event.error === 'object' && 'stack' in event.error
          ? String(event.error.stack)
          : '';

      if (
        isBrowserExtensionError({
          message: event.message,
          filename: event.filename,
          stack,
        })
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection, {
      capture: true,
    });
    window.addEventListener('error', handleError, { capture: true });

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection, {
        capture: true,
      });
      window.removeEventListener('error', handleError, { capture: true });
    };
  }, []);

  return null;
}

