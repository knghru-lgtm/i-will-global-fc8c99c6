import { q, one, insert, update } from '../db/index.ts';
import { toE164 } from './phone.ts';
import { applyDisposition } from './automation.ts';

export interface BlandConfig {
  id: string;
  api_key: string | null;
  enabled: boolean;
  pathway_id: string;
  github_repo: string | null;
  default_voice: string;
  model: string;
  language: string;
  from_number: string;
  transfer_phone_number: string;
  prompt_template: string;
  webhook_url: string;
  calling_hours_start: string;
  calling_hours_end: string;
  calling_days: string;
  daily_call_limit: number;
  pause_on_warm_transfer: boolean;
  is_calling_paused: boolean;
  paused_reason?: string | null;
  updated_at?: string;
}

export const DEFAULT_BLAND_PATHWAY_ID = '3b13b658-e85d-4d14-a24a-868b61040c42';

export const DEFAULT_BLAND_PROMPT = `You are Sarah, an outbound scheduling assistant calling from the Medicare Helpline powered by IWG Insurance and Financial Services.
Your tone is warm, polite, professional, and patient with senior beneficiaries.
You are calling {prospect_name} who requested information regarding Medicare options, Turning 65 Initial Enrollment, or the upcoming Medicare Annual Election Period (AEP).

FIRST SENTENCE / INTRO:
"Hello, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"

KEY COMPLIANCE & OPERATIONAL RULES:
1. TPMO Disclaimer: "We do not offer every plan available in your area. Currently we represent 7 major Medicare organizations which offer over 50 products in your area. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Program (SHIP) to get information on all of your options."
2. You are an appointment setter, NOT a licensed insurance agent. DO NOT quote specific plan prices, carrier advantages, or specific formulary coverage details.
3. Your primary objective: Verify if they have questions about Medicare Part A, Part B, Medigap Plan G/N, or Medicare Advantage, and arrange a direct live consultation with state-licensed broker King Amen Ra (Principal Broker & Licensed Agent, NPN 16094432).
4. If the prospect says YES or agrees to speak with a licensed agent, or has time right now, IMMEDIATELY connect them directly to King Amen Ra (+16024569681). Say: "I am connecting you right now with King Amen Ra, our licensed senior Medicare advisor. Please stay on the line." and trigger the live transfer immediately.
5. While a warm transfer is in progress, outbound calls are paused until King Amen Ra dispositions the lead.
6. NEVER recite, speak, or disclose our direct phone number or email address to the caller under any circumstances.
7. If the beneficiary prefers an appointment, ask for their preferred day and time (morning or afternoon).
8. If the beneficiary states they are already happy with their plan or not interested, thank them politely and wish them a wonderful day.
9. If the beneficiary says "Do not call" or "Remove me", immediately confirm: "Understood, I will place your number on our Do Not Call list right now. Have a good day." and conclude.`;

export async function getBlandConfig(): Promise<BlandConfig> {
  try {
    // Graceful column migration for existing tables
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS pathway_id TEXT DEFAULT '3b13b658-e85d-4d14-a24a-868b61040c42'`).catch(() => {});
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS github_repo TEXT`).catch(() => {});
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS calling_hours_start TEXT DEFAULT '09:00'`).catch(() => {});
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS calling_hours_end TEXT DEFAULT '19:00'`).catch(() => {});
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS calling_days TEXT DEFAULT 'Mon-Fri'`).catch(() => {});
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS daily_call_limit INT DEFAULT 1000`).catch(() => {});
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS pause_on_warm_transfer BOOLEAN DEFAULT TRUE`).catch(() => {});
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS is_calling_paused BOOLEAN DEFAULT FALSE`).catch(() => {});
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS paused_reason TEXT`).catch(() => {});

    const row = await one<BlandConfig>(`SELECT * FROM bland_config WHERE id='main'`);
    if (row) {
      return {
        ...row,
        pathway_id: row.pathway_id || DEFAULT_BLAND_PATHWAY_ID,
        github_repo: row.github_repo || null,
        api_key: row.api_key || process.env.BLAND_API_KEY || null,
        prompt_template: row.prompt_template || DEFAULT_BLAND_PROMPT,
        calling_hours_start: row.calling_hours_start || '09:00',
        calling_hours_end: row.calling_hours_end || '19:00',
        calling_days: row.calling_days || 'Mon-Fri',
        daily_call_limit: row.daily_call_limit !== undefined && row.daily_call_limit !== null ? Number(row.daily_call_limit) : 1000,
        pause_on_warm_transfer: row.pause_on_warm_transfer !== false,
        is_calling_paused: Boolean(row.is_calling_paused),
        paused_reason: row.paused_reason || null,
      };
    }
  } catch (err) {
    console.error('Error fetching bland_config:', err);
  }

  return {
    id: 'main',
    api_key: process.env.BLAND_API_KEY || null,
    enabled: true,
    pathway_id: DEFAULT_BLAND_PATHWAY_ID,
    github_repo: null,
    default_voice: 'maya',
    model: 'enhanced',
    language: 'en-US',
    from_number: '+16024569681',
    transfer_phone_number: '+16024569681',
    prompt_template: DEFAULT_BLAND_PROMPT,
    webhook_url: 'https://iwillglobal.com/api/bland/webhook',
    calling_hours_start: '09:00',
    calling_hours_end: '19:00',
    calling_days: 'Mon-Fri',
    daily_call_limit: 1000,
    pause_on_warm_transfer: true,
    is_calling_paused: false,
    paused_reason: null,
  };
}

export async function saveBlandConfig(data: Partial<BlandConfig>): Promise<BlandConfig> {
  const current = await getBlandConfig();
  const apiKey = data.api_key !== undefined ? (data.api_key ? String(data.api_key).trim() : null) : current.api_key;
  const enabled = data.enabled !== undefined ? Boolean(data.enabled) : current.enabled;
  const pathwayId = data.pathway_id !== undefined ? String(data.pathway_id).trim() : (current.pathway_id || DEFAULT_BLAND_PATHWAY_ID);
  const githubRepo = data.github_repo !== undefined ? (data.github_repo ? String(data.github_repo).trim() : null) : current.github_repo;
  const defaultVoice = data.default_voice || current.default_voice || 'maya';
  const model = data.model || current.model || 'enhanced';
  const language = data.language || current.language || 'en-US';
  const fromNumber = data.from_number || current.from_number || '+16024569681';
  const transferPhoneNumber = data.transfer_phone_number || current.transfer_phone_number || '+16024569681';
  const promptTemplate = data.prompt_template || current.prompt_template || DEFAULT_BLAND_PROMPT;
  const webhookUrl = data.webhook_url || current.webhook_url || 'https://iwillglobal.com/api/bland/webhook';
  const callingHoursStart = data.calling_hours_start || current.calling_hours_start || '09:00';
  const callingHoursEnd = data.calling_hours_end || current.calling_hours_end || '19:00';
  const callingDays = data.calling_days || current.calling_days || 'Mon-Fri';
  const dailyCallLimit = data.daily_call_limit !== undefined && data.daily_call_limit !== null ? Number(data.daily_call_limit) : (current.daily_call_limit || 1000);
  const pauseOnWarmTransfer = data.pause_on_warm_transfer !== undefined ? Boolean(data.pause_on_warm_transfer) : (current.pause_on_warm_transfer !== false);
  const isCallingPaused = data.is_calling_paused !== undefined ? Boolean(data.is_calling_paused) : current.is_calling_paused;
  const pausedReason = data.paused_reason !== undefined ? data.paused_reason : current.paused_reason;

  await q(`
    INSERT INTO bland_config (
      id, api_key, enabled, pathway_id, github_repo, default_voice, model, language, 
      from_number, transfer_phone_number, prompt_template, webhook_url, 
      calling_hours_start, calling_hours_end, calling_days, daily_call_limit, 
      pause_on_warm_transfer, is_calling_paused, paused_reason, updated_at
    )
    VALUES ('main', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
    ON CONFLICT (id) DO UPDATE SET
      api_key = COALESCE(EXCLUDED.api_key, bland_config.api_key),
      enabled = EXCLUDED.enabled,
      pathway_id = EXCLUDED.pathway_id,
      github_repo = EXCLUDED.github_repo,
      default_voice = EXCLUDED.default_voice,
      model = EXCLUDED.model,
      language = EXCLUDED.language,
      from_number = EXCLUDED.from_number,
      transfer_phone_number = EXCLUDED.transfer_phone_number,
      prompt_template = EXCLUDED.prompt_template,
      webhook_url = EXCLUDED.webhook_url,
      calling_hours_start = EXCLUDED.calling_hours_start,
      calling_hours_end = EXCLUDED.calling_hours_end,
      calling_days = EXCLUDED.calling_days,
      daily_call_limit = EXCLUDED.daily_call_limit,
      pause_on_warm_transfer = EXCLUDED.pause_on_warm_transfer,
      is_calling_paused = EXCLUDED.is_calling_paused,
      paused_reason = EXCLUDED.paused_reason,
      updated_at = now()
  `, [
    apiKey, enabled, pathwayId, githubRepo, defaultVoice, model, language, 
    fromNumber, transferPhoneNumber, promptTemplate, webhookUrl,
    callingHoursStart, callingHoursEnd, callingDays, dailyCallLimit,
    pauseOnWarmTransfer, isCallingPaused, pausedReason
  ]);

  return getBlandConfig();
}

/** Check if outbound dialing is permitted based on business hours and pause status. */
export async function canDispatchOutboundCall(): Promise<{ allowed: boolean; reason?: string }> {
  const cfg = await getBlandConfig();
  if (!cfg.enabled) {
    return { allowed: false, reason: 'Bland AI Voice Agent is currently disabled in settings.' };
  }

  if (cfg.is_calling_paused) {
    return { allowed: false, reason: `Bland AI outbound calls are paused: ${cfg.paused_reason || 'Warm transfer in progress. Waiting for King Amen Ra to disposition the lead.'}` };
  }

  // Check daily call volume
  const today = new Date().toISOString().slice(0, 10);
  const countRow = await one<{ count: string | number }>(
    `SELECT count(*) FROM activities WHERE provider = 'bland_ai' AND direction = 'outbound' AND created_at >= $1::date`,
    [today]
  );
  const callsToday = Number(countRow?.count || 0);
  if (callsToday >= (cfg.daily_call_limit || 1000)) {
    return { allowed: false, reason: `Daily outbound limit of ${cfg.daily_call_limit || 1000} calls reached (${callsToday} placed today).` };
  }

  // Check day and hours (America/Phoenix / Agency Local Time)
  const now = new Date();
  const options = { timeZone: 'America/Phoenix' };
  const dayName = new Intl.DateTimeFormat('en-US', { ...options, weekday: 'short' }).format(now);
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(dayName);

  if (cfg.calling_days === 'Mon-Fri' && !isWeekday) {
    return { allowed: false, reason: `Outbound calling is restricted to Monday through Friday (Today is ${dayName}).` };
  }

  const timeStr = new Intl.DateTimeFormat('en-US', {
    ...options,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  const start = cfg.calling_hours_start || '09:00';
  const end = cfg.calling_hours_end || '19:00';

  if (timeStr < start || timeStr >= end) {
    return { allowed: false, reason: `Outbound calling hours are ${start} to ${end} MST (Current time: ${timeStr} MST).` };
  }

  return { allowed: true };
}

/** Set Bland calling pause state (e.g. during warm transfers to King Amen Ra). */
export async function setBlandCallingPause(isPaused: boolean, reason?: string | null): Promise<void> {
  await q(`
    UPDATE bland_config 
    SET is_calling_paused = $1, paused_reason = $2, updated_at = now()
    WHERE id = 'main'
  `, [isPaused, isPaused ? (reason || 'Warm transfer in progress to King Amen Ra. Awaiting disposition.') : null]);
}

export interface BlandVoice {
  id: string;
  name: string;
  gender: string;
  description: string;
  accent: string;
  preview_audio?: string;
  is_recommended?: boolean;
}

export const BLAND_VOICES: BlandVoice[] = [
  { id: 'maya', name: 'Maya', gender: 'Female', description: 'Warm, Senior-Friendly, Natural & Clear', accent: 'American', is_recommended: true },
  { id: 'nat', name: 'Nat', gender: 'Female', description: 'Professional, Engaging & Conversational', accent: 'American', is_recommended: true },
  { id: 'josh', name: 'Josh', gender: 'Male', description: 'Friendly, Authoritative & Reassuring', accent: 'American' },
  { id: 'florence', name: 'Florence', gender: 'Female', description: 'Calm, Caring & Patient Healthcare Tone', accent: 'American' },
  { id: 'mason', name: 'Mason', gender: 'Male', description: 'Crisp, Professional Advisor', accent: 'American' },
  { id: 'tina', name: 'Tina', gender: 'Female', description: 'Energetic, Friendly & Empathetic', accent: 'American' },
  { id: 'ryan', name: 'Ryan', gender: 'Male', description: 'Warm, Approachable & Consultative', accent: 'American' },
  { id: 'florin', name: 'Florin (Bilingual)', gender: 'Female', description: 'Fluent English and Spanish Conversational', accent: 'Bilingual (US/ES)' },
];

export async function sendBlandCall(options: {
  phone: string;
  leadId?: string;
  userId?: string;
  prospectName?: string;
  customPrompt?: string;
  voice?: string;
  fromNumber?: string;
  transferNumber?: string;
  firstSentence?: string;
  pathwayId?: string;
  bypassChecks?: boolean;
}): Promise<{
  success: boolean;
  call_id: string;
  activity_id: string;
  status: string;
  message: string;
  simulated?: boolean;
}> {
  if (!options.bypassChecks) {
    const check = await canDispatchOutboundCall();
    if (!check.allowed) {
      throw new Error(`Outbound Call Blocked: ${check.reason}`);
    }
  }

  const cfg = await getBlandConfig();
  const e164 = toE164(options.phone);
  if (!e164) {
    throw new Error(`Invalid destination phone number: "${options.phone}"`);
  }

  const prospectName = options.prospectName || 'Valued Beneficiary';
  const voice = options.voice || cfg.default_voice || 'maya';
  const from = options.fromNumber || cfg.from_number || '+16024569681';
  const transfer = options.transferNumber || cfg.transfer_phone_number || '+16024569681';
  const pathwayId = options.pathwayId || cfg.pathway_id || DEFAULT_BLAND_PATHWAY_ID;

  let prompt = options.customPrompt || cfg.prompt_template || DEFAULT_BLAND_PROMPT;
  prompt = prompt.replace(/{prospect_name}/g, prospectName);

  const firstSentence = options.firstSentence || `Hello ${prospectName.split(' ')[0]}, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?`;

  const payload: any = {
    phone_number: e164,
    from,
    task: prompt,
    first_sentence: firstSentence,
    voice,
    model: cfg.model || 'enhanced',
    language: cfg.language || 'en-US',
    wait_for_greeting: true,
    record: true,
    answered_by_enabled: true,
    temperature: 0.5,
    max_duration: 12,
    transfer_phone_number: transfer,
    webhook: cfg.webhook_url || 'https://iwillglobal.com/api/bland/webhook',
    metadata: {
      lead_id: options.leadId || null,
      user_id: options.userId || null,
      prospect_name: prospectName,
      pathway_id: pathwayId,
      source: 'bland_ai',
      organization: 'I Will Global',
    },
    request_data: {
      prospect_name: prospectName,
      first_name: prospectName.split(' ')[0] || '',
      phone: e164,
      lead_id: options.leadId || '',
      transfer_phone_number: transfer,
      agent_name: 'King Amen Ra',
      agent_npn: '16094432',
      caller_id: from,
    },
  };

  if (pathwayId) {
    if (pathwayId.startsWith('fc8c99c6') || pathwayId === 'fc8c99c6-88c3-435d-952b-8c93c2db17a6') {
      payload.agent_id = pathwayId;
      payload.agent_version = 'staging';
    } else {
      payload.pathway_id = pathwayId;
    }
  }

  let callId: string = `bland_${Date.now()}`;
  let isSimulated = false;

  if (cfg.api_key && cfg.api_key !== 'simulated_test_key') {
    try {
      const res = await fetch('https://api.bland.ai/v1/calls', {
        method: 'POST',
        headers: {
          'Authorization': cfg.api_key.trim(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json() as any;
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Bland AI dispatch error');
      }
      callId = data.call_id || data.id || callId;
    } catch (apiErr: any) {
      console.warn('Bland AI live API dispatch failed, falling back to simulated mode:', apiErr.message);
      isSimulated = true;
      callId = `bland_sim_${Date.now()}`;
    }
  } else {
    isSimulated = true;
    callId = `bland_sim_${Date.now()}`;
  }

  // Insert initial activity record
  const act = await insert('activities', {
    type: 'call',
    subject: `🤖 Bland AI Outbound Call — ${prospectName}`,
    body: `Outbound AI Voice Call initiated via Bland AI (${voice.toUpperCase()} voice, Pathway: ${pathwayId}).\nTarget: ${prospectName} (${e164})\nCaller ID: ${from}\nTransfer Line: ${transfer}`,
    related_type: options.leadId ? 'lead' : null,
    related_id: options.leadId || null,
    user_id: options.userId || 'u_principal',
    status: 'In Progress',
    completed: false,
    direction: 'outbound',
    phone: e164,
    provider: 'bland_ai',
    meta: {
      bland_call_id: callId,
      pathway_id: pathwayId,
      voice,
      from,
      transfer_phone_number: transfer,
      is_simulated: isSimulated,
      first_sentence: firstSentence,
      source: 'bland_ai',
      initiated_at: new Date().toISOString(),
    },
  });

  return {
    success: true,
    call_id: callId,
    activity_id: act.id,
    status: 'in-progress',
    message: isSimulated
      ? `Bland AI Voice Agent dispatched in simulated preview mode (Pathway: ${pathwayId}, Call ID: ${callId}). To connect live telephony, enter your Bland API key in Settings.`
      : `Bland AI Voice Agent (Pathway: ${pathwayId}) dispatched live via Bland.ai (Call ID: ${callId}).`,
    simulated: isSimulated,
  };
}

export async function handleBlandWebhook(body: any): Promise<{ success: boolean; message: string; activity_id?: string }> {
  const callId = body.call_id || body.id;
  if (!callId) {
    return { success: false, message: 'Missing call_id in webhook payload' };
  }

  // Find corresponding activity
  let act = await one(`SELECT * FROM activities WHERE meta->>'bland_call_id' = $1`, [callId]);
  if (!act && body.metadata?.lead_id) {
    act = await one(`SELECT * FROM activities WHERE related_id = $1 AND provider = 'bland_ai' ORDER BY created_at DESC LIMIT 1`, [body.metadata.lead_id]);
  }

  const transcript = body.concatenated_transcript || (Array.isArray(body.transcripts) ? body.transcripts.map((t: any) => `${t.user || 'Speaker'}: ${t.text}`).join('\n') : '') || '';
  const summary = body.summary || 'Bland AI Voice Agent finished conversation.';
  const recordingUrl = body.recording_url || null;
  const durationSec = Math.round(Number(body.call_length || body.duration || 1) * (body.duration > 30 ? 1 : 60)) || 60;
  const answeredBy = body.answered_by || 'human'; // 'human' | 'voicemail' | 'unknown'
  const transferred = Boolean(body.transferred_to || body.transfer_destination || (transcript && /transferring you|connected to agent|connecting you right now with king/i.test(transcript)));

  // If a warm transfer was initiated, pause outbound calls until King dispositions the lead!
  if (transferred) {
    const cfg = await getBlandConfig();
    if (cfg.pause_on_warm_transfer) {
      await setBlandCallingPause(
        true,
        `Warm transfer initiated on call ${callId} with ${body.metadata?.prospect_name || 'beneficiary'}. Outbound calls paused awaiting King Amen Ra lead disposition.`
      );
    }
  }

  // Determine disposition
  let dispositionId = 'call_attempted';
  let dispositionLabel = 'Call Placed / Outbound Dial';

  if (answeredBy === 'voicemail') {
    dispositionId = 'voicemail';
    dispositionLabel = 'Left Voicemail';
  } else if (/do not call|remove me|stop calling|unsubscribe/i.test(transcript) || body.variables?.dnc) {
    dispositionId = 'dnc';
    dispositionLabel = 'Do Not Call (DNC)';
  } else if (/not interested|happy with current plan|refused/i.test(summary) || /not interested/i.test(transcript)) {
    dispositionId = 'not_interested';
    dispositionLabel = 'Not Interested / Plan Satisfied';
  } else if (transferred) {
    dispositionId = 'warm_transfer_success';
    dispositionLabel = 'Warm Transfer Initiated to King Amen Ra';
  } else if (/appointment|scheduled|meet|tomorrow|consultation/i.test(summary) || body.variables?.appointment_booked) {
    dispositionId = 'appointment_set';
    dispositionLabel = 'Medicare Review Scheduled';
  } else if (answeredBy === 'human' && durationSec > 30) {
    dispositionId = 'connected';
    dispositionLabel = 'Beneficiary Consultation / Qualified';
  }

  let activityId = act?.id;
  const bodyContent = `🤖 Bland AI Call Completed\n\n📌 Summary:\n${summary}\n\n🎙️ Answered By: ${answeredBy.toUpperCase()}\n⏱️ Duration: ${Math.round(durationSec / 60)}m ${durationSec % 60}s\n${recordingUrl ? `🎧 Recording: ${recordingUrl}\n` : ''}\n💬 Full Transcript:\n${transcript || 'No transcript generated.'}`;

  if (act) {
    await update('activities', act.id, {
      status: 'Completed',
      completed: true,
      duration_sec: durationSec,
      disposition_id: dispositionId,
      disposition: dispositionLabel,
      body: bodyContent,
      meta: {
        ...(act.meta || {}),
        recording_url: recordingUrl,
        transcript,
        summary,
        answered_by: answeredBy,
        duration_sec: durationSec,
        completed_at: new Date().toISOString(),
        warm_transferred: transferred,
      },
    });
  } else {
    const created = await insert('activities', {
      type: 'call',
      subject: `🤖 Bland AI Call — ${body.metadata?.prospect_name || 'Prospect'}`,
      body: bodyContent,
      related_type: body.metadata?.lead_id ? 'lead' : null,
      related_id: body.metadata?.lead_id || null,
      user_id: body.metadata?.user_id || 'u_principal',
      status: 'Completed',
      completed: true,
      duration_sec: durationSec,
      direction: 'outbound',
      phone: body.to || body.phone_number || null,
      provider: 'bland_ai',
      disposition_id: dispositionId,
      disposition: dispositionLabel,
      meta: {
        bland_call_id: callId,
        recording_url: recordingUrl,
        transcript,
        summary,
        answered_by: answeredBy,
        source: 'bland_ai',
        warm_transferred: transferred,
      },
    });
    activityId = created.id;
  }

  // Trigger CRM automation & pipeline update
  if (body.metadata?.lead_id) {
    try {
      const lead = await one(`SELECT * FROM leads WHERE id=$1`, [body.metadata.lead_id]);
      const callerUser = body.metadata?.user_id ? await one(`SELECT * FROM users WHERE id=$1`, [body.metadata.user_id]) : null;

      await applyDisposition({
        disposition: {
          id: dispositionId,
          label: dispositionLabel,
          category: 'outcome',
          color: '#3b82f6',
          icon: '🤖',
        },
        contact: lead,
        contactType: 'lead',
        user: (callerUser as any) || { id: 'u_principal', role: 'admin', name: 'Bland AI', email: 'king@iwillglobal.com', states: ['AZ'] },
        callDurationSec: durationSec,
        notes: `Bland AI Automation (${summary})`,
      });
    } catch (dispErr: any) {
      console.error('Error applying disposition in Bland webhook:', dispErr);
    }
  }

  return { success: true, message: 'Bland AI webhook processed successfully', activity_id: activityId };
}

export async function getBlandCallDetails(callId: string): Promise<any> {
  const cfg = await getBlandConfig();

  if (cfg.api_key && cfg.api_key !== 'simulated_test_key') {
    try {
      const res = await fetch(`https://api.bland.ai/v1/calls/${callId}`, {
        headers: { 'Authorization': cfg.api_key.trim() },
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err: any) {
      console.warn('Failed to fetch Bland AI call details from API:', err.message);
    }
  }

  const act = await one(`SELECT * FROM activities WHERE meta->>'bland_call_id' = $1`, [callId]);
  if (!act) return null;

  return {
    call_id: callId,
    phone_number: act.phone,
    status: act.status,
    recording_url: act.meta?.recording_url || null,
    concatenated_transcript: act.meta?.transcript || 'Transcript available once call completes.',
    summary: act.meta?.summary || act.body,
    duration: act.duration_sec,
    created_at: act.created_at,
    is_simulated: Boolean(act.meta?.is_simulated),
  };
}
