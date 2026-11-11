import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RealtimeProvider } from '@/client/components/realtime-provider';
import { I18nProvider } from '@/client/i18n';
import { RoleSwitcherToolbar } from '@/client/components/role-switcher-toolbar';
import { Navigation } from '@/client/components/navigation';

export const metadata: Metadata = {
  title: 'Fetan P2P — Buy & Sell USDT in Ethiopia | Telebirr, CBE, BoA',
  description:
    'Ethiopia’s peer-to-peer USDT marketplace with automated escrow protection. Settle directly in ETB via Telebirr, Commercial Bank of Ethiopia (CBE), Bank of Abyssinia, and Awash Bank.',
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
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col antialiased selection:bg-emerald-600 selection:text-white pb-20 md:pb-0">
        <I18nProvider>
          <RealtimeProvider>
            <Navigation />
            <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
              {children}
            </main>
            <RoleSwitcherToolbar />
          </RealtimeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
