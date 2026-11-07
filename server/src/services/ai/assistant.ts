import { q, one, insert, update } from '../../db/index.ts';
import { publish } from '../../realtime.ts';
import { redactSensitive, needsLicensedAgent, wantsHuman, CUSTOMER_AI_DISCLAIMER } from './guardrails.ts';
import { kbLookup, KB_TEXT } from './knowledge.ts';
import { generateText, aiMode } from './index.ts';
import { routeAppointment, notify } from '../automation.ts';
import { scoreLead } from '../scoring.ts';
import { config, TPMO_DISCLAIMER } from '../../config.ts';
import { toE164 } from '../phone.ts';

/**
 * "Global Assistant" — the customer-facing AI for iwillglobal.com and the mobile app.
 * Scope is limited to general education, intake, scheduling with a licensed agent, and SOA collection.
 * It never recommends specific plans, quotes benefits, enrolls, or collects MBI/SSN.
 */

export interface Reply { body: string; quick_replies?: string[] }

export const WELCOME: Reply = {
  body: `Hi! 👋 ${CUSTOMER_AI_DISCLAIMER}\n\nHow can I help you today?`,
  quick_replies: ['I\'m turning 65', 'Explain Medicare parts', 'When can I change plans?', 'Talk to a licensed agent'],
};

function nextSlots(from = new Date()): string[] {
  // Next business-day slots at 10:00, 13:00, 15:00 Arizona time (UTC-7, no DST)
  const slots: string[] = [];
  const d = new Date(from);
  while (slots.length < 3) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = new Date(d.getTime() - 7 * 3600000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const h of [10, 13, 15]) {
      if (slots.length >= 3) break;
      const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h + 7, 0, 0));
      slots.push(s.toISOString());
    }
    if (slots.length) break;
  }
  return slots;
}

const fmtSlot = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Phoenix', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export async function addMessage(conversationId: string, sender: 'visitor' | 'ai' | 'agent' | 'system', body: string, meta: any = {}, userId: string | null = null) {
  const msg = await insert('messages', { conversation_id: conversationId, sender, body, meta, user_id: userId });
  await q(`UPDATE conversations SET updated_at = now(), unread = unread + $2 WHERE id = $1`, [conversationId, sender === 'visitor' ? 1 : 0]);
  publish(`conv:${conversationId}`, 'message', msg);
  publish('inbox', 'message', { conversation_id: conversationId, message: msg });
  return msg;
}

async function ensureLead(conv: any, intake: any) {
  if (conv.lead_id) {
    const [first, ...rest] = String(intake.name || '').trim().split(/\s+/);
    const updates: Record<string, any> = { updated_at: new Date() };
    if (first) updates.first_name = first;
    if (rest.length) updates.last_name = rest.join(' ');
    if (intake.phone) updates.phone = intake.phone;
    if (intake.address) updates.address = intake.address;
    if (intake.email) updates.email = intake.email;
    if (intake.zip) updates.zip = intake.zip;
    await update('leads', conv.lead_id, updates);
    return conv.lead_id;
  }
  const [first, ...rest] = String(intake.name || 'Website Visitor').trim().split(/\s+/);
  const lead = await insert('leads', {
    first_name: first,
    last_name: rest.join(' ') || 'Client',
    phone: intake.phone || null,
    address: intake.address || null,
    email: intake.email || null,
    zip: intake.zip || null,
    state: 'AZ',
    source: 'Website Traffic',
    status: 'New',
    tcpa_consent: Boolean(intake.consent ?? true),
    consent_at: intake.consent ? new Date() : new Date(),
    interest: intake.topic || null,
    notes: `Added by Receptionist from Website Traffic (${conv.id})`,
    ...scoreLead({ source: 'Website Traffic', tcpa_consent: true, status: 'New' }),
  });
  await update('conversations', conv.id, { lead_id: lead.id });
  await insert('activities', { type: 'chat', subject: 'Website Traffic chat started with Receptionist', related_type: 'lead', related_id: lead.id, completed: true, meta: { conversation_id: conv.id, lead_source: 'Website Traffic' } });
  return lead.id;
}

async function handoff(conv: any, intake: any): Promise<Reply> {
  await update('conversations', conv.id, { status: 'waiting_agent', intake });
  await ensureLead(conv, intake);
  const agents = await q(`SELECT id FROM users WHERE active AND role IN ('licensed_agent','manager','admin')`);
  for (const a of agents.slice(0, 25)) await notify(a.id, 'Chat needs an agent', `${intake.name || 'A visitor'} asked for a licensed agent`, `/inbox?c=${conv.id}`);
  publish('inbox', 'handoff', { conversation_id: conv.id });
  return { body: `Thanks${intake.name ? `, ${intake.name.split(' ')[0]}` : ''}! I've notified our licensed agents — someone will join this chat shortly. If we miss you, we'll call you back${intake.phone ? ` at ${intake.phone}` : ''}. You can also call us at ${config.agency.phone}.` };
}

/** Intake/booking state machine. Returns null when not in a flow. */
async function runFlow(conv: any, intake: any, text: string): Promise<Reply | null> {
  if (!intake.flow) return null;
  const step = intake.step;
  if (step === 'name') {
    if (text.trim().length < 2) return { body: 'Could you share your full first and last name?' };
    intake.name = text.trim().slice(0, 80);
    intake.step = 'phone';
    return { body: `Nice to meet you, ${intake.name.split(' ')[0]}! What is the best phone number to reach you and send your confirmation text?` };
  }
  if (step === 'phone') {
    const e = toE164(text);
    if (!e) return { body: 'Hmm, that doesn\'t look like a valid phone number. Please enter a 10-digit number like 480-555-0123.' };
    intake.phone = e;
    intake.step = 'address';
    return { body: 'Thank you! And what is your street address (including city and ZIP code)?' };
  }
  if (step === 'address') {
    if (text.trim().length < 4) return { body: 'Please share your street address so we can properly add your profile and set your appointment.' };
    intake.address = text.trim().slice(0, 140);
    const z = text.match(/\b\d{5}\b/);
    if (z) intake.zip = z[0];
    intake.consent = true;
    await ensureLead(conv, intake);
    if (intake.flow === 'handoff') { intake.step = 'done'; return handoff(conv, intake); }
    intake.step = 'slot';
    intake.slots = nextSlots();
    return {
      body: 'Thank you! Here are the next available appointment times with our licensed Principal Broker, King Amen Ra (Arizona time). Which works best for you?',
      quick_replies: [...intake.slots.map(fmtSlot), 'None of these work'],
    };
  }
  if (step === 'email') {
    const m = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    if (m) intake.email = m[0];
    intake.step = 'zip';
    return { body: 'What\'s your ZIP code? Plans and agents vary by area.' };
  }
  if (step === 'zip') {
    const z = text.match(/\b\d{5}\b/);
    if (!z) return { body: 'Please enter a 5-digit ZIP code.' };
    intake.zip = z[0];
    intake.step = 'consent';
    return {
      body: `Last step: May I Will Global contact you by phone, text, or email about your coverage options? You can always call us at ${config.agency.phone}.`,
      quick_replies: ['Yes, you may contact me', 'No, I\'ll call you'],
    };
  }
  if (step === 'consent') {
    intake.consent = /^(y|yes|sure|ok|okay)/i.test(text.trim());
    if (intake.flow === 'handoff') { intake.step = 'done'; return handoff(conv, intake); }
    intake.step = 'slot';
    intake.slots = nextSlots();
    return {
      body: 'Here are the next available times with a licensed agent (Arizona time). Which works best?',
      quick_replies: [...intake.slots.map(fmtSlot), 'None of these work'],
    };
  }
  if (step === 'slot') {
    const idx = intake.slots.findIndex((s: string) => text.includes(fmtSlot(s)) || text.trim() === String(intake.slots.indexOf(s) + 1));
    if (idx < 0) { intake.flow = 'handoff'; intake.step = 'done'; return handoff(conv, intake); }
    const at = new Date(intake.slots[idx]);
    const leadId = await ensureLead(conv, intake);

    // Import and execute unified appointment scheduling
    const { scheduleAppointment } = await import('../appointments.ts');
    const schUser: any = { id: 'u_sch1', name: 'Receptionist', role: 'scheduler' };

    const res = await scheduleAppointment({
      related_type: 'lead',
      related_id: leadId,
      appointment_type: 'telephone',
      appointment_at: at.toISOString(),
      location: intake.address || `Phone: ${intake.phone}`,
      notes: `Booked by Receptionist via Website Traffic. Address: ${intake.address || 'N/A'}. Conversation: ${conv.id}`,
      send_confirmation_sms: Boolean(intake.phone),
      send_confirmation_email: Boolean(intake.email),
      booked_by: schUser,
    });

    intake.step = 'done';
    intake.booked_at = at.toISOString();
    return {
      body: `You're all set! 📅 **${fmtSlot(at.toISOString())}** with ${res.assigned_agent ? res.assigned_agent.name.split(' ')[0] + ', a licensed agent' : 'a licensed agent'}.\n\n📱 We just sent an initial confirmation text message to ${intake.phone} — **please reply YES** to confirm your appointment time.\n\nAnything else I can help with?`,
    };
  }
  return null;
}

function startFlow(intake: any, flow: 'booking' | 'handoff', topic?: string): Reply {
  intake.flow = flow;
  intake.topic = topic || intake.topic;
  if (!intake.name) { intake.step = 'name'; return { body: flow === 'booking' ? 'I\'d be happy to set up your free appointment with a licensed advisor! First, what is your full first and last name?' : 'Of course — let me connect you with a licensed advisor. First, what is your full name?' }; }
  if (!intake.phone) { intake.step = 'phone'; return { body: 'What is the best phone number to reach you and send your confirmation text?' }; }
  if (!intake.address) { intake.step = 'address'; return { body: 'And what is your street address?' }; }
  intake.step = 'slot';
  intake.slots = nextSlots();
  return {
    body: 'Here are the next available times with a licensed agent (Arizona time). Which works best?',
    quick_replies: [...intake.slots.map(fmtSlot), 'None of these work'],
  };
}

/** Process an inbound visitor message and produce AI replies (unless a human agent has taken over). */
export async function handleVisitorMessage(conversationId: string, rawText: string): Promise<{ replies: any[] }> {
  const conv = await one(`SELECT * FROM conversations WHERE id=$1`, [conversationId]);
  if (!conv) throw Object.assign(new Error('Conversation not found'), { status: 404 });
  const { text, found } = redactSensitive(String(rawText).slice(0, 2000));
  await addMessage(conv.id, 'visitor', text, found.length ? { redacted: found } : {});
  const out: any[] = [];
  const say = async (r: Reply) => out.push(await addMessage(conv.id, 'ai', r.body, { quick_replies: r.quick_replies || [], mode: aiMode() }));

  if (found.length) {
    await say({ body: `For your security, please don't share your ${found.join(' or ')} in chat — I've removed it. A licensed agent will collect anything needed securely.` });
  }
  if (conv.status === 'agent' || conv.status === 'closed') return { replies: out };
  if (conv.status === 'waiting_agent') {
    if (!found.length) await say({ body: 'Thanks — a licensed agent will be with you shortly. I\'ve added your message to the conversation.' });
    return { replies: out };
  }

  const intake = conv.intake || {};
  let reply = await runFlow(conv, intake, text);
  if (!reply) {
    if (wantsHuman(text)) reply = startFlow(intake, 'handoff');
    else if (/appointment|schedule|book|meet|consult|help me (choose|pick|find)|quote/i.test(text)) reply = startFlow(intake, 'booking');
    else if (needsLicensedAgent(text)) {
      reply = {
        body: `That's a great question for a licensed agent — I'm not able to recommend or compare specific plans. Our agents can review the plans we offer in your area based on your doctors and prescriptions, at no cost.\n\n_${TPMO_DISCLAIMER}_\n\nWould you like to book a free appointment?`,
        quick_replies: ['Book an appointment', 'Talk to a licensed agent now'],
      };
    } else {
      const kb = kbLookup(text);
      let body: string | null = null;
      if (!kb || text.length > 60) {
        try {
          body = await generateText(
            `Visitor message: "${text}"`,
            `You are the "Receptionist" for I Will Global, a licensed independent insurance agency in Arizona (${config.agency.phone}).
Answer general Medicare and insurance education questions in 2-5 short sentences, plain language, warm tone. Never refer to yourself as AI or an AI assistant—simply say you are the Receptionist.
NEVER recommend, compare, or quote specific plans, carriers, premiums, copays, or benefits. NEVER ask for Medicare numbers, SSNs, or bank info.
If the question needs personal plan advice or enrollment, say a licensed agent can help and offer to book a free appointment.
If unrelated to Medicare/insurance, politely redirect. Reference knowledge:\n${KB_TEXT}`, 0.3);
          if (body && needsLicensedAgent(body)) body = null; // post-filter: drop risky generations
        } catch { body = null; }
      }
      reply = body ? { body, quick_replies: ['Book an appointment', 'Talk to a licensed agent'] }
        : kb ? { body: kb.answer, quick_replies: ['Book an appointment', 'Explain Medicare parts', 'Talk to a licensed agent'] }
          : { body: 'I can help with general Medicare questions — like enrollment periods, Parts A–D, Medigap, or turning 65 — or connect you with a licensed agent. What would you like to know?', quick_replies: WELCOME.quick_replies };
      if (/65|turning/i.test(text)) intake.topic = 'Turning 65';
    }
  }
  await update('conversations', conv.id, { intake, visitor_name: intake.name || conv.visitor_name, visitor_phone: intake.phone || conv.visitor_phone, visitor_email: intake.email || conv.visitor_email, visitor_zip: intake.zip || conv.visitor_zip, consent: Boolean(intake.consent) });
  await say(reply);
  return { replies: out };
}

/** AI summary of a conversation for the agent. */
export async function summarizeConversation(conversationId: string) {
  const msgs = await q(`SELECT sender, body FROM messages WHERE conversation_id=$1 ORDER BY created_at`, [conversationId]);
  const transcript = msgs.map((m) => `${m.sender}: ${m.body}`).join('\n');
  const s = await generateText(`Transcript:\n${transcript}\n\nSummarize in 3 bullets: who, what they need, next step.`, 'You summarize Medicare agency chats for licensed agents. Be factual.', 0.2);
  if (s) return s;
  const visitor = msgs.filter((m) => m.sender === 'visitor').map((m) => m.body);
  return `[Demo AI] ${visitor.length} visitor messages. First ask: "${(visitor[0] || '').slice(0, 120)}". Latest: "${(visitor[visitor.length - 1] || '').slice(0, 120)}".`;
}
