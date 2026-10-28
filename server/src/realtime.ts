import type { Response } from 'express';

/** Minimal Server-Sent Events hub for live chat + notifications (works through proxies and in Capacitor). */
type Client = { res: Response; channels: Set<string> };
const clients = new Set<Client>();

export function subscribe(res: Response, channels: string[]) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: ready\ndata: {}\n\n`);
  const c: Client = { res, channels: new Set(channels) };
  clients.add(c);
  const ping = setInterval(() => res.write(`: ping\n\n`), 25000);
  res.on('close', () => { clearInterval(ping); clients.delete(c); });
}

export function publish(channel: string, event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (c.channels.has(channel)) c.res.write(payload);
}
