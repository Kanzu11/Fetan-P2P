import type { Metadata, Viewport } from 'next';
import './globals.css';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono, Noto_Sans_Ethiopic } from 'next/font/google';
import { I18nProvider } from '@/client/i18n';
import { RealtimeProvider } from '@/client/components/realtime-provider';
import { ExtensionGuard } from '@/client/components/extension-guard';
import { EXTENSION_GUARD_INLINE_SCRIPT } from '@/client/extension-guard-script';
import { Navigation } from '@/client/components/navigation';
import { ToastBanner } from '@/client/components/toast-banner';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['500', '600', '700'],
});

const amharic = Noto_Sans_Ethiopic({
  subsets: ['ethiopic', 'latin'],
  variable: '--font-amharic',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const appBaseUrl = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
  } catch {
    return new URL('http://localhost:3000');
  }
})();

export const metadata: Metadata = {
  metadataBase: appBaseUrl,
  title: {
    default: 'Fetan P2P — Ethiopia USDT Escrow Desk',
    template: '%s • Fetan P2P',
  },
  description:
    'Peer-to-peer USDT marketplace in Ethiopia with automated escrow protection. Settle directly in ETB via Telebirr, CBE, Bank of Abyssinia, and Awash Bank.',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'Fetan P2P — Ethiopia USDT Escrow Desk',
    description:
      'Direct ETB ↔ USDT P2P exchange protected by automated pre-funded escrow.',
    type: 'website',
    locale: 'en_ET',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#f3f4f2',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${amharic.variable}`}
    >
      <head>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: EXTENSION_GUARD_INLINE_SCRIPT }}
        />
      </head>
      <body className="min-h-screen ambient-canvas text-brand-ink flex flex-col antialiased selection:bg-brand-buy selection:text-white pb-24 md:pb-10">
        <I18nProvider>
          <RealtimeProvider>
            <ExtensionGuard />
            <ToastBanner />
            <Navigation />
            <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7">
              {children}
            </main>
          </RealtimeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
