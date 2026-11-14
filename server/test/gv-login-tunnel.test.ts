import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createApp, attachSarahWebSocket } from '../src/index.ts';
import { repoRoot } from '../src/config.ts';

describe('One-Time Google Voice VM noVNC HTTPS Tunnel (/gv-login/:token)', () => {
  const tokenFile = path.join(repoRoot, 'server', 'data', 'gv-login-token.txt');
  const testToken = 'a1b2c3d4e5f60718293a4b5c';

  let mockVncServer: http.Server;
  let mockVncWss: WebSocketServer;
  let mockVncPort = 0;

  let appServer: http.Server;
  let appPort = 0;

  before(async () => {
    process.env.NODE_ENV = 'test';
    mkdirSync(path.dirname(tokenFile), { recursive: true });
    rmSync(tokenFile, { force: true });

    mockVncWss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
    });
    mockVncWss.on('connection', (ws, req) => {
      ws.send(JSON.stringify({ connectedPath: req.url, host: req.headers.host, origin: req.headers.origin }));
      ws.on('message', (msg) => {
        ws.send(Buffer.concat([Buffer.from('RFB:'), Buffer.isBuffer(msg) ? msg : Buffer.from(String(msg))]));
      });
    });

    mockVncServer = http.createServer((req, res) => {
      if (req.url?.startsWith('/vnc.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><title>noVNC</title>');
        return;
      }
      if (req.url === '/app/ui.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('export const ui = true;');
        return;
      }
      res.writeHead(404).end('not found');
    });

    mockVncServer.on('upgrade', (req, socket, head) => {
      mockVncWss.handleUpgrade(req, socket, head, (ws) => {
        mockVncWss.emit('connection', ws, req);
      });
    });

    await new Promise<void>((resolve) => mockVncServer.listen(0, '127.0.0.1', () => resolve()));
    mockVncPort = (mockVncServer.address() as { port: number }).port;
    process.env.GV_VNC_PORT = String(mockVncPort);

    const app = createApp();
    appServer = http.createServer(app);
    attachSarahWebSocket(appServer);
    await new Promise<void>((resolve) => appServer.listen(0, '127.0.0.1', () => resolve()));
    appPort = (appServer.address() as { port: number }).port;
  });

  after(async () => {
    rmSync(tokenFile, { force: true });
    delete process.env.GV_VNC_PORT;
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => mockVncServer.close(() => resolve()));
  });

  it('returns 404 when no active login token file exists', async () => {
    rmSync(tokenFile, { force: true });
    const res = await fetch(`http://127.0.0.1:${appPort}/gv-login/${testToken}/vnc.html`);
    assert.equal(res.status, 404);
  });

  it('redirects bare /gv-login/:token to noVNC with autoconnect & scaled path when token is active', async () => {
    writeFileSync(tokenFile, testToken, 'utf8');
    const res = await fetch(`http://127.0.0.1:${appPort}/gv-login/${testToken}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const loc = res.headers.get('location') || '';
    assert.match(loc, new RegExp(`^/gv-login/${testToken}/vnc\\.html\\?autoconnect=true`));
    assert.match(loc, /path=gv-login%2Fa1b2c3d4e5f60718293a4b5c%2Fwebsockify/);
  });

  it('rejects wrong tokens with 404 even while a session is active', async () => {
    writeFileSync(tokenFile, testToken, 'utf8');
    const res = await fetch(`http://127.0.0.1:${appPort}/gv-login/000000000000000000000000/vnc.html`);
    assert.equal(res.status, 404);
  });

  it('proxies vnc.html and relative ES module assets cleanly', async () => {
    writeFileSync(tokenFile, testToken, 'utf8');
    const htmlRes = await fetch(`http://127.0.0.1:${appPort}/gv-login/${testToken}/vnc.html?autoconnect=true`);
    assert.equal(htmlRes.status, 200);
    assert.match(await htmlRes.text(), /<title>noVNC<\/title>/);

    const jsRes = await fetch(`http://127.0.0.1:${appPort}/gv-login/${testToken}/app/ui.js`);
    assert.equal(jsRes.status, 200);
    assert.match(await jsRes.text(), /export const ui = true/);
  });

  it('tunnels binary RFB WebSocket upgrades and normalizes Host + Origin headers', async () => {
    writeFileSync(tokenFile, testToken, 'utf8');
    const ws = new WebSocket(`ws://127.0.0.1:${appPort}/gv-login/${testToken}/websockify`, ['binary'], {
      headers: { Origin: 'https://voice.iwillglobal.com' },
    });

    const messages: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('error', reject);
      ws.on('open', () => {
        assert.equal(ws.protocol, 'binary');
      });
      ws.on('message', (data) => {
        messages.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
        if (messages.length === 1) {
          ws.send(Buffer.from('HELLO_VNC'));
        } else if (messages.length === 2) {
          ws.close();
          resolve();
        }
      });
    });

    const handshakeMeta = JSON.parse(messages[0].toString('utf8'));
    assert.equal(handshakeMeta.connectedPath, '/websockify');
    assert.equal(handshakeMeta.host, `127.0.0.1:${mockVncPort}`);
    assert.equal(handshakeMeta.origin, `http://127.0.0.1:${mockVncPort}`);
    assert.equal(messages[1].toString('utf8'), 'RFB:HELLO_VNC');
  });
});
