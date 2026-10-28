import { Router } from 'express';
import { q, one, insert, update } from '../db/index.ts';
import { copilot, summarizeCall, draftEmail, complianceCheck, recordInsight, aiMode } from '../services/ai/index.ts';
import { handleVisitorMessage, addMessage, summarizeConversation, WELCOME } from '../services/ai/assistant.ts';
import { subscribe, publish } from '../realtime.ts';
import { scoreLead } from '../services/scoring.ts';
import { isManager } from '../auth.ts';

// ================================================================== Agent-facing AI
export const ai = Router();

ai.post('/copilot', async (req, res) => {
  const history = (req.body.messages || []).slice(-12);
  if (!history.length) return res.status(400).json({ error: 'messages required' });
  res.json(await copilot(req.user!, history));
});

ai.post('/summarize-call', async (req, res) => {
  res.json(await summarizeCall(String(req.body.notes || ''), String(req.body.disposition || ''), req.user!.role));
});

ai.post('/draft-email', async (req, res) => {
  res.json(await draftEmail({ name: req.body.name || 'there', purpose: req.body.purpose || 'follow up', context: req.body.context, tone: req.body.tone, agentName: req.user!.name }));
});

ai.post('/compliance-check', async (req, res) => {
  const { text, related_id, tpmo_given } = req.body;
  const soa = related_id ? await one(`SELECT id FROM soas WHERE (lead_id=$1 OR client_id=$1) AND status='Signed' LIMIT 1`, [related_id]) : null;
  res.json(await complianceCheck(String(text || ''), { role: req.user!.role, soaOnFile: Boolean(soa), tpmoGiven: tpmo_given }));
});

ai.post('/insight/:type/:id', async (req, res) => {
  const table = req.params.type === 'client' ? 'clients' : req.params.type === 'opportunity' ? 'opportunities' : 'leads';
  const record = await one(`SELECT * FROM ${table} WHERE id=$1`, [req.params.id]);
  if (!record) return res.status(404).json({ error: 'Not found' });
  const activities = await q(`SELECT * FROM activities WHERE related_id=$1 ORDER BY created_at DESC LIMIT 10`, [req.params.id]);
  const soas = await q(`SELECT * FROM soas WHERE lead_id=$1 OR client_id=$1`, [req.params.id]);
  res.json(await recordInsight(req.params.type, record, { activities, soas }));
});

/** AI Avatar Needs Analysis & Medicare Plan Comparison Engine */
ai.post('/avatar/analysis', async (req, res) => {
  const { runAvatarNeedsAnalysis } = await import('../services/ai/avatarNeedsEngine.ts');
  const result = await runAvatarNeedsAnalysis({
    beneficiaryName: req.body.beneficiaryName || 'Beneficiary',
    phone: req.body.phone,
    email: req.body.email,
    zipCode: req.body.zipCode || '85251',
    state: req.body.state || 'AZ',
    hasMedicare: req.body.hasMedicare !== false,
    hasMedicaid: Boolean(req.body.hasMedicaid),
    doctors: req.body.doctors || [],
    prescriptions: req.body.prescriptions || [],
    needsTransportation: Boolean(req.body.needsTransportation),
    supplementalPriorities: req.body.supplementalPriorities || ['dental', 'groceries', 'transportation'],
  });
  res.json(result);
});

/** Direct enrollment submission under Principal Agent NPN (19842011) via iwillglobal.com quotes */
ai.post('/avatar/enroll', async (req, res) => {
  const { beneficiaryName, planId, carrier, planName, zipCode, phone, email } = req.body;
  const nameParts = (beneficiaryName || 'Client Prospect').trim().split(' ');
  const firstName = nameParts[0] || 'Client';
  const lastName = nameParts.slice(1).join(' ') || 'Beneficiary';

  // 1. Create/Convert Client Record
  let client = await one(`SELECT * FROM clients WHERE phone=$1 OR email=$2 LIMIT 1`, [phone || '', email || '']);
  if (!client) {
    client = await insert('clients', {
      first_name: firstName,
      last_name: lastName,
      phone: phone || '(480) 331-9455',
      email: email || `${firstName.toLowerCase()}@example.com`,
      city: 'Scottsdale',
      state: 'AZ',
      zip: zipCode || '85251',
      status: 'Active Client',
      source: 'AI Licensed Agent Avatar (iwillglobal.com)',
      owner_id: 'u_admin',
    });
  }

  // 2. Insert Pending Policy under Principal Agent (NPN 19842011)
  const pol = await insert('policies', {
    client_id: client.id,
    agent_id: 'u_admin',
    status: 'Submitted / Pending Carrier Confirmation',
    submitted_at: new Date(),
    carrier: carrier || 'Humana',
    plan_name: planName || 'Medicare Advantage Plan',
    plan_type: 'MAPD',
    premium: 0,
    policy_number: `IWG-${Math.floor(100000 + Math.random() * 900000)}`,
  });

  // 3. Log Activity Timeline
  await insert('activities', {
    type: 'system',
    subject: `🏆 Policy Submitted via AI Licensed Agent Avatar for ${firstName} ${lastName}`,
    body: `Enrolled into ${carrier} ${planName} via iwillglobal.com/quotes under Licensed Agent NPN 19842011.\nPolicy Number: ${pol.policy_number}`,
    related_type: 'client',
    related_id: client.id,
    user_id: 'u_admin',
    completed: true,
  });

  res.json({
    success: true,
    client,
    policy: pol,
    quoteUrl: `https://iwillglobal.com/quotes?agent=19842011&zip=${encodeURIComponent(zipCode || '85251')}&plan=${encodeURIComponent(planId || 'humana')}&enrolled=true`,
    message: `Enrollment submitted successfully under Licensed Agent NPN 19842011!`,
  });
});

/** Re-score all leads visible to the user (managers: everyone). */
ai.post('/rescore-leads', async (req, res) => {
  const rows = isManager(req.user) ? await q(`SELECT * FROM leads`) : await q(`SELECT * FROM leads WHERE owner_id=$1 OR assigned_agent_id=$1`, [req.user!.id]);
  for (const l of rows) await update('leads', l.id, scoreLead(l));
  res.json({ rescored: rows.length });
});

/** Duplicate detection (data hygiene): same phone or same name+dob across leads/clients. */
ai.get('/duplicates', async (_req, res) => {
  const dupPhones = await q(
    `SELECT regexp_replace(phone, '\\D', '', 'g') AS key, json_agg(json_build_object('id', id, 'name', first_name || ' ' || last_name, 'type', kind, 'status', status)) AS records
     FROM (SELECT id, first_name, last_name, phone, status, 'lead' AS kind FROM leads UNION ALL SELECT id, first_name, last_name, phone, status, 'client' FROM clients) x
     WHERE phone IS NOT NULL GROUP BY 1 HAVING count(*) > 1 LIMIT 50`);
  res.json({ groups: dupPhones, mode: aiMode() });
});

// ================================================================== Agent inbox (chat takeover)
export const inbox = Router();

inbox.get('/conversations', async (req, res) => {
  const status = String(req.query.status || '');
  const rows = await q(
    `SELECT c.*, u.name AS assigned_name,
       (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
       (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id) AS message_count
     FROM conversations c LEFT JOIN users u ON u.id=c.assigned_user_id
     ${status ? `WHERE c.status = ANY($1)` : ''} ORDER BY (c.status='waiting_agent') DESC, c.updated_at DESC LIMIT 100`,
    status ? [status.split(',')] : []);
  res.json(rows);
});

inbox.get('/conversations/:id', async (req, res) => {
  const conv = await one(`SELECT * FROM conversations WHERE id=$1`, [req.params.id]);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  const messages = await q(`SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id=m.user_id WHERE conversation_id=$1 ORDER BY created_at`, [req.params.id]);
  await update('conversations', conv.id, { unread: 0 });
  res.json({ conversation: conv, messages });
});

inbox.post('/conversations/:id/takeover', async (req, res) => {
  if (req.user!.role === 'scheduler') return res.status(403).json({ error: 'Only licensed agents can take over chats' });
  const conv = await update('conversations', req.params.id, { status: 'agent', assigned_user_id: req.user!.id });
  await addMessage(req.params.id, 'system', `${req.user!.name.split(' ')[0]}, a licensed agent, has joined the chat.`);
  publish(`conv:${req.params.id}`, 'status', { status: 'agent', agent: req.user!.name.split(' ')[0] });
  res.json(conv);
});

inbox.post('/conversations/:id/release', async (req, res) => {
  const conv = await update('conversations', req.params.id, { status: 'ai', assigned_user_id: null });
  await addMessage(req.params.id, 'system', 'The agent has left. Global Assistant (AI) is back to help.');
  publish(`conv:${req.params.id}`, 'status', { status: 'ai' });
  res.json(conv);
});

inbox.post('/conversations/:id/close', async (req, res) => {
  const summary = await summarizeConversation(req.params.id);
  const conv = await update('conversations', req.params.id, { status: 'closed', summary });
  if (conv?.lead_id) await insert('activities', { type: 'chat', subject: 'Chat closed — AI summary', body: summary, related_type: 'lead', related_id: conv.lead_id, user_id: req.user!.id, completed: true, meta: { conversation_id: conv.id } });
  publish(`conv:${req.params.id}`, 'status', { status: 'closed' });
  res.json(conv);
});

inbox.post('/conversations/:id/messages', async (req, res) => {
  const conv = await one(`SELECT * FROM conversations WHERE id=$1`, [req.params.id]);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  if (conv.status !== 'agent') await update('conversations', conv.id, { status: 'agent', assigned_user_id: req.user!.id });
  const msg = await addMessage(conv.id, 'agent', String(req.body.body || '').slice(0, 4000), {}, req.user!.id);
  res.status(201).json({ ...msg, user_name: req.user!.name });
});

inbox.get('/conversations/:id/summary', async (req, res) => res.json({ summary: await summarizeConversation(req.params.id) }));

inbox.get('/stream', (req, res) => subscribe(res, ['inbox']));

// ================================================================== Public (website widget, mobile, SOA)
export const publicApi = Router();

publicApi.post('/chat/start', async (req, res) => {
  const token = crypto.randomUUID();
  const conv = await insert('conversations', { visitor_token: token, channel: req.body?.channel === 'app' ? 'app' : 'web', status: 'ai', intake: {} });
  const welcome = await addMessage(conv.id, 'ai', WELCOME.body, { quick_replies: WELCOME.quick_replies, mode: aiMode() });
  publish('inbox', 'new', { conversation_id: conv.id });
  res.json({ conversation_id: conv.id, token, messages: [welcome] });
});

async function visitorConv(id: string, token: string) {
  const c = await one(`SELECT * FROM conversations WHERE id=$1 AND visitor_token=$2`, [id, token]);
  if (!c) throw Object.assign(new Error('Conversation not found'), { status: 404 });
  return c;
}

publicApi.get('/chat/:id/messages', async (req, res) => {
  const c = await visitorConv(req.params.id, String(req.query.token));
  const msgs = await q(`SELECT id, sender, body, meta, created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at`, [c.id]);
  res.json({ status: c.status, messages: msgs });
});

publicApi.post('/chat/:id/messages', async (req, res) => {
  await visitorConv(req.params.id, String(req.body.token || req.query.token));
  const text = String(req.body.body || '').trim();
  if (!text) return res.status(400).json({ error: 'Empty message' });
  res.json(await handleVisitorMessage(req.params.id, text));
});

publicApi.get('/chat/:id/stream', async (req, res) => {
  await visitorConv(req.params.id, String(req.query.token));
  subscribe(res, [`conv:${req.params.id}`]);
});

publicApi.get('/soa/:token', async (req, res) => {
  const s = await one(`SELECT s.id, s.beneficiary_name, s.products, s.status, s.signed_at, s.appointment_at, u.name AS agent_name, u.npn AS agent_npn
    FROM soas s LEFT JOIN users u ON u.id=s.agent_id WHERE token=$1`, [req.params.token]);
  if (!s) return res.status(404).json({ error: 'Form not found' });
  res.json(s);
});

publicApi.post('/soa/:token/sign', async (req, res) => {
  const s = await one(`SELECT * FROM soas WHERE token=$1`, [req.params.token]);
  if (!s) return res.status(404).json({ error: 'Form not found' });
  if (s.status === 'Signed') return res.json({ ok: true, already: true });
  const { signer_name, products, relationship } = req.body;
  if (!signer_name || String(signer_name).trim().length < 3) return res.status(400).json({ error: 'Please type your full name to sign' });
  await update('soas', s.id, {
    status: 'Signed', signed_at: new Date(), signer_name: String(signer_name).trim(), signer_ip: req.ip,
    products: Array.isArray(products) && products.length ? products : s.products,
  });
  const relatedType = s.client_id ? 'client' : 'lead';
  const relatedId = s.client_id || s.lead_id;
  if (relatedId) {
    await insert('activities', { type: 'system', subject: 'Scope of Appointment signed (e-sign)', body: `Signed by ${signer_name}${relationship ? ` (${relationship})` : ''}`, related_type: relatedType, related_id: relatedId, completed: true });
    if (s.lead_id) await q(`UPDATE leads SET status = CASE WHEN status IN ('New','Contacted','SOA Sent') THEN 'SOA Signed' ELSE status END, updated_at=now() WHERE id=$1`, [s.lead_id]);
  }
  if (s.agent_id) await insert('notifications', { user_id: s.agent_id, title: 'SOA signed ✍️', body: `${signer_name} signed their Scope of Appointment`, link: `/${relatedType}s/${relatedId}` });
  res.json({ ok: true });
});
