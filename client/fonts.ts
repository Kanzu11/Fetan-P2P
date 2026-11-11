import { Inter, Noto_Sans_Ethiopic } from 'next/font/google';

export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

// Noto Sans Ethiopic ships Latin + Ethiopic glyphs; preload keeps Amharic
// layout stable instead of falling back to a system font at runtime.
export const amharic = Noto_Sans_Ethiopic({
  subsets: ['ethiopic', 'latin'],
  variable: '--font-amharic',
  display: 'swap',
  weight: ['400', '500', '700'],
});

// Monospaced figures for financial data
export const mono = Inter({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['500', '600'],
});