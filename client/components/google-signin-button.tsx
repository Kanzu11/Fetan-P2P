'use client';

import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              width?: number;
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill';
            }
          ) => void;
        };
      };
    };
  }
}

interface GoogleSignInButtonProps {
  clientId: string | null;
  onIdToken: (idToken: string) => Promise<void> | void;
  disabled?: boolean;
  variant?: 'light' | 'dark';
}

export function GoogleSignInButton({
  clientId,
  onIdToken,
  disabled = false,
  variant = 'light',
}: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onTokenRef = useRef(onIdToken);
  onTokenRef.current = onIdToken;

  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    if (!clientId) return;

    if (window.google?.accounts?.id) {
      setScriptLoaded(true);
      return;
    }

    const existing = document.getElementById('google-gsi-script') as HTMLScriptElement | null;
    if (existing) {
      const handleLoad = () => setScriptLoaded(true);
      existing.addEventListener('load', handleLoad);
      return () => existing.removeEventListener('load', handleLoad);
    }

    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setScriptLoaded(true);
    document.head.appendChild(script);
  }, [clientId]);

  useEffect(() => {
    if (!clientId || !scriptLoaded || !containerRef.current || !window.google?.accounts?.id) {
      return;
    }

    const container = containerRef.current;
    container.innerHTML = '';

    const measuredWidth = Math.max(240, Math.min(380, container.clientWidth || 320));
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response.credential) {
          void onTokenRef.current(response.credential);
        }
      },
    });

    window.google.accounts.id.renderButton(container, {
      theme: variant === 'dark' ? 'filled_black' : 'outline',
      size: 'large',
      width: measuredWidth,
      text: 'continue_with',
      shape: 'rectangular',
    });
  }, [clientId, scriptLoaded, variant]);

  if (!clientId) {
    return (
      <div
        className={`w-full py-2.5 px-3 rounded-xl border text-[11px] text-center ${
          variant === 'dark'
            ? 'bg-slate-800/60 border-slate-700 text-slate-400'
            : 'bg-slate-100 border-slate-200 text-slate-500'
        }`}
      >
        Google Sign-In unavailable (configure <code className="font-mono">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code>). Use Email Verification Code below.
      </div>
    );
  }

  return (
    <div
      className={`w-full flex justify-center overflow-hidden rounded-xl ${
        disabled ? 'pointer-events-none opacity-60' : ''
      }`}
    >
      <div ref={containerRef} className="min-h-[40px] flex items-center justify-center w-full" />
    </div>
  );
}

