import type { NextConfig } from 'next';

/** Sites allowed to embed this app in an iframe. No X-Frame-Options/CSP
 * header currently exists, which is permissive by omission rather than by
 * intent; this makes the allowlist explicit so a future unrelated security
 * header doesn't silently break the portfolio embed. */
const FRAME_ANCESTORS = [
  "'self'",
  'https://www.jtm-kaihatsu.com',
  'https://jtm-kaihatsu.com',
];

const nextConfig: NextConfig = {
  transpilePackages: ['@stock-indicator-dailies/shared', '@stock-indicator-dailies/eval-backtest', '@stock-indicator-dailies/indicators'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: `frame-ancestors ${FRAME_ANCESTORS.join(' ')};` },
        ],
      },
    ];
  },
};

export default nextConfig;
