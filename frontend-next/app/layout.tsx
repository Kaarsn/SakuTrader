import type { Metadata } from 'next';
import { Sora, Nunito } from 'next/font/google';
import './globals.css';

const headingFont = Sora({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-heading'
});

const bodyFont = Nunito({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-body'
});

export const metadata: Metadata = {
  title: 'SakuTrader',
  description: 'Platform analisis saham Indonesia berbasis AI'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>{children}</body>
    </html>
  );
}
