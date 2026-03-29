import type { Metadata } from 'next';
import { VT323, Space_Mono } from 'next/font/google';
import './globals.css';

const headingFont = VT323({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-heading'
});

const bodyFont = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
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
