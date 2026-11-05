import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, isAIEnabled, isGoogleEnabled } from './config.ts';
import { getDb } from './db/index.ts';
import { requireAuth } from './auth.ts';
import { records } from './routes/records.ts';
import { calls } from './routes/calls.ts';
import { appointments, publicAppointments } from './routes/appointments.ts';
import { auth, api, googleCallback } from './routes/api.ts';
import { ai, inbox, publicApi } from './routes/ai.ts';
import { blandPublic, blandAuth } from './routes/bland.ts';
import { subscribe } from './realtime.ts';

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, ai: isAIEnabled() ? 'gemini' : 'demo', google: isGoogleEnabled() }));

  // Public: website chat widget, SOA e-sign, appointment web confirmation, OAuth callback, Bland AI webhook
  app.use('/api/public', publicApi);
  app.use('/api/public', publicAppointments);
  app.use('/api/google', googleCallback);
  app.use('/api/bland', blandPublic);
  app.use('/widget', express.static(fileURLToPath(new URL('../public', import.meta.url))));

  // Authenticated API
  app.use('/api/auth', auth);
  app.use('/api', requireAuth);
  app.get('/api/stream', (req, res) => subscribe(res, [`user:${req.user!.id}`, 'inbox']));
  app.use('/api/records', records);
  app.use('/api/calls', calls);
  app.use('/api/appointments', appointments);
  app.use('/api/ai', ai);
  app.use('/api/inbox', inbox);
  app.use('/api/bland', blandAuth);
  app.use('/api', api);

  // Serve the built web app (production / Cloud Run single container / iwillglobal.com)
  const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => (req.path.startsWith('/api') ? next() : res.sendFile('index.html', { root: dist })));
  }

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error' });
  });
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
if (isMain) {
  await getDb();
  const { ensureSeeded } = await import('./db/seed.ts');
  await ensureSeeded();
  createApp().listen(config.port, () => {
    console.log(`\n  IWG CRM API  →  http://localhost:${config.port}`);
    console.log(`  AI: ${isAIEnabled() ? 'Gemini (' + config.gemini.model + ')' : 'demo mode (set GEMINI_API_KEY)'}`);
    console.log(`  Google Workspace: ${isGoogleEnabled() ? 'configured' : 'not configured (Gmail actions are logged only)'}\n`);
  });
}
// Long-lived server (local / Cloud Run): run the Bland AI autonomous dialer every 60 seconds.
// It only dials Bland-assigned prospects while the campaign is active and inside calling hours
// (Mon–Fri 9 AM–7 PM, Sat–Sun 9 AM–6 PM Arizona time). Serverless deployments use the call-completion
// webhook chain plus Vercel Cron every 15 minutes — no CRM login is ever required.
if (isMain) {
  const { runBlandAutoDialerTick } = await import('./services/bland.ts');
  setInterval(() => {
    runBlandAutoDialerTick({ reason: 'interval' }).catch((err) => console.error('Bland auto-dialer error:', err?.message));
  }, 60_000);
}

export default createApp(); 
