import type { Metadata } from 'next';
import { Courier_Prime, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

// Courier Prime (a modern, legible redesign of Courier, not a true vintage
// typewriter face) still drives --mono: tickers, numbers, and the
// terminal-ish feel of buttons/pills/headings. It's kept only for --sans
// too where dense prose (AI rationale paragraphs, etc.) made it harder to
// read than the site's numbers/labels; IBM Plex Sans below replaces it
// there, a humanist sans that still reads as slightly technical.
const courierPrime = Courier_Prime({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-courier-prime',
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-ibm-plex-sans',
});

export const metadata: Metadata = {
  title: 'Stock Indicator Dailies',
  description: 'Daily stock signal report; computed vs AI, side by side.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${courierPrime.variable} ${ibmPlexSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
