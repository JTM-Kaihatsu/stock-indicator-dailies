import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@stock-indicator-dailies/shared', '@stock-indicator-dailies/eval-backtest', '@stock-indicator-dailies/indicators'],
};

export default nextConfig;
