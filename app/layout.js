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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Walk the World — A living planet from open data',
  description: 'Pick a real place and explore a living 3D interpretation of its streets.',
  applicationName: 'Walk the World',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  openGraph: {
    title: 'Walk the World',
    description: 'Real streets rebuilt from open data as a living 3D world.',
    type: 'website',
  },
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
