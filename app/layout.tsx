import type { Metadata, Viewport } from 'next';
import './globals.css';
import type { ReactNode } from 'react';
import { Inter, Noto_Sans_Ethiopic } from 'next/font/google';
import { I18nProvider } from '@/client/i18n';
import { RealtimeProvider } from '@/client/components/realtime-provider';
import { ExtensionGuard } from '@/client/components/extension-guard';
import { Navigation } from '@/client/components/navigation';
import theme from '@/client/theme';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const amharic = Noto_Sans_Ethiopic({
  subsets: ['ethiopic', 'latin'],
  variable: '--font-amharic',
  display: 'swap',
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'Fetan P2P — Buy & Sell USDT in Ethiopia | Telebirr, CBE, BoA',
  description:
    'Ethiopia’s peer-to-peer USDT marketplace with automated escrow protection. Settle directly in ETB via Telebirr, Commercial Bank of Ethiopia (CBE), Bank of Abyssinia, and Awash Bank.',
  openGraph: {
    images: ['/og-image.jpg'],
    locale: 'en_ET',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className="min-h-screen bg-[color:var(--background)] text-slate-900 flex flex-col antialiased selection:bg-emerald-600 selection:text-white pb-20 md:pb-0"
        style={{
          fontFamily: 'var(--font-inter), var(--font-amharic), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Ethiopic", sans-serif',
          color: '#0B1F14',
          background: '#F7F7F4',
        }}
      >
        <I18nProvider>
          <RealtimeProvider>
            <ExtensionGuard />
            <Navigation />
            <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
              {children}
            </main>
          </RealtimeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}