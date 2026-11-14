import Link from 'next/link';
import { FetanLogo } from '@/client/components/fetan-logo';

export default function NotFoundPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="liquid-glass-card rounded-[28px] p-8 sm:p-10 max-w-md w-full text-center space-y-5">
        <div className="flex justify-center">
          <FetanLogo variant="full" size="lg" />
        </div>
        <div className="space-y-2">
          <span className="inline-block px-3 py-1 rounded-full bg-black/[0.06] text-[11px] font-mono font-bold text-brand-ink-soft">
            404 &bull; ROUTE NOT FOUND
          </span>
          <h1 className="text-2xl font-extrabold tracking-tight text-brand-ink">
            Page Outside Escrow Perimeter
          </h1>
          <p className="text-xs sm:text-sm text-brand-ink-soft leading-relaxed">
            The P2P offer, order room, or page you requested does not exist or has moved.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
          <Link
            href="/"
            className="px-5 py-2.5 rounded-full bg-brand-ink text-white text-xs font-bold hover:bg-neutral-800 transition-colors shadow-sm"
          >
            Back to Home
          </Link>
          <Link
            href="/market"
            className="px-5 py-2.5 rounded-full bg-brand-buy-600 text-white text-xs font-bold hover:bg-brand-buy-700 transition-colors shadow-sm"
          >
            Open P2P Market
          </Link>
        </div>
      </div>
    </div>
  );
}
