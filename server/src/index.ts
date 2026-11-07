import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { WebSocketServer } from 'ws';
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
import {
  handleSarahVoiceSession,
  handleSarahHttpTurn,
  executeSarahTool,
  synthesizeSarahNeuralAudio,
  getSarahDirectLiveSessionConfig,
  checkLiveTransferCallStatus,
  checkReceptionistWorkHours,
} from './services/sarahVoiceService.ts';

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, ai: isAIEnabled() ? 'gemini' : 'demo', google: isGoogleEnabled() }));

  // Direct sub-second Gemini 3.8 Live WebSocket session bootstrap for iwillglobal.com & local CRM
  app.post('/api/sarah/live-session', (req, res) => {
    try {
      const cfg = getSarahDirectLiveSessionConfig(req.body || {});
      res.json(cfg);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to create live session config' });
    }
  });

  // Public Sarah Voice AI HTTP endpoints for Vercel Serverless (iwillglobal.com) & Browser Voice fallback
  app.post('/api/sarah/turn', async (req, res) => {
    try {
      const result = await handleSarahHttpTurn(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Sarah voice turn failed' });
    }
  });
  app.post('/api/sarah/tool', async (req, res) => {
    try {
      const { name, args, context } = req.body || {};
      const result = await executeSarahTool(name || '', args || {}, context || { mode: 'inbound' });
      res.json({ ok: true, result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Sarah tool execution failed' });
    }
  });
  app.post('/api/sarah/tts', async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      const tts = await synthesizeSarahNeuralAudio(text);
      res.json({ ok: true, ...tts });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Sarah TTS failed' });
    }
  });
  app.post('/api/sarah/transfer/verify', async (req, res) => {
    try {
      const {
        call_id,
        bland_call_id,
        recipient_name,
        recipient_phone,
        prospect_name,
        prospect_phone,
        state,
        lead_id,
        mode,
        force_work_hours,
        simulated_now_iso,
        force_live_connect,
      } = req.body || {};

      const activeCallId = call_id || bland_call_id;
      if (activeCallId) {
        const liveStatus = await checkLiveTransferCallStatus({
          call_id: String(activeCallId),
          recipient_name: recipient_name || 'King Amen Ra',
          recipient_phone: recipient_phone || '+16024569681',
          prospect_name: prospect_name || 'Valued Client',
          state: state || 'AZ',
        });
        return res.json({ ok: true, live_status: liveStatus, transfer: liveStatus });
      }

      const result = await executeSarahTool(
        'whisper_warm_transfer',
        {
          recipient_name: recipient_name || 'King Amen Ra',
          prospect_name: prospect_name || 'Valued Client',
          prospect_phone: prospect_phone || '+16232230165',
          state: state || 'AZ',
          reason: 'Automatic Transline Connection, Private Whisper Receipt, and Both-Parties-on-Line Verification',
          force_live_connect,
        },
        {
          mode: mode === 'outbound' ? 'outbound' : 'inbound',
          lead_id,
          prospect_name: prospect_name || 'Valued Client',
          prospect_phone: prospect_phone || '+16232230165',
          state: state || 'AZ',
          force_work_hours,
          simulated_now_iso,
          force_live_connect,
        }
      );
      res.json({ ok: true, transfer: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Transfer verification failed' });
    }
  });
  app.get('/api/sarah/transfer/status/:callId', async (req, res) => {
    try {
      const status = await checkLiveTransferCallStatus({
        call_id: req.params.callId,
        recipient_name: String(req.query?.recipient_name || 'King Amen Ra'),
        recipient_phone: String(req.query?.recipient_phone || '+16024569681'),
        prospect_name: String(req.query?.prospect_name || 'Valued Client'),
        state: String(req.query?.state || 'AZ'),
      });
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Transfer status check failed' });
    }
  });
  app.get('/api/sarah/work-hours', (req, res) => {
    const wh = checkReceptionistWorkHours({
      simulated_now_iso: req.query?.now ? String(req.query.now) : undefined,
      force_work_hours:
        req.query?.force === 'true' ? true : req.query?.force === 'false' ? false : undefined,
    });
    res.json({ ok: true, ...wh });
  });

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

export function attachSarahWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    let initialCtx: any = { mode: 'inbound' };
    try {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const sp = url.searchParams;
      initialCtx = {
        mode: sp.get('mode') === 'outbound' ? 'outbound' : 'inbound',
        lead_id: sp.get('lead_id') || undefined,
        prospect_name: sp.get('prospect_name') || undefined,
        prospect_phone: sp.get('phone') || undefined,
        state: sp.get('state') || undefined,
        address: sp.get('address') || undefined,
        caller_name: sp.get('caller_name') || undefined,
        on_warm_transfer: sp.has('on_warm_transfer') ? sp.get('on_warm_transfer') === 'true' : undefined,
      };
    } catch {
      // default to inbound
    }
    console.log(`[Sarah Voice AI] Incoming (${initialCtx.mode}) connection on (480) 331-9455 from ${clientIp}`);
    handleSarahVoiceSession(ws, initialCtx);
  });

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/api/sarah/live') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      }
    } catch (err) {
      console.error('[Sarah Voice AI] WebSocket upgrade error:', err);
      socket.destroy();
    }
  });

  return wss;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
if (isMain) {
  await getDb();
  const { ensureSeeded } = await import('./db/seed.ts');
  await ensureSeeded();
  const app = createApp();
  const server = http.createServer(app);
  attachSarahWebSocket(server);
  server.listen(config.port, () => {
    console.log(`\n  IWG CRM API  →  http://localhost:${config.port}`);
    console.log(`  Sarah Voice AI  →  ws://localhost:${config.port}/api/sarah/live (Gemini Live 3.8 Aoede)`);
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
