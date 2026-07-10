import { Suspense } from 'react';
import { Outfit } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

// Standard font for display contexts too (no decorative faces) — titles
// keep their weight/tracking so they still read as a wordmark.
const displayFont = Outfit({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata = {
  title: 'Walk the World',
  description: 'Spin a 3D globe, pick a place, and walk around in real street-level imagery.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${outfit.variable} ${displayFont.variable}`}>
      <body className="font-sans">
        <Providers>
          <Suspense fallback={null}>{children}</Suspense>
        </Providers>
      </body>
    </html>
  );
}
