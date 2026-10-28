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
  updated_at?: string;
}

export const DEFAULT_BLAND_PATHWAY_ID = '3b13b658-e85d-4d14-a24a-868b61040c42';

export const DEFAULT_BLAND_PROMPT = `You are Sarah, an outbound scheduling assistant calling on behalf of the Medicare Helpline by I Will Global.
Your tone is warm, polite, professional, and patient with senior beneficiaries.
You are calling {prospect_name} who requested information regarding Medicare options, Turning 65 Initial Enrollment, or the upcoming Medicare Annual Election Period (AEP).

KEY COMPLIANCE & OPERATIONAL RULES:
1. TPMO Disclaimer: "We do not offer every plan available in your area. Currently we represent 7 major Medicare organizations which offer over 50 products in your area. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Program (SHIP) to get information on all of your options."
2. You are an appointment setter, NOT a licensed insurance agent. DO NOT quote specific plan prices, carrier advantages, or specific formulary coverage details.
3. Your primary objective: Verify if they have questions about Medicare Part A, Part B, Medigap Plan G/N, or Medicare Advantage, and arrange a direct live consultation with state-licensed broker King Amen Ra (Principal Broker & Licensed Agent, NPN 16094432).
4. If the prospect says YES or agrees to speak with a licensed agent, or has time right now, IMMEDIATELY connect them directly to King Amen Ra. Say: "I am connecting you right now with King Amen Ra, our licensed senior Medicare advisor. Please stay on the line." and trigger the live transfer immediately.
5. NEVER recite, speak, or disclose our direct phone number or email address to the caller under any circumstances.
6. If the beneficiary prefers an appointment, ask for their preferred day and time (morning or afternoon).
7. If the beneficiary states they are already happy with their plan or not interested, thank them politely and wish them a wonderful day.
8. If the beneficiary says "Do not call" or "Remove me", immediately confirm: "Understood, I will place your number on our Do Not Call list right now. Have a good day." and conclude.`;

export async function getBlandConfig(): Promise<BlandConfig> {
  try {
    // Graceful column migration for existing tables
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS pathway_id TEXT DEFAULT '3b13b658-e85d-4d14-a24a-868b61040c42'`).catch(() => {});
    await q(`ALTER TABLE bland_config ADD COLUMN IF NOT EXISTS github_repo TEXT`).catch(() => {});

    const row = await one<BlandConfig>(`SELECT * FROM bland_config WHERE id='main'`);
    if (row) {
      return {
        ...row,
        pathway_id: row.pathway_id || DEFAULT_BLAND_PATHWAY_ID,
        github_repo: row.github_repo || null,
        api_key: row.api_key || process.env.BLAND_API_KEY || null,
        prompt_template: row.prompt_template || DEFAULT_BLAND_PROMPT,
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

  await q(`
    INSERT INTO bland_config (id, api_key, enabled, pathway_id, github_repo, default_voice, model, language, from_number, transfer_phone_number, prompt_template, webhook_url, updated_at)
    VALUES ('main', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
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
      updated_at = now()
  `, [apiKey, enabled, pathwayId, githubRepo, defaultVoice, model, language, fromNumber, transferPhoneNumber, promptTemplate, webhookUrl]);

  return getBlandConfig();
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
}): Promise<{
  success: boolean;
  call_id: string;
  activity_id: string;
  status: string;
  message: string;
  simulated?: boolean;
}> {
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

  const firstSentence = options.firstSentence || `Hello ${prospectName.split(' ')[0]}, this is Sarah calling with the Medicare Helpline at I Will Global. How are you today?`;

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
  const transferred = Boolean(body.transferred_to || body.transfer_destination || (transcript && /transferring you|connected to agent/i.test(transcript)));

  // Determine disposition
  let dispositionId = 'call_attempted';
  let dispositionLabel = 'Call Placed / Outbound Dial';

  if (answeredBy === 'voicemail') {
    dispositionId = 'voicemail';
    dispositionLabel = 'Left Voicemail';
  } else if (transferred) {
    dispositionId = 'warm_transfer_success';
    dispositionLabel = 'Warm Transfer Complete';
  } else if (/appointment|scheduled|meet|tomorrow|consultation/i.test(summary) || body.variables?.appointment_booked) {
    dispositionId = 'appointment_set';
    dispositionLabel = 'Appointment Set';
  } else if (/not interested|remove|stop calling/i.test(transcript + ' ' + summary)) {
    dispositionId = 'not_interested';
    dispositionLabel = 'Not Interested';
  } else if (/do not call|dnc/i.test(transcript + ' ' + summary)) {
    dispositionId = 'dnc';
    dispositionLabel = 'Do Not Call';
  } else if (transcript.length > 50) {
    dispositionId = 'interested';
    dispositionLabel = 'Connected – Interested';
  }

  const updatedMeta = {
    ...(act?.meta || {}),
    bland_call_id: callId,
    recording_url: recordingUrl,
    transcript,
    summary,
    answered_by: answeredBy,
    transferred,
    ended_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    variables: body.variables || {},
    call_ended_reason: body.call_ended_reason || 'completed',
  };

  const bodyContent = `🤖 Bland AI Call Completed\n\n📌 Summary:\n${summary}\n\n🎙️ Answered By: ${answeredBy.toUpperCase()}\n⏱️ Duration: ${Math.round(durationSec / 60)}m ${durationSec % 60}s\n${recordingUrl ? `🎧 Recording: ${recordingUrl}\n` : ''}\n💬 Full Transcript:\n${transcript || 'No transcript generated.'}`;

  let activityId = act?.id;
  if (act) {
    await update('activities', act.id, {
      status: 'Completed',
      completed: true,
      duration_sec: durationSec,
      disposition_id: dispositionId,
      disposition: dispositionLabel,
      body: bodyContent,
      meta: updatedMeta,
    });
  } else {
    const inserted = await insert('activities', {
      type: 'call',
      subject: `🤖 Bland AI Call — ${body.metadata?.prospect_name || 'Prospect'}`,
      body: bodyContent,
      related_type: body.metadata?.lead_id ? 'lead' : null,
      related_id: body.metadata?.lead_id || null,
      user_id: body.metadata?.user_id || 'u_principal',
      status: 'Completed',
      completed: true,
      direction: 'outbound',
      phone: body.to || body.phone_number || '',
      provider: 'bland_ai',
      duration_sec: durationSec,
      disposition_id: dispositionId,
      disposition: dispositionLabel,
      meta: updatedMeta,
    });
    activityId = inserted.id;
  }

  // Automate lead updates if lead_id present
  const leadId = body.metadata?.lead_id || act?.related_id;
  if (leadId) {
    try {
      const disp = await one(`SELECT * FROM dispositions WHERE id=$1`, [dispositionId]);
      if (disp) {
        const callerUser = await one<any>(`SELECT * FROM users WHERE id=$1`, [body.metadata?.user_id || act?.user_id || 'u_principal']);
        await applyDisposition({
          user: (callerUser as any) || { id: 'u_principal', role: 'admin', name: 'Bland AI', email: 'king@iwillglobal.com', states: ['AZ'] },
          call: { id: activityId, meta: updatedMeta },
          disposition: disp,
          relatedType: 'lead',
          relatedId: leadId,
        });
      }
    } catch (dispErr) {
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
        headers: { Authorization: cfg.api_key.trim() },
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err: any) {
      console.warn('Failed to fetch Bland AI call details from API:', err.message);
    }
  }

  // Fallback: look up in local activities DB
  const act = await one(`SELECT * FROM activities WHERE meta->>'bland_call_id' = $1`, [callId]);
  return act ? {
    call_id: callId,
    status: act.status,
    summary: act.meta?.summary || act.body,
    transcript: act.meta?.transcript || '',
    recording_url: act.meta?.recording_url || null,
    answered_by: act.meta?.answered_by || 'human',
  } : null;
}
