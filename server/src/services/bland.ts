import { one, insert, update, q } from '../db/index.ts';
import { config as appConfig } from '../config.ts';
import { toE164 } from './phone.ts';
import { applyDisposition } from './automation.ts';

export interface BlandConfig {
  api_key: string;
  enabled: boolean;
  pathway_id: string;
  github_repo: string;
  default_voice: string;
  model: 'base' | 'enhanced' | 'turbo';
  max_duration: number;
  record: boolean;
  wait_for_greeting: boolean;
  from_number: string;
  transfer_phone_number: string;
  prompt_template: string;
  webhook_url: string;
  calling_hours_start: number; // 9 (9:00 AM)
  calling_hours_end: number;   // 19 (7:00 PM)
  calling_days: string;        // 'Mon-Fri'
  daily_call_limit: number;    // 1000
  pause_on_warm_transfer: boolean;
  is_calling_paused: boolean;  // Legacy alias for is_on_warm_transfer
  is_on_warm_transfer: boolean; // True when King Amen Ra is on a warm transfer call -> Agent books ONLY Telephone, In-Person, or Video appointments and continues calling!
  is_campaign_active: boolean; // True when Bland Agent AI autonomous dialer is activated in CRM
  paused_reason?: string | null;
  active_transfer_lead_id?: string | null;
  active_transfer_call_id?: string | null;
  paused_at?: string | null;
  campaign_started_at?: string | null;
}

export const DEFAULT_BLAND_PATHWAY_ID = 'fc8c99c6-88c3-435d-952b-8c93c2db17a6';
export const DEFAULT_BLAND_CALLER_ID = '+15208415736';

export const ALLOWED_APPOINTMENT_TYPES = ['telephone', 'in_person', 'video'] as const;
export const ALLOWED_BLAND_APPOINTMENT_TYPES = ALLOWED_APPOINTMENT_TYPES;
export type AllowedAppointmentType = typeof ALLOWED_APPOINTMENT_TYPES[number];

export function normalizeAppointmentType(raw?: string | null): AllowedAppointmentType {
  const s = String(raw || '').trim().toLowerCase();
  if (s.includes('person') || s.includes('face') || s.includes('home') || s.includes('office') || s === 'in_person' || s === 'in-person') {
    return 'in_person';
  }
  if (s.includes('video') || s.includes('zoom') || s.includes('meet') || s.includes('virtual')) {
    return 'video';
  }
  return 'telephone';
}

export function formatAppointmentTypeLabel(type: AllowedAppointmentType): string {
  if (type === 'in_person') return 'In-Person';
  if (type === 'video') return 'Video';
  return 'Telephone';
}

export const DEFAULT_BLAND_PROMPT = `You are Sarah, calling from the Medicare Helpline powered by IWG Insurance and Financial Services, a licensed Medicare and insurance brokerage led by Principal Broker King Amen Ra (NPN: 16094432).
You are calling {prospect_name} regarding their Medicare benefits and 2027 plan options.

STRICT OPERATING RULES:
1. REQUIRED OPENING GREETING: Always introduce yourself clearly: "Hello, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"
2. CALLING HOURS & CONTINUOUS DIALING: Operate Monday through Friday, 9:00 AM to 7:00 PM local time (up to 1,000 calls per day), and continuously dial through the lead queue without stopping.
3. WHEN KING AMEN RA IS ON A WARM TRANSFER CALL ({warm_transfer_status}):
   - If King Amen Ra is currently on a warm transfer call (on_warm_transfer is true or broker_status is ON_WARM_TRANSFER), know that King Amen Ra is actively assisting another client on a live warm transfer call.
   - Do NOT pause or stop calling, and do NOT live-transfer the call while King Amen Ra is on a warm transfer call.
   - Instead, inform {prospect_name} that King Amen Ra is currently on a warm transfer call helping another client, and offer to schedule an appointment strictly from these THREE appointment types ONLY:
     1) Telephone Appointment (30 minutes)
     2) In-Person Appointment (60 minutes)
     3) Video Appointment (30 minutes)
   - Never offer or select any other appointment format — ONLY Telephone, In-Person, or Video.
   - Collect their preferred appointment type (Telephone, In-Person, or Video) and preferred day/time, confirm the booking, and end the call politely so you can immediately continue making calls!
4. WHEN KING AMEN RA IS AVAILABLE FOR LIVE WARM TRANSFER:
   - If King Amen Ra is NOT on a warm transfer call and {prospect_name} agrees to speak with a licensed advisor right now, route immediately to the "Connect to King Amen Ra" scenario to bridge the call to King Amen Ra (+16024569681).
   - If {prospect_name} prefers to schedule for later, only offer and select a Telephone, In-Person, or Video appointment.
5. PRIVACY & ZERO DISCLOSURE RULE: NEVER recite, speak, or give out our direct phone number or email address to the caller.`;

export const BLAND_VOICES = [
  { id: 'maya', name: 'Maya (Warm & Empathetic Female — Medicare Specialist)', gender: 'Female', accent: 'American', is_recommended: true },
  { id: 'ryan', name: 'Ryan (Trustworthy & Calm Male — Senior Advisor)', gender: 'Male', accent: 'American', is_recommended: true },
  { id: 'elena', name: 'Elena (Bilingual English / Spanish Female)', gender: 'Female', accent: 'American/Spanish', is_recommended: false },
  { id: 'mason', name: 'Mason (Clear & Articulate Male)', gender: 'Male', accent: 'American', is_recommended: false },
  { id: 'tina', name: 'Tina (Friendly & Patient Receptionist)', gender: 'Female', accent: 'American', is_recommended: false },
];

export async function getBlandConfig(): Promise<BlandConfig> {
  const row = await one(`SELECT value FROM settings WHERE key='bland_ai_config'`);
  const val = row?.value || {};
  const envKey = process.env.BLAND_API_KEY || '';

  // Also check if there is a live active warm transfer in the database right now
  let dbWarmTransferActive = false;
  let dbTransferLeadId: string | null = null;
  let dbTransferCallId: string | null = null;
  try {
    const activeTransfer = await one(
      `SELECT id, related_id, status FROM activities
       WHERE type='call'
         AND status IN ('Warm Transfer Ringing', 'Warm Transfer Briefing', '3-Way Conference Live')
         AND created_at >= now() - interval '2 hours'
       ORDER BY created_at DESC LIMIT 1`
    );
    if (activeTransfer) {
      dbWarmTransferActive = true;
      dbTransferCallId = activeTransfer.id;
      dbTransferLeadId = activeTransfer.related_id;
    }
  } catch {
    // ignore if table not ready
  }

  const isOnWarmTransfer = Boolean(val.is_on_warm_transfer ?? val.is_calling_paused ?? dbWarmTransferActive);

  return {
    api_key: val.api_key || envKey || '',
    enabled: val.enabled !== undefined ? Boolean(val.enabled) : true,
    pathway_id: val.pathway_id || process.env.BLAND_PATHWAY_ID || DEFAULT_BLAND_PATHWAY_ID,
    github_repo: val.github_repo || process.env.BLAND_GITHUB_REPO || 'https://github.com/KingAmenRa/iwillglobal-crm',
    default_voice: val.default_voice || 'maya',
    model: val.model || 'enhanced',
    max_duration: Number(val.max_duration) || 15,
    record: val.record !== undefined ? Boolean(val.record) : true,
    wait_for_greeting: val.wait_for_greeting !== undefined ? Boolean(val.wait_for_greeting) : true,
    from_number: val.from_number || DEFAULT_BLAND_CALLER_ID,
    transfer_phone_number: val.transfer_phone_number || '+16024569681',
    prompt_template: val.prompt_template || DEFAULT_BLAND_PROMPT,
    webhook_url: val.webhook_url || `${appConfig.appUrl}/api/bland/webhook`,
    calling_hours_start: val.calling_hours_start !== undefined ? Number(val.calling_hours_start) : 9,
    calling_hours_end: val.calling_hours_end !== undefined ? Number(val.calling_hours_end) : 19,
    calling_days: val.calling_days || 'Mon-Fri',
    daily_call_limit: Number(val.daily_call_limit) || 1000,
    pause_on_warm_transfer: val.pause_on_warm_transfer !== undefined ? Boolean(val.pause_on_warm_transfer) : true,
    is_calling_paused: isOnWarmTransfer,
    is_on_warm_transfer: isOnWarmTransfer,
    is_campaign_active: Boolean(val.is_campaign_active),
    paused_reason: val.paused_reason || (isOnWarmTransfer ? 'King Amen Ra is on a live Warm Transfer call — Agent is booking Telephone, In-Person, or Video appointments only and continuing to make calls' : null),
    active_transfer_lead_id: val.active_transfer_lead_id || dbTransferLeadId || null,
    active_transfer_call_id: val.active_transfer_call_id || dbTransferCallId || null,
    paused_at: val.paused_at || null,
    campaign_started_at: val.campaign_started_at || null,
  };
}

export async function saveBlandConfig(partial: Partial<BlandConfig>): Promise<BlandConfig> {
  const current = await getBlandConfig();
  const merged: BlandConfig = {
    ...current,
    ...partial,
    api_key: partial.api_key && partial.api_key.trim() !== '' ? partial.api_key.trim() : current.api_key,
  };
  if (partial.is_on_warm_transfer !== undefined) {
    merged.is_calling_paused = Boolean(partial.is_on_warm_transfer);
  } else if (partial.is_calling_paused !== undefined) {
    merged.is_on_warm_transfer = Boolean(partial.is_calling_paused);
  }

  await q(
    `INSERT INTO settings (key, value) VALUES ('bland_ai_config', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`,
    [JSON.stringify(merged)],
  );

  return merged;
}

/**
 * Check how many Bland AI outbound calls have been placed today (America/Phoenix time).
 */
export async function getCallsTodayCount(): Promise<number> {
  try {
    const row = await one(
      `SELECT count(*)::int AS cnt FROM activities
       WHERE type = 'call'
         AND provider = 'bland_ai'
         AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Phoenix') AT TIME ZONE 'America/Phoenix'`
    );
    return row?.cnt || 0;
  } catch {
    return 0;
  }
}

/**
 * Validate if Bland AI can currently dispatch a new outbound call:
 * IMPORTANT: When King Amen Ra is on a warm transfer call (`is_on_warm_transfer` / `is_calling_paused`),
 * outbound calling is NOT blocked! Instead, the agent continues making calls and strictly selects
 * Telephone, In-Person, or Video appointments!
 */
export async function canDispatchOutboundCall(override = false): Promise<{
  allowed: boolean;
  reason?: string;
  calls_today: number;
  daily_limit: number;
  is_paused: boolean;
  is_on_warm_transfer: boolean;
  is_campaign_active: boolean;
  operating_mode: 'WARM_TRANSFER_OR_APPOINTMENT' | 'APPOINTMENT_ONLY_TELEPHONE_IN_PERSON_VIDEO';
}> {
  const cfg = await getBlandConfig();
  const callsToday = await getCallsTodayCount();
  const limit = cfg.daily_call_limit || 1000;
  const isOnWarmTransfer = Boolean(cfg.is_on_warm_transfer || cfg.is_calling_paused);
  const operatingMode = isOnWarmTransfer
    ? 'APPOINTMENT_ONLY_TELEPHONE_IN_PERSON_VIDEO'
    : 'WARM_TRANSFER_OR_APPOINTMENT';

  if (callsToday >= limit && !override) {
    return {
      allowed: false,
      reason: `🛑 Daily call limit reached (${callsToday.toLocaleString()} / ${limit.toLocaleString()} calls today). Resumes tomorrow at 9:00 AM.`,
      calls_today: callsToday,
      daily_limit: limit,
      is_paused: false,
      is_on_warm_transfer: isOnWarmTransfer,
      is_campaign_active: cfg.is_campaign_active,
      operating_mode: operatingMode,
    };
  }

  // Check Mon-Fri 9:00 AM - 7:00 PM America/Phoenix
  const nowPhoenix = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' }));
  const day = nowPhoenix.getDay(); // 0 = Sun, 6 = Sat
  const hour = nowPhoenix.getHours();

  const isWeekday = day >= 1 && day <= 5;
  const isWithinHours = hour >= (cfg.calling_hours_start || 9) && hour < (cfg.calling_hours_end || 19);

  if ((!isWeekday || !isWithinHours) && !override) {
    return {
      allowed: false,
      reason: `🕘 Outside Bland AI calling window (Monday–Friday, 9:00 AM – 7:00 PM MST). Pass override=true to test outside hours.`,
      calls_today: callsToday,
      daily_limit: limit,
      is_paused: false,
      is_on_warm_transfer: isOnWarmTransfer,
      is_campaign_active: cfg.is_campaign_active,
      operating_mode: operatingMode,
    };
  }

  return {
    allowed: true,
    reason: isOnWarmTransfer
      ? '🔥 King Amen Ra is on a Warm Transfer Call — Bland Agent AI is continuing to make calls and strictly booking Telephone, In-Person, or Video appointments only.'
      : undefined,
    calls_today: callsToday,
    daily_limit: limit,
    is_paused: false,
    is_on_warm_transfer: isOnWarmTransfer,
    is_campaign_active: cfg.is_campaign_active,
    operating_mode: operatingMode,
  };
}

/**
 * Set whether King Amen Ra is currently on a warm transfer call.
 * When active=true, the Bland AI Agent DOES NOT STOP CALLING — it knows King is on a warm transfer call,
 * strictly selects Telephone, In-Person, or Video appointments only, and continues calling the queue!
 */
export async function setWarmTransferStatus(params: {
  on_warm_transfer: boolean;
  lead_id?: string | null;
  call_id?: string | null;
  reason?: string;
}): Promise<BlandConfig> {
  return saveBlandConfig({
    is_on_warm_transfer: params.on_warm_transfer,
    is_calling_paused: params.on_warm_transfer,
    paused_reason: params.on_warm_transfer
      ? (params.reason || 'King Amen Ra is on a Warm Transfer call — Agent is booking Telephone, In-Person, or Video appointments only & continuing to make calls')
      : null,
    active_transfer_lead_id: params.on_warm_transfer ? (params.lead_id || null) : null,
    active_transfer_call_id: params.on_warm_transfer ? (params.call_id || null) : null,
    paused_at: params.on_warm_transfer ? new Date().toISOString() : null,
  });
}

/**
 * Backwards-compatible helper called when a warm transfer is initiated.
 * Sets `is_on_warm_transfer = true` so the Bland Agent AI knows King is on a warm transfer call,
 * switches to booking ONLY Telephone, In-Person, or Video appointments, and continues calling!
 */
export async function pauseCallingForWarmTransfer(params: {
  lead_id?: string | null;
  call_id?: string | null;
  reason?: string;
}): Promise<BlandConfig> {
  return setWarmTransferStatus({
    on_warm_transfer: true,
    lead_id: params.lead_id,
    call_id: params.call_id,
    reason: params.reason || 'King Amen Ra is on a live warm transfer call — Booking Telephone, In-Person, or Video appointments only & continuing calls',
  });
}

/**
 * Called when King Amen Ra finishes a warm transfer consultation and dispositions the lead.
 * Returns the Bland Agent AI to live warm-transfer capability while continuing outbound calls.
 */
export async function resumeCallingAfterDisposition(params?: {
  lead_id?: string | null;
  disposition?: string;
}): Promise<BlandConfig> {
  return setWarmTransferStatus({
    on_warm_transfer: false,
    lead_id: null,
    call_id: null,
  });
}

/**
 * Activate or stop the autonomous Bland Agent AI outbound calling campaign from the CRM.
 */
export async function setBlandCampaignActive(active: boolean, options?: {
  on_warm_transfer?: boolean;
  user?: { id: string; name: string; email?: string; role: string };
  max_initial_calls?: number;
}): Promise<{
  config: BlandConfig;
  dispatched_calls: any[];
  queue_remaining: number;
}> {
  const updates: Partial<BlandConfig> = {
    is_campaign_active: active,
    campaign_started_at: active ? new Date().toISOString() : null,
  };
  if (options?.on_warm_transfer !== undefined) {
    updates.is_on_warm_transfer = options.on_warm_transfer;
    updates.is_calling_paused = options.on_warm_transfer;
    updates.paused_reason = options.on_warm_transfer
      ? 'King Amen Ra is on a Warm Transfer call — Agent is booking Telephone, In-Person, or Video appointments only & continuing to make calls'
      : null;
  }

  const updatedConfig = await saveBlandConfig(updates);
  const dispatchedCalls: any[] = [];
  let queueRemaining = 0;

  if (active && options?.user) {
    const batchResult = await dispatchNextLeadInQueue({
      user: options.user,
      count: options.max_initial_calls || 1,
      override: true,
    });
    dispatchedCalls.push(...batchResult.dispatched);
    queueRemaining = batchResult.remaining;
  } else {
    const countRow = await one(
      `SELECT count(*)::int AS cnt FROM leads
       WHERE dnc = false AND phone_invalid = false
         AND phone IS NOT NULL AND trim(phone) != ''
         AND status NOT IN ('Converted', 'DNC', 'Unqualified', 'Appointment Set')`
    );
    queueRemaining = countRow?.cnt || 0;
  }

  return {
    config: updatedConfig,
    dispatched_calls: dispatchedCalls,
    queue_remaining: queueRemaining,
  };
}

/**
 * Pull the next callable lead(s) from the CRM queue and dispatch Bland Agent AI calls.
 */
export async function dispatchNextLeadInQueue(params: {
  user: { id: string; name: string; email?: string; role: string };
  count?: number;
  override?: boolean;
  on_warm_transfer?: boolean;
}): Promise<{ dispatched: any[]; remaining: number }> {
  const limit = Math.min(Math.max(Number(params.count) || 1, 1), 10);
  const leads = await q(
    `SELECT * FROM leads
     WHERE dnc = false AND phone_invalid = false
       AND phone IS NOT NULL AND trim(phone) != ''
       AND status NOT IN ('Converted', 'DNC', 'Unqualified', 'Appointment Set')
     ORDER BY (next_callback_at IS NOT NULL AND next_callback_at <= now()) DESC,
              score DESC,
              attempts ASC,
              created_at DESC
     LIMIT ${limit}`
  );

  const dispatched: any[] = [];
  for (const lead of leads) {
    try {
      const res = await sendBlandCall({
        phone: lead.phone,
        related_type: 'lead',
        related_id: lead.id,
        prospect_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Valued Beneficiary',
        state: lead.state || 'AZ',
        user: params.user,
        override_pause: params.override ?? true,
        on_warm_transfer: params.on_warm_transfer,
      });
      dispatched.push({
        lead_id: lead.id,
        lead_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
        phone: lead.phone,
        call_id: res.call_id,
        simulated: res.simulated,
        on_warm_transfer: res.on_warm_transfer,
        allowed_appointment_types: res.allowed_appointment_types,
      });
    } catch (err: any) {
      console.error(`Failed to dispatch Bland call for lead ${lead.id}:`, err.message);
    }
  }

  const remRow = await one(
    `SELECT count(*)::int AS cnt FROM leads
     WHERE dnc = false AND phone_invalid = false
       AND phone IS NOT NULL AND trim(phone) != ''
       AND status NOT IN ('Converted', 'DNC', 'Unqualified', 'Appointment Set')`
  );

  return {
    dispatched,
    remaining: Math.max(0, (remRow?.cnt || 0) - dispatched.length),
  };
}

export interface SendBlandCallOptions {
  phone: string;
  related_type?: 'lead' | 'client';
  related_id?: string;
  prospect_name?: string;
  state?: string;
  custom_prompt?: string;
  voice?: string;
  pathway_id?: string;
  first_sentence?: string;
  transfer_phone_number?: string;
  override_pause?: boolean;
  on_warm_transfer?: boolean;
  preferred_appointment_type?: AllowedAppointmentType;
  user: { id: string; name: string; email?: string; role: string };
}

export async function sendBlandCall(opts: SendBlandCallOptions) {
  const config = await getBlandConfig();
  const e164 = toE164(opts.phone);
  if (!e164) {
    throw Object.assign(new Error('Invalid phone number for Bland AI call'), { status: 400 });
  }

  // Verify calling window & daily limit (Note: warm transfer active does NOT block calling; it switches to Appointment-Only Mode!)
  const gate = await canDispatchOutboundCall(Boolean(opts.override_pause));
  if (!gate.allowed) {
    throw Object.assign(new Error(gate.reason || 'Outbound calling is currently outside window or at limit'), {
      status: 409,
      code: 'CALLING_GATE_RESTRICTED',
      gate,
    });
  }

  const isOnWarmTransfer = opts.on_warm_transfer !== undefined
    ? Boolean(opts.on_warm_transfer)
    : Boolean(config.is_on_warm_transfer || config.is_calling_paused);

  const prospectName = opts.prospect_name || 'Valued Medicare Beneficiary';
  const firstName = prospectName.split(' ')[0] || 'there';
  const pathwayId = opts.pathway_id || config.pathway_id || DEFAULT_BLAND_PATHWAY_ID;
  const transferNumber = opts.transfer_phone_number || config.transfer_phone_number || '+16024569681';

  const warmTransferStatusText = isOnWarmTransfer
    ? 'ACTIVE — King Amen Ra is currently on a live Warm Transfer call with another client. DO NOT live-transfer this call. Instead, inform the caller that King Amen Ra is on a warm transfer call and ONLY offer/select a Telephone, In-Person, or Video appointment, book their preferred date/time, and continue making calls!'
    : 'AVAILABLE — King Amen Ra is available for an immediate live warm transfer if the caller agrees to speak with a licensed advisor right now, or you may schedule a Telephone, In-Person, or Video appointment.';

  const prompt = (opts.custom_prompt || config.prompt_template || DEFAULT_BLAND_PROMPT)
    .replace(/\{prospect_name\}/g, prospectName)
    .replace(/\{first_name\}/g, firstName)
    .replace(/\{state\}/g, opts.state || 'Arizona')
    .replace(/\{warm_transfer_status\}/g, warmTransferStatusText);

  const firstSentence = opts.first_sentence ||
    `Hello, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?`;

  const voice = opts.voice || config.default_voice || 'maya';

  let blandCallId = `bland_sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let isSimulated = true;
  let apiResponse: any = { status: 'simulated', message: 'Bland AI call simulated (Add BLAND_API_KEY in Settings for live carrier calls)' };

  if (config.api_key && config.api_key.trim().length > 10) {
    const isV2Agent = pathwayId === 'fc8c99c6-88c3-435d-952b-8c93c2db17a6' || !opts.custom_prompt;
    // Ensure caller ID is a valid Bland number owned by the organization (+15208415736)
    const blandFrom = (config.from_number && config.from_number !== '+16024569681')
      ? config.from_number
      : DEFAULT_BLAND_CALLER_ID;

    const requestDataPayload = {
      prospect_name: prospectName,
      first_name: firstName,
      state: opts.state || 'AZ',
      agency: 'Medicare Helpline powered by IWG Insurance and Financial Services',
      principal_broker: 'King Amen Ra',
      on_warm_transfer: isOnWarmTransfer ? 'true' : 'false',
      broker_busy_on_warm_transfer: isOnWarmTransfer,
      broker_status: isOnWarmTransfer ? 'ON_WARM_TRANSFER' : 'AVAILABLE',
      allowed_appointment_types: 'Telephone, In-Person, Video',
      appointment_types_list: ['Telephone', 'In-Person', 'Video'],
      preferred_appointment_type: opts.preferred_appointment_type ? formatAppointmentTypeLabel(opts.preferred_appointment_type) : undefined,
      operating_instruction: isOnWarmTransfer
        ? 'IMPORTANT: King Amen Ra is currently on a warm transfer call with another client. Do NOT transfer this call. Let the caller know King Amen Ra is currently on a warm transfer call, and ONLY offer and select a Telephone, In-Person, or Video appointment. Collect their choice of Telephone, In-Person, or Video and preferred date/time, confirm it, and end the call so the system continues making calls!'
        : 'King Amen Ra is available for live transfer via the Connect to King Amen Ra scenario, or you can book strictly a Telephone, In-Person, or Video appointment.',
    };

    const metadataPayload = {
      crm_source: 'iwg_crm',
      related_type: opts.related_type || 'lead',
      related_id: opts.related_id || '',
      initiated_by_user_id: opts.user.id,
      initiated_by_name: opts.user.name,
      pathway_id: pathwayId,
      on_warm_transfer: isOnWarmTransfer,
      allowed_appointment_types: ['telephone', 'in_person', 'video'],
    };

    // Build payload for POST https://api.bland.ai/v1/calls
    // Note: When dispatching a V2 Agent (`agent_id`), Bland's API requires omitting `task` / `pathway_id` so they do not conflict with `agent_id`.
    const v2Payload: Record<string, any> = {
      phone_number: e164,
      agent_id: 'fc8c99c6-88c3-435d-952b-8c93c2db17a6',
      agent_version: 'dev',
      from: blandFrom,
      max_duration: config.max_duration || 15,
      record: config.record !== false,
      request_data: requestDataPayload,
      metadata: metadataPayload,
    };

    if (config.webhook_url && config.webhook_url.startsWith('https://')) {
      v2Payload.webhook = config.webhook_url;
    }

    const r = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        'Authorization': config.api_key.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(isV2Agent ? v2Payload : {
        phone_number: e164,
        task: prompt,
        voice,
        first_sentence: firstSentence,
        model: config.model || 'enhanced',
        max_duration: config.max_duration || 15,
        record: config.record !== false,
        from: blandFrom,
        transfer_phone_number: isOnWarmTransfer ? undefined : transferNumber,
        request_data: requestDataPayload,
        metadata: metadataPayload,
      }),
    });

    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || data.status === 'error') {
      throw Object.assign(
        new Error(data.message || data.error || (Array.isArray(data.errors) ? data.errors.join(', ') : `Bland AI API error (${r.status})`)),
        { status: r.status || 500 },
      );
    }

    blandCallId = data.call_id || blandCallId;
    isSimulated = false;
    apiResponse = data;
  }

  // Log activity in CRM
  const activity = await insert('activities', {
    type: 'call',
    subject: `🤖 Bland AI Voice Call (${isOnWarmTransfer ? 'Appt-Only Mode: Phone/In-Person/Video' : 'Live Transfer + Appt Mode'}) — ${prospectName}`,
    body: isSimulated
      ? `[Simulated Bland AI Call — Voice: ${voice}] ${isOnWarmTransfer ? '[Warm Transfer Active: Booking Telephone / In-Person / Video Appts Only]' : ''}\nOpening: "${firstSentence}"`
      : `Bland AI autonomous outbound voice agent dispatched (Voice: ${voice}, Call ID: ${blandCallId}). Mode: ${isOnWarmTransfer ? 'King on Warm Transfer -> Book Telephone, In-Person, or Video Appointment Only & Continue Calling' : 'Live Transfer or Appointment'}.`,
    related_type: opts.related_type || 'lead',
    related_id: opts.related_id || null,
    user_id: opts.user.id,
    status: isSimulated ? 'Completed' : 'In Progress',
    completed: isSimulated,
    direction: 'outbound',
    phone: e164,
    provider: 'bland_ai',
    disposition_id: 'call_attempted',
    disposition: isSimulated ? 'Bland AI Call (Simulated)' : 'Bland AI Call Dispatched',
    duration_sec: isSimulated ? 45 : 0,
    meta: {
      bland_call_id: blandCallId,
      pathway_id: pathwayId,
      voice,
      simulated: isSimulated,
      on_warm_transfer: isOnWarmTransfer,
      allowed_appointment_types: ['telephone', 'in_person', 'video'],
      continue_calling_after_call: true,
      started_at: new Date().toISOString(),
      prompt_used: prompt,
      first_sentence: firstSentence,
      bland_response: apiResponse,
    },
  });

  // Update lead status if applicable
  if (opts.related_type === 'lead' && opts.related_id) {
    const lead = await one(`SELECT * FROM leads WHERE id=$1`, [opts.related_id]);
    if (lead) {
      await update('leads', lead.id, {
        attempts: (lead.attempts || 0) + 1,
        last_contacted_at: new Date(),
        last_disposition: isSimulated ? 'Bland AI Call (Simulated)' : 'Bland AI Calling...',
        status: lead.status === 'New' ? 'Contacted' : lead.status,
        updated_at: new Date(),
      });
    }
  }

  return {
    ok: true,
    call_id: blandCallId,
    pathway_id: pathwayId,
    simulated: isSimulated,
    on_warm_transfer: isOnWarmTransfer,
    operating_mode: isOnWarmTransfer ? 'APPOINTMENT_ONLY_TELEPHONE_IN_PERSON_VIDEO' : 'WARM_TRANSFER_OR_APPOINTMENT',
    allowed_appointment_types: ['Telephone', 'In-Person', 'Video'],
    activity,
    bland_response: apiResponse,
  };
}

/**
 * Fetch live call status and transcript from Bland AI API
 */
export async function getBlandCallDetails(blandCallId: string) {
  const config = await getBlandConfig();
  const localActivity = await one(
    `SELECT * FROM activities WHERE meta->>'bland_call_id' = $1 ORDER BY created_at DESC LIMIT 1`,
    [blandCallId],
  );

  if (blandCallId.startsWith('bland_sim_') || !config.api_key) {
    const wasOnWarmTransfer = Boolean(localActivity?.meta?.on_warm_transfer || config.is_on_warm_transfer);
    return {
      call_id: blandCallId,
      status: 'completed',
      completed: true,
      simulated: true,
      call_length: 1.2,
      to: localActivity?.phone || '',
      from: config.from_number,
       recording_url: null,
      Variables: {
        appointment_type: 'Telephone',
        appointment_datetime: 'Tomorrow at 10:00 AM MST',
        on_warm_transfer: wasOnWarmTransfer,
      },
      concatenated_transcript: wasOnWarmTransfer
        ? `Agent (Sarah): Hello, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?\nProspect: I'm doing well, thank you. I have a few questions about the new 2027 Medicare options.\nAgent (Sarah): I would love to help with that! King Amen Ra, our Principal Broker and Licensed Senior Advisor, is currently on a live warm transfer call helping another client right now, so I can get you scheduled right on his calendar. Would you prefer a Telephone appointment, an In-Person appointment, or a Video appointment?\nProspect: A Telephone appointment works best for me.\nAgent (Sarah): Wonderful! I have you down for a 30-minute Telephone appointment tomorrow at 10:00 AM Arizona time with King Amen Ra. Thank you and have a wonderful day!`
        : `Agent (Sarah): Hello, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?\nProspect: Doing well, thanks. Yes, I was looking at the new 2027 plans.\nAgent (Sarah): Wonderful! Our Principal Broker and Licensed Senior Advisor, King Amen Ra, can review your doctors and prescriptions side-by-side at zero cost. I am connecting you right now directly with King Amen Ra.`,
      summary: wasOnWarmTransfer
        ? 'King Amen Ra was on an active warm transfer call. Sarah informed the prospect, offered strictly Telephone, In-Person, or Video appointments, booked a Telephone appointment for tomorrow at 10:00 AM MST, and continued dialing the queue.'
        : 'Prospect expressed interest in a 2027 Medicare plan review and agreed to speak with Principal Broker King Amen Ra.',
      activity: localActivity,
    };
  }

  const r = await fetch(`https://api.bland.ai/v1/calls/${encodeURIComponent(blandCallId)}`, {
    headers: { 'Authorization': config.api_key.trim() },
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw Object.assign(new Error(data.message || 'Failed to fetch Bland call details'), { status: r.status });
  }

  return {
    ...data,
    activity: localActivity,
  };
}

/**
 * Process incoming Bland AI Webhook when an autonomous call finishes
 */
export async function handleBlandWebhook(payload: any) {
  const callId = payload.call_id || payload.c_id;
  if (!callId) return { ok: false, reason: 'missing_call_id' };

  const transcript: string = payload.concatenated_transcript ||
    (Array.isArray(payload.transcripts) ? payload.transcripts.map((t: any) => `${t.user}: ${t.text}`).join('\n') : '');
  const summary: string = payload.summary || '';
  const durationSec = Math.round((Number(payload.call_length) || 0) * 60);
  const recordingUrl = payload.recording_url || null;
  const answeredBy = payload.answered_by || 'human';
  const variables = payload.variables || payload.analysis || {};
  const metadata = payload.metadata || {};

  // Determine disposition from transcript / analysis
  const lowerText = `${transcript} ${summary} ${JSON.stringify(variables)}`.toLowerCase();
  let dispositionId = 'contacted_interested';
  let dispositionLabel = 'Bland AI — Qualified / Interested';

  const transferred = Boolean(payload.transferred_to || variables.transferred || /transferring you|connecting you|hold while i connect|bridge your call/i.test(lowerText));
  const bookedAppt = Boolean(
    variables.appointment_booked ||
    variables.appointment_time ||
    variables.appointment_datetime ||
    variables.appointment_type ||
    /scheduled|appointment set|booked for|calendar|telephone appointment|in-person appointment|in person appointment|video appointment/i.test(lowerText)
  );

  // Strictly normalize appointment type to ONE of the 3 allowed types: 'telephone' | 'in_person' | 'video'
  const rawApptType = variables.appointment_type ||
    (/in-person|in person|face to face|home visit|office visit/i.test(lowerText) ? 'in_person' :
     /video|google meet|zoom/i.test(lowerText) ? 'video' : 'telephone');
  const selectedApptType: AllowedAppointmentType = normalizeAppointmentType(rawApptType);
  const selectedApptLabel = formatAppointmentTypeLabel(selectedApptType);

  if (answeredBy === 'voicemail' || /voicemail|leave a message/i.test(lowerText)) {
    dispositionId = 'voicemail_left';
    dispositionLabel = 'Bland AI — Voicemail Left';
  } else if (/do not call|take me off|remove my number|stop calling/i.test(lowerText)) {
    dispositionId = 'dnc_request';
    dispositionLabel = 'Bland AI — Do Not Call Request';
  } else if (transferred && !metadata.on_warm_transfer) {
    dispositionId = 'warm_transfer_success';
    dispositionLabel = 'Bland AI — Live Warm Transfer to King Amen Ra';
    // Mark that King Amen Ra is now on a warm transfer call so subsequent calls book Telephone, In-Person, or Video appointments and continue dialing!
    await setWarmTransferStatus({
      on_warm_transfer: true,
      lead_id: metadata.related_id || null,
      call_id: callId,
      reason: `King Amen Ra is on a live Warm Transfer call (Call ${callId}) — Subsequent calls will book Telephone, In-Person, or Video appointments only and continue dialing.`,
    });
  } else if (bookedAppt || metadata.on_warm_transfer) {
    dispositionId = 'appointment_set';
    dispositionLabel = `Bland AI — ${selectedApptLabel} Appointment Booked`;
  } else if (/not interested|already have|no thank you/i.test(lowerText)) {
    dispositionId = 'not_interested';
    dispositionLabel = 'Bland AI — Not Interested';
  }

  let activity = await one(
    `SELECT * FROM activities WHERE meta->>'bland_call_id' = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );

  const relatedType = activity?.related_type || metadata.related_type || 'lead';
  const relatedId = activity?.related_id || metadata.related_id || null;
  const userId = activity?.user_id || metadata.initiated_by_user_id || 'u_principal';

  const bodyText = [
    summary ? `📋 AI Call Summary:\n${summary}` : '',
    dispositionId === 'appointment_set' ? `📅 Selected Appointment Type: ${selectedApptLabel} (${selectedApptType === 'in_person' ? '60m In-Person' : selectedApptType === 'video' ? '30m Video' : '30m Telephone'})${variables.appointment_datetime ? ` — Requested Time: ${variables.appointment_datetime}` : ''}` : '',
    recordingUrl ? `🔊 Recording: ${recordingUrl}` : '',
    transcript ? `\n💬 Full Transcript:\n${transcript}` : '',
  ].filter(Boolean).join('\n\n');

  if (activity) {
    activity = await update('activities', activity.id, {
      status: 'Completed',
      completed: true,
      disposition_id: dispositionId,
      disposition: dispositionLabel,
      duration_sec: durationSec || 30,
      body: bodyText || activity.body,
      ai_summary: summary || null,
      meta: {
        ...(activity.meta || {}),
        ended_at: new Date().toISOString(),
        recording_url: recordingUrl,
        answered_by: answeredBy,
        transcript,
        summary,
        variables,
        selected_appointment_type: selectedApptType,
        selected_appointment_label: selectedApptLabel,
      },
    });
  } else {
    activity = await insert('activities', {
      type: 'call',
      subject: `🤖 Bland AI Call — ${dispositionLabel}`,
      body: bodyText,
      related_type: relatedType,
      related_id: relatedId,
      user_id: userId,
      status: 'Completed',
      completed: true,
      direction: 'outbound',
      phone: toE164(payload.to || payload.phone_number || ''),
      provider: 'bland_ai',
      disposition_id: dispositionId,
      disposition: dispositionLabel,
      duration_sec: durationSec || 30,
      ai_summary: summary || null,
      meta: {
        bland_call_id: callId,
        recording_url: recordingUrl,
        answered_by: answeredBy,
        transcript,
        summary,
        variables,
        selected_appointment_type: selectedApptType,
        selected_appointment_label: selectedApptLabel,
        ended_at: new Date().toISOString(),
      },
    });
  }

  // If an appointment was booked (or King was on a warm transfer and the caller engaged), create the calendar appointment activity automatically!
  if (dispositionId === 'appointment_set' && relatedId) {
    const startAt = new Date(Date.now() + 24 * 3600 * 1000);
    startAt.setHours(10, 0, 0, 0);
    const durMin = selectedApptType === 'in_person' ? 60 : 30;
    const endAt = new Date(startAt.getTime() + durMin * 60000);

    await insert('activities', {
      type: 'event',
      subject: `📅 ${selectedApptLabel} Appointment (Booked by Bland AI) — ${variables.first_name || 'Prospect'}`,
      body: `Bland Agent AI scheduled a ${selectedApptLabel} (${durMin} min) appointment with Principal Broker King Amen Ra.\nRequested Date/Time: ${variables.appointment_datetime || 'Next Available Day 10:00 AM MST'}\nSummary: ${summary || 'Qualified on outbound AI call'}`,
      related_type: relatedType,
      related_id: relatedId,
      user_id: userId,
      assigned_to: 'u_principal',
      due_at: startAt,
      end_at: endAt,
      status: 'Scheduled',
      completed: false,
      meta: {
        booked_by_user_id: userId,
        booked_by_name: 'Sarah (Bland AI Voice Agent)',
        appointment_type: selectedApptType,
        appointment_type_label: selectedApptLabel,
        requested_datetime_raw: variables.appointment_datetime || null,
        bland_call_id: callId,
        booked_during_warm_transfer: Boolean(metadata.on_warm_transfer),
        master_calendar_email: 'info@iwillglobal.com',
      },
    });
  }

  // Trigger CRM automations if linked to a lead or client
  if (relatedId) {
    const dispRow = await one(`SELECT * FROM dispositions WHERE id=$1`, [dispositionId]);
    const userRow = await one(`SELECT id, name, email, role FROM users WHERE id=$1`, [userId]) ||
      { id: 'u_principal', name: 'King Amen Ra', email: 'king@iwillglobal.com', role: 'admin' };

    if (dispRow) {
      await applyDisposition({
        user: userRow,
        call: activity,
        disposition: dispRow,
        relatedType,
        relatedId,
      }).catch(() => {});
    }
  }

  // CONTINUOUS DIALING: If autonomous campaign is active in the CRM, automatically dispatch the next call in the queue!
  const currentCfg = await getBlandConfig();
  let nextDispatched: any = null;
  if (currentCfg.is_campaign_active) {
    const userRow = await one(`SELECT id, name, email, role FROM users WHERE id=$1`, [userId]) ||
      { id: 'u_principal', name: 'King Amen Ra', email: 'king@iwillglobal.com', role: 'admin' };
    const nextBatch = await dispatchNextLeadInQueue({
      user: userRow,
      count: 1,
      override: false,
    }).catch(() => ({ dispatched: [], remaining: 0 }));
    if (nextBatch.dispatched.length > 0) {
      nextDispatched = nextBatch.dispatched[0];
    } else if (nextBatch.remaining === 0) {
      await saveBlandConfig({ is_campaign_active: false });
    }
  }

  const { publish } = await import('../realtime.ts');
  publish('inbox', 'bland_call_completed', {
    call_id: callId,
    activity_id: activity.id,
    related_id: relatedId,
    disposition: dispositionLabel,
    appointment_type: selectedApptType,
    appointment_label: selectedApptLabel,
    summary,
    next_call_dispatched: nextDispatched,
  });

  return {
    ok: true,
    activity_id: activity.id,
    disposition: dispositionLabel,
    appointment_type: selectedApptType,
    next_call_dispatched: nextDispatched,
  };
}
