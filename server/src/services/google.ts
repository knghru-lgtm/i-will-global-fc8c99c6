import { config, isGoogleEnabled } from '../config.ts';
import { one, q, insert, update } from '../db/index.ts';

/**
 * Google Workspace integration (Gmail + Calendar) via OAuth 2.0 and REST — no heavy SDK.
 * Configure the OAuth consent screen as "Internal" for the iwillglobal.com Workspace to avoid app verification.
 */
const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

const redirectUri = () => `${config.apiUrl}/api/google/callback`;

export function authUrl(state: string) {
  const p = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: redirectUri(), response_type: 'code', access_type: 'offline', prompt: 'consent',
    scope: SCOPES.join(' '), state, hd: config.google.allowedDomain, include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
  });
  if (!r.ok) throw new Error(`Google token exchange failed: ${await r.text()}`);
  const tokens: any = await r.json();
  tokens.expires_at = Date.now() + (tokens.expires_in - 60) * 1000;
  const info: any = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json();
  return { tokens, email: info.email as string };
}

async function accessToken(userId: string): Promise<string | null> {
  if (!isGoogleEnabled()) return null;
  const u = await one(`SELECT google_tokens FROM users WHERE id=$1`, [userId]);
  const t = u?.google_tokens;
  if (!t) return null;
  if (t.expires_at > Date.now()) return t.access_token;
  if (!t.refresh_token) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }),
  });
  if (!r.ok) return null;
  const n: any = await r.json();
  const merged = { ...t, access_token: n.access_token, expires_at: Date.now() + (n.expires_in - 60) * 1000 };
  await update('users', userId, { google_tokens: merged });
  return merged.access_token;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Send email through the agent's Gmail with full anti-spam headers and CAN-SPAM compliance. */
export async function sendGmail(
  userId: string,
  msg: { to: string; subject: string; body: string; threadId?: string; fromName?: string; htmlBody?: string }
) {
  const token = await accessToken(userId);
  if (!token) return null;

  // Retrieve sender profile for clean From & Reply-To headers
  const user = await one(`SELECT name, email, google_email FROM users WHERE id=$1`, [userId]);
  const senderEmail = user?.google_email || user?.email || 'king@iwillglobal.com';
  const senderName = msg.fromName || user?.name || 'King Amen Ra';
  const senderDomain = senderEmail.includes('@') ? senderEmail.split('@')[1] : 'iwillglobal.com';

  const { formatCompliantEmailBody } = await import('./deliverability.ts');
  const plainBody = formatCompliantEmailBody(msg.body, { recipientEmail: msg.to, senderName });
  const htmlContent = msg.htmlBody || `<div style="font-family: Arial, sans-serif; font-size: 15px; color: #1e293b; line-height: 1.6;">${plainBody.replace(/\r\n/g, '<br/>').replace(/\n/g, '<br/>')}</div>`;

  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const messageId = `<iwg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@${senderDomain}>`;
  const unsubUrl = `${config.appUrl}/api/public/unsubscribe?email=${encodeURIComponent(msg.to)}`;

  const mime = [
    `From: =?UTF-8?B?${Buffer.from(senderName).toString('base64')}?= <${senderEmail}>`,
    `Reply-To: =?UTF-8?B?${Buffer.from(senderName).toString('base64')}?= <${senderEmail}>`,
    `To: ${msg.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(msg.subject).toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `List-Unsubscribe: <${unsubUrl}>, <mailto:unsubscribe@${senderDomain}?subject=unsubscribe>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    'X-Mailer: IWG CRM Deliverability Engine v2.0 (iwillglobal.com)',
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    plainBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlContent,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(mime), threadId: msg.threadId }),
  });

  if (!r.ok) throw new Error(`Gmail send failed: ${await r.text()}`);
  const j: any = await r.json();
  return { id: j.id as string, threadId: j.threadId as string, messageId };
}

/** Pull recent Gmail messages and attach them to matching leads/clients by email address. */
export async function syncGmail(userId: string, days = 7) {
  const token = await accessToken(userId);
  if (!token) return { connected: false, imported: 0 };
  const list: any = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(`newer_than:${days}d -category:promotions`)}&maxResults=50`, { headers: { Authorization: `Bearer ${token}` } })).json();
  let imported = 0;
  for (const m of list.messages || []) {
    const exists = await one(`SELECT id FROM activities WHERE meta->>'gmail_id' = $1`, [m.id]);
    if (exists) continue;
    const full: any = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const h = Object.fromEntries((full.payload?.headers || []).map((x: any) => [x.name.toLowerCase(), x.value]));
    const emails = `${h.from || ''} ${h.to || ''}`.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
    const me = (await one(`SELECT google_email, email FROM users WHERE id=$1`, [userId])) || {};
    const others = emails.map((e) => e.toLowerCase()).filter((e) => e !== String(me.google_email).toLowerCase() && e !== String(me.email).toLowerCase());
    if (!others.length) continue;
    const match = await one(`SELECT id, 'lead' AS type FROM leads WHERE lower(email) = ANY($1) LIMIT 1`, [others])
      || await one(`SELECT id, 'client' AS type FROM clients WHERE lower(email) = ANY($1) LIMIT 1`, [others]);
    if (!match) continue;
    const inbound = !String(h.from || '').toLowerCase().includes(String(me.google_email || me.email).toLowerCase());
    await insert('activities', {
      type: 'email', subject: h.subject || '(no subject)', body: full.snippet, related_type: match.type, related_id: match.id, user_id: userId,
      direction: inbound ? 'inbound' : 'outbound', completed: true, provider: 'gmail', status: inbound ? 'Received' : 'Sent',
      meta: { gmail_id: m.id, thread_id: full.threadId, from: h.from, to: h.to }, created_at: h.date ? new Date(h.date) : new Date(),
    });
    imported++;
  }
  return { connected: true, imported };
}

export const MASTER_CALENDAR_EMAIL = 'info@iwillglobal.com';

/** Generate direct 1-click Google Calendar add URL pre-filled with info@iwillglobal.com */
export function generateGoogleCalendarUrl(ev: {
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  addEmail?: string;
}) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatUtc = (d: Date) =>
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.summary,
    dates: `${formatUtc(ev.start)}/${formatUtc(ev.end)}`,
    details: ev.description || '',
    location: ev.location || '',
    add: ev.addEmail || MASTER_CALENDAR_EMAIL,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function createCalendarEvent(
  userId: string,
  ev: {
    summary: string;
    description?: string;
    location?: string;
    start: Date;
    end: Date;
    attendeeEmail?: string | null;
    attendees?: Array<{ email: string; displayName?: string }>;
  }
) {
  const attendees: Array<{ email: string; displayName?: string }> = [...(ev.attendees || [])];
  if (!attendees.some((a) => a.email.toLowerCase() === MASTER_CALENDAR_EMAIL)) {
    attendees.push({ email: MASTER_CALENDAR_EMAIL, displayName: 'I Will Global Master Agency Calendar' });
  }
  if (ev.attendeeEmail && !attendees.some((a) => a.email.toLowerCase() === ev.attendeeEmail?.toLowerCase())) {
    attendees.push({ email: ev.attendeeEmail });
  }

  let success = false;

  // 1. Try with the assigned agent's token
  const token = await accessToken(userId);
  if (token) {
    try {
      const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: ev.summary,
          description: ev.description,
          location: ev.location,
          start: { dateTime: ev.start.toISOString(), timeZone: config.agency.timezone },
          end: { dateTime: ev.end.toISOString(), timeZone: config.agency.timezone },
          attendees,
        }),
      });
      if (r.ok) success = true;
    } catch {
      /* continue */
    }
  }

  // 2. Also try with info@iwillglobal.com user's token directly if connected
  const masterUser = await one(`SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [MASTER_CALENDAR_EMAIL]);
  if (masterUser && masterUser.id !== userId) {
    const masterToken = await accessToken(masterUser.id);
    if (masterToken) {
      try {
        const r2 = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
          method: 'POST',
          headers: { Authorization: `Bearer ${masterToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: ev.summary,
            description: ev.description,
            location: ev.location,
            start: { dateTime: ev.start.toISOString(), timeZone: config.agency.timezone },
            end: { dateTime: ev.end.toISOString(), timeZone: config.agency.timezone },
            attendees,
          }),
        });
        if (r2.ok) success = true;
      } catch {
        /* continue */
      }
    }
  }

  return success;
}

export async function googleStatus(userId: string) {
  const u = await one(`SELECT google_email, google_tokens IS NOT NULL AS connected FROM users WHERE id=$1`, [userId]);
  return { enabled: isGoogleEnabled(), connected: Boolean(u?.connected), email: u?.google_email || null, domain: config.google.allowedDomain };
}

export async function disconnectGoogle(userId: string) {
  await q(`UPDATE users SET google_tokens = NULL, google_email = NULL WHERE id=$1`, [userId]);
}
