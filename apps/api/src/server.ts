import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { daily } from './routes/daily.ts';
import { backtestRoute } from './routes/backtest.ts';

const app = new Hono();

app.use('*', logger());
app.use('/api/*', cors({ origin: ['http://localhost:3000'] }));
app.route('/api', daily);
app.route('/api', backtestRoute);

const port = Number(process.env.PORT) || 3001;
console.log(`stock-indicator-dailies API listening on :${port}`);
serve({ fetch: app.fetch, port });
