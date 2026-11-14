import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, repoRoot, isAIEnabled, isGoogleEnabled } from './config.ts';
import { getDb, closeDb } from './db/index.ts';
import { requireAuth } from './auth.ts';
import { records } from './routes/records.ts';
import { calls } from './routes/calls.ts';
import { appointments, publicAppointments } from './routes/appointments.ts';
import { auth, api, googleCallback } from './routes/api.ts';
import { ai, inbox, publicApi } from './routes/ai.ts';
import { sarahPublic, sarahAuth } from './routes/sarahDialer.ts';
import { subscribe } from './realtime.ts';
import {
  handleSarahVoiceSession,
  handleSarahHttpTurn,
  executeSarahTool,
  synthesizeSarahNeuralAudio,
  getPreCachedSarahAudio,
  buildBusinessHoursGreeting,
  buildAfterHoursGreeting,
  getSarahDirectLiveSessionConfig,
  checkLiveTransferCallStatus,
  checkReceptionistWorkHours,
} from './services/sarahVoiceService.ts';
import {
  handleGvHeartbeat,
  getGvWatchdogStatus,
  queueGvCommand,
  launchGoogleVoiceChromeWindow,
  startGoogleVoiceWatchdog,
  saveCloudGvCookies,
  loadCloudGvCookies,
  verifyBridgeToken,
} from './services/googleVoiceWatchdog.ts';

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  const healthPayload = () => ({
    ok: true,
    status: 'ok',
    platform: 'google_cloud',
    ai: isAIEnabled() ? 'gemini' : 'demo',
    google: isGoogleEnabled(),
    line: '+14803319455',
    host: config.telephony.publicHostFqdn,
  });
  app.get('/health', (_req, res) => res.status(200).json(healthPayload()));
  app.get('/api/health', (_req, res) => res.status(200).json(healthPayload()));

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
  app.get('/api/sarah/audio.wav', async (req, res) => {
    try {
      const preset = String(req.query?.preset || '').trim();
      if (preset === 'business_greeting' || preset === 'after_hours') {
        const fast = getPreCachedSarahAudio(preset);
        if (fast?.audio_base64) {
          const wavBuf = Buffer.from(fast.audio_base64, 'base64');
          res.setHeader('Content-Type', 'audio/wav');
          res.setHeader('Content-Length', String(wavBuf.length));
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.status(200).send(wavBuf);
        }
      }
      const wh = checkReceptionistWorkHours();
      const text =
        String(req.query?.text || '').trim() ||
        (wh.isOpen ? buildBusinessHoursGreeting() : buildAfterHoursGreeting());
      const tts = await synthesizeSarahNeuralAudio(text);
      if (tts?.audio_base64) {
        const wavBuf = Buffer.from(tts.audio_base64, 'base64');
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', String(wavBuf.length));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(wavBuf);
      }
      res.status(404).send('Audio not available');
    } catch (err: any) {
      res.status(500).send(err?.message || 'Audio error');
    }
  });
  app.post('/api/sarah/transfer/verify', async (req, res) => {
    try {
      const {
        call_id,
        sarah_call_id,
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

      const activeCallId = call_id || sarah_call_id;
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
          prospect_phone: prospect_phone || '',
          state: state || 'AZ',
          reason: 'Automatic Transline Connection, Private Whisper Receipt, and Both-Parties-on-Line Verification',
          force_live_connect,
        },
        {
          mode: mode === 'outbound' ? 'outbound' : 'inbound',
          lead_id,
          prospect_name: prospect_name || 'Valued Client',
          prospect_phone: prospect_phone || '',
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
  app.post('/api/sarah/gv-heartbeat', async (req, res) => {
    try {
      res.json(await handleGvHeartbeat(req.body || {}));
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Heartbeat failed' });
    }
  });
  app.get('/api/sarah/gv-status', async (_req, res) => {
    try {
      res.json(await getGvWatchdogStatus());
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Status check failed' });
    }
  });
  app.post('/api/sarah/gv-command', async (req, res) => {
    try {
      if (req.body?.launchChrome) {
        const launched = launchGoogleVoiceChromeWindow('manual_api_command');
        return res.json({ ok: true, launched, status: await getGvWatchdogStatus() });
      }
      res.json(await queueGvCommand(req.body || {}));
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Command queue failed' });
    }
  });
  app.post('/api/sarah/gv-session-sync', async (req, res) => {
    const token = String(req.headers['x-iwg-bridge-token'] || req.body?.bridgeToken || '');
    if (!verifyBridgeToken(token)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized bridge token' });
    }
    try {
      const saved = await saveCloudGvCookies(req.body?.cookies || [], req.body?.source || 'extension');
      res.json(saved);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Failed to sync cloud session' });
    }
  });
  app.get('/api/sarah/gv-session-sync', async (req, res) => {
    const token = String(req.headers['x-iwg-bridge-token'] || req.query?.bridgeToken || '');
    if (!verifyBridgeToken(token)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized bridge token' });
    }
    try {
      const loaded = await loadCloudGvCookies();
      res.json({ ok: true, ...loaded });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to load cloud session' });
    }
  });

  // Public: website chat widget, SOA e-sign, appointment web confirmation, OAuth callback, Inbound Receptionist & Webhook
  app.use('/api/public', publicApi);
  app.use('/api/public', publicAppointments);
  app.use('/api/google', googleCallback);
  app.use('/api/sarah', sarahPublic);
  app.use('/api/voice', sarahPublic);
  const widgetDir = path.join(repoRoot, 'server', 'public');
  if (existsSync(widgetDir)) {
    app.use('/widget', express.static(widgetDir, { maxAge: '1h' }));
  }

  // Authenticated API
  app.use('/api/auth', auth);
  app.use('/api', requireAuth);
  app.get('/api/stream', (req, res) => subscribe(res, [`user:${req.user!.id}`, 'inbox']));
  app.use('/api/records', records);
  app.use('/api/calls', calls);
  app.use('/api/appointments', appointments);
  app.use('/api/ai', ai);
  app.use('/api/inbox', inbox);
  app.use('/api/sarah', sarahAuth);
  app.use('/api', api);

  // Serve the built 100% online web app on Google Cloud (https://iwillglobal.com & https://voice.iwillglobal.com)
  const dist = path.join(repoRoot, 'client', 'dist');
  const clientPublic = path.join(repoRoot, 'client', 'public');
  app.use(
    express.static(dist, {
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  if (existsSync(clientPublic)) {
    app.use(
      express.static(clientPublic, {
        acceptRanges: true,
        maxAge: '7d',
      })
    );
  }
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    const indexHtml = path.join(dist, 'index.html');
    if (!existsSync(indexHtml)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root: dist });
  });

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
        force_work_hours: sp.has('force_work_hours') ? sp.get('force_work_hours') === 'true' : undefined,
        force_live_connect: sp.has('force_live_connect') ? sp.get('force_live_connect') === 'true' : undefined,
        simulated_now_iso: sp.get('simulated_now_iso') || undefined,
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
      } else {
        socket.destroy();
      }
    } catch (err) {
      console.error('[Sarah Voice AI] WebSocket upgrade error:', err);
      socket.destroy();
    }
  });

  return wss;
}

const entryFile = path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
const argvFile = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase() : '';
const pm2ExecFile = process.env.pm_exec_path ? path.resolve(process.env.pm_exec_path).toLowerCase() : '';
const isMain =
  process.env.NODE_ENV !== 'test' &&
  (entryFile === argvFile ||
    entryFile === pm2ExecFile ||
    argvFile.includes('processcontainer'));
if (isMain) {
  const app = createApp();
  const server = http.createServer(app);
  attachSarahWebSocket(server);

  // Bind 0.0.0.0:$PORT immediately (<50ms) on Google Cloud so 1st-ring calls & health checks never wait on DB warmup
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`\n  IWG Google Cloud API   →  http://0.0.0.0:${config.port}`);
    console.log(`  Health Check           →  http://0.0.0.0:${config.port}/health`);
    console.log(`  Sarah Voice Turn API   →  http://0.0.0.0:${config.port}/api/sarah/turn`);
    console.log(`  Sarah Live WebSocket   →  ws://0.0.0.0:${config.port}/api/sarah/live (${config.gemini.liveModel} Vindemiatrix)`);
    console.log(`  AI: ${isAIEnabled() ? 'Gemini (' + config.gemini.liveModel + ')' : 'demo mode (set GOOGLE_GENAI_API_KEY)'}`);
    console.log(`  Google Workspace: ${isGoogleEnabled() ? 'configured' : 'not configured (Gmail actions are logged only)'}\n`);

    setTimeout(() => {
      void (async () => {
        try {
          await getDb();
        } catch (err: any) {
          console.error('[DB Warmup] Non-fatal startup error:', err?.message || err);
        }
      })();
    }, 1500);

    if (!config.telephony.cloudHeadlessOnly) {
      startGoogleVoiceWatchdog();
    }
    void import('./services/sarahDialer.ts')
      .then(({ runSarahAutoDialerTick }) => {
        setInterval(() => {
          runSarahAutoDialerTick({ reason: 'interval' }).catch((err) =>
            console.error('Sarah auto-dialer error:', err?.message)
          );
        }, 60_000);
      })
      .catch(() => {});

    void import('./services/cloudBackup.ts')
      .then(({ startAutomatedCloudBackupScheduler }) => {
        startAutomatedCloudBackupScheduler();
      })
      .catch(() => {});
  });

  const gracefulShutdown = (sig: string) => {
    console.log(`[IWG Google Cloud API] ${sig} received — closing HTTP server and DB cleanly...`);
    server.close(() => {
      closeDb()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 3500).unref();
  };
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
}

export default createApp(); 
