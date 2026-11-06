import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './db.js';
import { requireAuth } from './auth.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import importRoutes from './routes/imports.js';
import userRoutes from './routes/users.js';
import clientRoutes from './routes/clients.js';
import reportRoutes from './routes/reports.js';
import rateRoutes from './routes/rates.js';
import partnerRoutes from './routes/partner.js';
import payoutRoutes from './routes/payouts.js';
import auditRoutes from './routes/audit.js';
import settingsRoutes from './routes/settings.js';

const app = express();
// BASE_PATH (e.g. /wealthflow) serves the whole app under a folder of an existing domain.
const BASE_PATH = (process.env.BASE_PATH || '').trim().replace(/\/+$/, '').replace(/^(?=[^/])/, '/');
const root = express();
root.use(BASE_PATH || '/', app);
app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/rates', rateRoutes);
app.use('/api/partner', partnerRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/settings', settingsRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 400).json({ error: err.message || 'Something went wrong' });
});

// Serve the built React app in production.
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 5000;
root.listen(PORT, () => console.log(`Wealthflow listening on http://localhost:${PORT}${BASE_PATH || ''}`));
