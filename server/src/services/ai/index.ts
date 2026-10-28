import { config, isAIEnabled } from '../../config.ts';
import type { AuthUser } from '../../auth.ts';
import { toolDeclarations, runTool } from './tools.ts';
import { schedulerBenefitFlags } from './guardrails.ts';

/**
 * AI facade. Uses Gemini when GEMINI_API_KEY is set; otherwise returns deterministic, clearly-labeled demo output
 * so every feature remains usable offline.
 */
let client: any = null;
async function gemini() {
  if (!isAIEnabled()) return null;
  if (!client) {
    const { GoogleGenAI } = await import('@google/genai');
    client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }
  return client;
}

export const aiMode = () => (isAIEnabled() ? 'gemini' : 'demo');

export async function generateText(prompt: string, system: string, temperature = 0.4): Promise<string | null> {
  const ai = await gemini();
  if (!ai) return null;
  const resp = await ai.models.generateContent({
    model: config.gemini.model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { systemInstruction: system, temperature },
  });
  return resp.text ?? null;
}

async function generateJSON<T>(prompt: string, system: string): Promise<T | null> {
  const ai = await gemini();
  if (!ai) return null;
  const resp = await ai.models.generateContent({
    model: config.gemini.model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { systemInstruction: system, temperature: 0.2, responseMimeType: 'application/json' },
  });
  try { return JSON.parse(resp.text || 'null'); } catch { return null; }
}

// ---------------------------------------------------------------- Call intelligence
export async function summarizeCall(notes: string, disposition: string, role: string) {
  const sys = 'You are a Medicare insurance agency call-notes assistant. Be concise and factual. Never invent details.';
  const prompt = `Disposition: ${disposition}\nCaller role: ${role}\nNotes:\n${notes}\n\nReturn JSON {"summary": "2-3 sentence summary", "next_steps": ["..."], "suggested_disposition": "...", "sentiment": "positive|neutral|negative"}`;
  const out = await generateJSON<any>(prompt, sys);
  if (out?.summary) return { ...out, mode: 'gemini' };
  // Demo: extractive summary
  const sentences = notes.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  const next: string[] = [];
  if (/call ?back|tomorrow|next week|later/i.test(notes)) next.push('Schedule the requested callback');
  if (/soa|scope/i.test(notes)) next.push('Confirm Scope of Appointment is signed before discussing plans');
  if (/doctor|medication|prescription|rx/i.test(notes)) next.push('Collect medications and doctors for plan review');
  if (/email|send/i.test(notes)) next.push('Send follow-up email');
  if (!next.length) next.push('Log follow-up task');
  const sentiment = /not interested|angry|upset|stop calling/i.test(notes) ? 'negative' : /interested|great|yes|happy/i.test(notes) ? 'positive' : 'neutral';
  return {
    summary: `[Demo AI] ${disposition}. ${sentences.slice(0, 2).join(' ')}`.slice(0, 400),
    next_steps: next,
    suggested_disposition: /voicemail/i.test(notes) ? 'Left Voicemail' : /call ?back/i.test(notes) ? 'Callback Requested' : disposition,
    sentiment,
    mode: 'demo',
  };
}

// ---------------------------------------------------------------- Compliance check
export async function complianceCheck(text: string, ctx: { role: string; soaOnFile: boolean; tpmoGiven?: boolean }) {
  const issues: Array<{ level: 'error' | 'warning' | 'ok'; message: string }> = [];
  const benefitTalk = schedulerBenefitFlags(text);
  if (ctx.role === 'scheduler' && benefitTalk.length) {
    issues.push({ level: 'error', message: `Unlicensed scheduler notes mention plan benefits (${benefitTalk.join(', ')}). Schedulers may only set appointments.` });
  }
  if (benefitTalk.length && !ctx.soaOnFile) issues.push({ level: 'error', message: 'Plan benefits discussed without a Scope of Appointment on file.' });
  if (benefitTalk.length && ctx.tpmoGiven === false) issues.push({ level: 'warning', message: 'TPMO disclaimer not marked as given before benefit discussion.' });
  if (/guarantee|best plan|free money|you have to switch/i.test(text)) issues.push({ level: 'warning', message: 'Possible prohibited marketing language (absolutes/pressure).' });
  if (!issues.length) issues.push({ level: 'ok', message: 'No compliance issues detected.' });
  return { issues, mode: aiMode() };
}

// ---------------------------------------------------------------- Email drafting
export async function draftEmail(input: { name: string; purpose: string; context?: string; agentName: string; tone?: string }) {
  const sys = `You write short, warm, compliant emails for I Will Global, a licensed Medicare insurance agency (phone ${config.agency.phone}).
Rules: no plan-specific benefit claims, no absolutes like "best" or "guaranteed", no pressure. Include a clear next step. Sign as the agent.`;
  const prompt = `Recipient: ${input.name}\nPurpose: ${input.purpose}\nContext: ${input.context || 'n/a'}\nTone: ${input.tone || 'friendly, professional'}\nAgent: ${input.agentName}\nReturn JSON {"subject": "...", "body": "plain text email"}`;
  const out = await generateJSON<{ subject: string; body: string }>(prompt, sys);
  if (out?.subject) return { ...out, mode: 'gemini' };
  const first = input.name.split(' ')[0] || 'there';
  const p = input.purpose.toLowerCase();
  let subject = 'Following up from I Will Global';
  let core = 'I wanted to follow up on our recent conversation and see if you had any questions I can help with.';
  if (p.includes('aep') || p.includes('review')) {
    subject = 'Your annual Medicare review — AEP is here (Oct 15 – Dec 7)';
    core = 'The Annual Enrollment Period runs October 15 through December 7. Plans can change their costs and coverage each year, so it\'s a great time for a quick review of your doctors and medications to make sure your coverage still fits.';
  } else if (p.includes('65') || p.includes('t65') || p.includes('turning')) {
    subject = 'Getting ready for Medicare at 65';
    core = 'Since you\'re approaching 65, your Initial Enrollment Period is coming up. I\'d be happy to explain your options in plain language and help you avoid any gaps or penalties — at no cost to you.';
  } else if (p.includes('appointment') || p.includes('confirm')) {
    subject = 'Confirming your Medicare appointment';
    core = 'This is a friendly confirmation of our upcoming appointment. Please have a list of your current medications and doctors handy so we can make the most of our time.';
  } else if (p.includes('soa') || p.includes('scope')) {
    subject = 'Quick form before our Medicare appointment';
    core = 'Before we meet, Medicare requires a short Scope of Appointment form confirming the types of plans you\'d like to discuss. It takes about a minute to complete.';
  } else if (p.includes('welcome') || p.includes('thank')) {
    subject = 'Welcome to I Will Global!';
    core = 'Thank you for trusting us with your Medicare coverage. I\'m your point of contact for any questions about your plan, ID cards, or claims throughout the year.';
  }
  const body = `Hi ${first},\n\n${core}\n\n${input.context ? input.context + '\n\n' : ''}Feel free to reply to this email or call me at ${config.agency.phone}.\n\nWarm regards,\n${input.agentName}\nI Will Global\n${config.agency.website}\n\nWe do not offer every plan available in your area. Please contact Medicare.gov or 1-800-MEDICARE for information on all of your options.`;
  return { subject, body, mode: 'demo' };
}

// ---------------------------------------------------------------- Record insights
export async function recordInsight(kind: string, record: any, related: any) {
  const facts = JSON.stringify({ record, recent: (related?.activities || []).slice(0, 8).map((a: any) => ({ type: a.type, subject: a.subject, disposition: a.disposition, at: a.created_at, body: a.body?.slice(0, 200) })) });
  const sys = 'You are a sales coach for a Medicare insurance agency. Give a crisp pre-call brief. Do not invent facts. Use short bullet points.';
  const out = await generateText(`Record type: ${kind}\nData: ${facts}\n\nWrite: 1) one-line situation, 2) 3 talking points, 3) recommended next best action, 4) risks.`, sys);
  if (out) return { brief: out, mode: 'gemini' };
  const name = `${record.first_name || ''} ${record.last_name || ''}`.trim() || record.name;
  const acts = related?.activities || [];
  const lastCall = acts.find((a: any) => a.type === 'call');
  const soaSigned = (related?.soas || []).some((s: any) => s.status === 'Signed');
  const lines = [
    `**Situation:** ${name} — ${record.status || record.stage || 'active'}${record.score != null ? `, score ${record.score}/100` : ''}. ${record.score_reason || ''}`,
    `**Last touch:** ${lastCall ? `${lastCall.disposition || 'call'} on ${new Date(lastCall.created_at).toLocaleDateString()}` : 'No calls logged yet'}`,
    '**Talking points:**',
    `• Confirm current coverage${record.current_coverage ? ` (${record.current_coverage})` : ''} and satisfaction`,
    '• Ask about doctors and prescriptions that must be covered',
    `• ${soaSigned ? 'SOA on file — you may discuss plan options' : 'Collect Scope of Appointment before discussing any plan benefits'}`,
    `**Next best action:** ${soaSigned ? 'Run a quote in MedicareCENTER/SunFire and present 2–3 options' : 'Send SOA link and book an appointment with a licensed agent'}`,
    `**Risks:** ${(record.attempts || 0) >= 4 ? 'Many attempts — try a different time of day or email' : 'Low — engage early in AEP while capacity is available'}`,
  ];
  return { brief: `[Demo AI]\n${lines.join('\n')}`, mode: 'demo' };
}

// ---------------------------------------------------------------- Copilot (function-calling agent)
export async function copilot(user: AuthUser, history: Array<{ role: 'user' | 'assistant'; content: string }>) {
  const last = history[history.length - 1]?.content || '';
  const ai = await gemini();
  if (!ai) return demoCopilot(user, last);

  const system = `You are IWG Copilot inside IWG CRM for I Will Global (Medicare insurance agency, Arizona).
User: ${user.name}, role: ${user.role}. Today: ${new Date().toDateString()}.
Use tools to answer with real CRM data; never invent records. Keep answers short with bullet points and bold key numbers.
If the user is a scheduler, remind them not to discuss plan benefits. Format record lists as markdown with names.`;
  const contents: any[] = history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const toolsUsed: Array<{ name: string; args: any; result: any }> = [];
  for (let i = 0; i < 5; i++) {
    const resp = await ai.models.generateContent({
      model: config.gemini.model, contents,
      config: { systemInstruction: system, temperature: 0.3, tools: [{ functionDeclarations: toolDeclarations as any }] },
    });
    const calls = resp.functionCalls || [];
    if (!calls.length) return { reply: resp.text || '…', tools: toolsUsed, mode: 'gemini' };
    contents.push({ role: 'model', parts: calls.map((c: any) => ({ functionCall: c })) });
    const parts: any[] = [];
    for (const c of calls) {
      const result = await runTool(c.name, c.args || {}, user);
      toolsUsed.push({ name: c.name, args: c.args, result });
      parts.push({ functionResponse: { name: c.name, response: { result } } });
    }
    contents.push({ role: 'user', parts });
  }
  return { reply: 'I gathered the data above but ran out of steps — try a more specific question.', tools: toolsUsed, mode: 'gemini' };
}

const fmtDate = (d: any) => (d ? new Date(d).toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

async function demoCopilot(user: AuthUser, text: string) {
  const t = text.toLowerCase();
  const tools: any[] = [];
  const run = async (name: string, args: any = {}) => { const result = await runTool(name, args, user); tools.push({ name, args, result }); return result; };
  let reply = '';

  const days = Number((t.match(/(\d+)\s*days?/) || [])[1]) || undefined;
  if (/turn(ing)?\s*65|t65|iep/.test(t)) {
    const r = await run('search_leads', { turning_65_within_days: days || 90, limit: 10 });
    reply = `**${r.total}** leads turn 65 in the next ${days || 90} days. Top prospects:\n\n` +
      r.rows.map((x: any) => `• [${x.name}](/leads/${x.id}) — ${x.county || ''} · score **${x.score}** · ${x.status}`).join('\n');
  } else if (/who (should|do) i call|call list|prioriti|next best|who to call/.test(t)) {
    const r = await run('who_to_call_today', { limit: 8 });
    reply = `Here's your prioritized call list:\n\n` + r.rows.map((x: any, i: number) => `${i + 1}. [${x.name}](/leads/${x.id}) — score **${x.score}** · ${x.score_reason || x.status}`).join('\n') +
      `\n\nOpen the **Power Dialer** to work this list with Google Voice.`;
  } else if (/pipeline|deals?|opportunit/.test(t)) {
    const r = await run('get_pipeline_summary');
    reply = r.error ? r.error : `**Pipeline by stage:**\n\n` + r.stages.map((s: any) => `• ${s.stage}: **${s.deals}** deals · ${money(s.expected_commission)} expected`).join('\n');
  } else if (/overdue|tasks?|today|agenda|appointments?|schedule/.test(t)) {
    const range = /overdue/.test(t) ? 'overdue' : /week/.test(t) ? 'week' : 'today';
    const r = await run('get_tasks', { range });
    reply = r.rows.length ? `You have **${r.rows.length}** ${range} items:\n\n` + r.rows.map((x: any) => `• ${x.type === 'event' ? '📅' : '☑️'} ${x.subject} — ${fmtDate(x.due_at)}`).join('\n') : `Nothing ${range} — nice work! 🎉`;
  } else if (/calls?|connect|dial|stats|performance/.test(t)) {
    const r = await run('get_call_stats', { days: days || 7 });
    const rate = r.calls ? Math.round((r.connects / r.calls) * 100) : 0;
    reply = `**Last ${days || 7} days:** ${r.calls} calls · ${r.connects} connects (**${rate}%**) · ${r.appointments} appointments · ${r.applications} applications.`;
  } else if (/commission|paid|chargeback/.test(t)) {
    const r = await run('get_commission_summary');
    reply = r.error ? r.error : `**Commissions (recent periods):**\n\n` + r.periods.map((p: any) => `• ${p.period}: expected ${money(p.expected)} · paid ${money(p.paid)}${p.chargebacks ? ` · ${p.chargebacks} chargebacks` : ''}`).join('\n');
  } else if (/polic|carrier|book of business/.test(t)) {
    const r = await run('get_policy_summary');
    reply = r.error ? r.error : `**Book of business by carrier:**\n\n` + r.byCarrier.map((c: any) => `• ${c.carrier}: **${c.policies}** policies`).join('\n');
  } else if (/aep|enrollment period|oep/.test(t)) {
    const r = await run('get_enrollment_calendar');
    reply = (r.current ? `🗓️ **${r.current.label}** is open — **${r.current.daysLeft} days left** (ends ${r.current.end}).` : `Next up: **${r.next.label}** starts ${r.next.start} (in **${r.next.daysUntil} days**).`) +
      `\n\nT65 pipeline: **${r.turning65?.next_30 ?? 0}** turning 65 in 30 days, **${r.turning65?.next_90 ?? 0}** in 90 days.`;
  } else if (/create|remind|add a task|follow.?up/.test(t)) {
    const name = (text.match(/(?:for|with|call)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/) || [])[1];
    const r = await run('create_task', { subject: text.replace(/^(please\s+)?(create|add)\s+(a\s+)?(task|reminder)\s*(to)?\s*/i, '').slice(0, 120) || 'Follow up', contact_name: name });
    reply = `✅ Task created: **${r.task.subject}** due ${fmtDate(r.task.due_at)}${r.task.linked_to ? ` (linked to ${r.task.linked_to})` : ''}.`;
  } else if (/find|search|look ?up|show/.test(t)) {
    const query = text.replace(/^(find|search( for)?|look ?up|show( me)?)\s*/i, '').trim();
    const r = await run('search_leads', { query, limit: 8 });
    reply = r.rows.length ? `Found **${r.total}** leads:\n\n` + r.rows.map((x: any) => `• [${x.name}](/leads/${x.id}) — ${x.phone || ''} · ${x.status}`).join('\n') : `No leads matched "${query}".`;
  } else {
    reply = `I can help with things like:\n\n• "Who should I call today?"\n• "Leads turning 65 in the next 60 days"\n• "Show my pipeline" / "My commissions"\n• "What's overdue?"\n• "Create a task to call Mary Johnson tomorrow"\n• "How many calls did I make this week?"`;
  }
  if (user.role === 'scheduler' && /plan|benefit|premium/.test(t)) reply += '\n\n> Reminder: as a scheduler, please don\'t discuss plan benefits — book an appointment with a licensed agent.';
  return { reply: `${reply}\n\n_Demo AI mode — add a Gemini API key for full conversational answers._`, tools, mode: 'demo' };
}
