import type { Metadata } from 'next';
import { Courier_Prime } from 'next/font/google';
import './globals.css';

// The site's one typeface: a modern redesign of Courier built for
// legibility (unlike a true vintage typewriter face), with a real bold
// weight rather than a synthetic one. Regular is used for body copy;
// bold drives the many emphasis elements (headings, pills, buttons)
// that already existed as font-weight: 600/700 before this swap.
const courierPrime = Courier_Prime({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-courier-prime',
});

export const metadata: Metadata = {
  title: 'Stock Indicator Dailies',
  description: 'Daily stock signal report; computed vs AI, side by side.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={courierPrime.variable}>
      <body>{children}</body>
    </html>
  );
}
