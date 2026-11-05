import { Router } from 'express';
import {
  getBlandConfig,
  saveBlandConfig,
  BLAND_VOICES,
  ALLOWED_BLAND_APPOINTMENT_TYPES,
  sendBlandCall,
  handleBlandWebhook,
  getBlandCallDetails,
  setWarmTransferStatus,
  setBlandCampaignActive,
  dispatchNextLeadInQueue,
  canDispatchOutboundCall,
  getInboundDirectory,
} from '../services/bland.ts';
import { one, q } from '../db/index.ts';

export const blandPublic = Router();
export const blandAuth = Router();

// Public Webhook receiver called by Bland.ai upon call completion
blandPublic.post('/webhook', async (req, res) => {
  try {
    const result = await handleBlandWebhook(req.body);
    res.json(result);
  } catch (err: any) {
    console.error('Bland webhook error:', err);
    res.status(500).json({ error: err.message || 'Webhook processing failed' });
  }
});

// Authenticated Endpoints

// 1. Get Bland AI Configuration & Live Operating Status
blandAuth.get('/config', async (_req, res) => {
  try {
    const cfg = await getBlandConfig();
    const dispatchCheck = await canDispatchOutboundCall();
    const hasKey = Boolean(cfg.api_key);
    const maskedKey = cfg.api_key
      ? (cfg.api_key.length > 8 ? `${cfg.api_key.slice(0, 4)}...${cfg.api_key.slice(-4)}` : '••••••••')
      : null;

    res.json({
      enabled: cfg.enabled,
      pathway_id: cfg.pathway_id,
      github_repo: cfg.github_repo,
      has_api_key: hasKey,
      masked_api_key: maskedKey,
      default_voice: cfg.default_voice,
      model: cfg.model,
      language: cfg.language,
      from_number: cfg.from_number,
      transfer_phone_number: cfg.transfer_phone_number,
      prompt_template: cfg.prompt_template,
      webhook_url: cfg.webhook_url,
      calling_hours_start: cfg.calling_hours_start,
      calling_hours_end: cfg.calling_hours_end,
      calling_days: cfg.calling_days,
      daily_call_limit: cfg.daily_call_limit,
      pause_on_warm_transfer: cfg.pause_on_warm_transfer,
      is_calling_paused: cfg.is_calling_paused,
      paused_reason: cfg.paused_reason,
      is_on_warm_transfer: Boolean(cfg.is_on_warm_transfer),
      warm_transfer_lead_id: cfg.warm_transfer_lead_id || null,
      warm_transfer_call_id: cfg.warm_transfer_call_id || null,
      warm_transfer_started_at: cfg.warm_transfer_started_at || null,
      is_campaign_active: Boolean(cfg.is_campaign_active),
      campaign_started_at: cfg.campaign_started_at || null,
      allowed_appointment_types: ALLOWED_BLAND_APPOINTMENT_TYPES,
      operating_mode: dispatchCheck.operating_mode,
      can_dispatch: dispatchCheck.allowed,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Save Bland AI Configuration (Admin / Manager / Authenticated User)
blandAuth.post('/config', async (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager' && req.user?.role !== 'licensed_agent') {
    return res.status(403).json({ error: 'Only administrators or licensed brokers can configure Bland AI Voice Agents' });
  }

  try {
    const saved = await saveBlandConfig(req.body);
    const dispatchCheck = await canDispatchOutboundCall();
    res.json({
      success: true,
      message: 'Bland AI Voice Agent configuration saved successfully!',
      config: {
        enabled: saved.enabled,
        pathway_id: saved.pathway_id,
        github_repo: saved.github_repo,
        has_api_key: Boolean(saved.api_key),
        default_voice: saved.default_voice,
        from_number: saved.from_number,
        transfer_phone_number: saved.transfer_phone_number,
        calling_hours_start: saved.calling_hours_start,
        calling_hours_end: saved.calling_hours_end,
        calling_days: saved.calling_days,
        daily_call_limit: saved.daily_call_limit,
        pause_on_warm_transfer: saved.pause_on_warm_transfer,
        is_calling_paused: saved.is_calling_paused,
        paused_reason: saved.paused_reason,
        is_on_warm_transfer: Boolean(saved.is_on_warm_transfer),
        is_campaign_active: Boolean(saved.is_campaign_active),
        allowed_appointment_types: ALLOWED_BLAND_APPOINTMENT_TYPES,
        operating_mode: dispatchCheck.operating_mode,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. List Available Voices
blandAuth.get('/voices', (_req, res) => {
  res.json({ voices: BLAND_VOICES, allowed_appointment_types: ALLOWED_BLAND_APPOINTMENT_TYPES });
});

// 3b. Get Inbound AI Receptionist & Team Directory Transfer Map
blandAuth.get('/directory', async (_req, res) => {
  try {
    const dir = await getInboundDirectory();
    res.json(dir);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Set Warm Transfer Mode (Agent knows King Amen Ra is on a warm transfer call -> books Telephone, In-Person, or Video appointments only & continues calling)
blandAuth.post('/warm-transfer-mode', async (req, res) => {
  try {
    const { on_warm_transfer, lead_id, call_id, reason } = req.body;
    const saved = await setWarmTransferStatus({
      on_warm_transfer: Boolean(on_warm_transfer),
      lead_id: lead_id || null,
      call_id: call_id || null,
      reason: reason || undefined,
    });
    res.json({
      success: true,
      is_on_warm_transfer: Boolean(saved.is_on_warm_transfer),
      operating_mode: saved.is_on_warm_transfer ? 'APPOINTMENT_ONLY_TELEPHONE_IN_PERSON_VIDEO' : 'WARM_TRANSFER_OR_APPOINTMENT',
      allowed_appointment_types: ALLOWED_BLAND_APPOINTMENT_TYPES,
      message: saved.is_on_warm_transfer
        ? 'Warm Transfer Mode ACTIVE: Bland Agent AI knows you are on a warm transfer call, will ONLY book Telephone, In-Person, or Video appointments, and will continue making calls.'
        : 'Warm Transfer Mode OFF: Bland Agent AI will live warm-transfer qualified prospects to +16024569681 or book Telephone, In-Person, or Video appointments.',
      config: saved,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Backwards-compatible aliases used by existing dialer / warm transfer hooks:
// Instead of halting outbound calls on warm transfer, they switch the agent into Warm Transfer Appointment-Only mode while continuing to make calls!
blandAuth.post('/pause', async (req, res) => {
  try {
    const { reason, lead_id, call_id, manual_stop } = req.body || {};
    if (manual_stop) {
      const saved = await saveBlandConfig({
        is_calling_paused: true,
        paused_reason: reason || 'Manually paused by broker',
        is_campaign_active: false,
      });
      return res.json({ success: true, is_calling_paused: true, is_on_warm_transfer: Boolean(saved.is_on_warm_transfer), config: saved });
    }
    const saved = await setWarmTransferStatus({
      on_warm_transfer: true,
      lead_id: lead_id || null,
      call_id: call_id || null,
      reason: reason || 'Broker on live Warm Transfer — AI booking Telephone, In-Person, or Video appointments only & continuing calls',
    });
    res.json({
      success: true,
      is_calling_paused: false,
      is_on_warm_transfer: true,
      operating_mode: 'APPOINTMENT_ONLY_TELEPHONE_IN_PERSON_VIDEO',
      allowed_appointment_types: ALLOWED_BLAND_APPOINTMENT_TYPES,
      config: saved,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

blandAuth.post('/resume', async (_req, res) => {
  try {
    const saved = await setWarmTransferStatus({
      on_warm_transfer: false,
      reason: undefined,
    });
    res.json({
      success: true,
      is_calling_paused: false,
      is_on_warm_transfer: false,
      operating_mode: 'WARM_TRANSFER_OR_APPOINTMENT',
      config: saved,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Activate Bland Agent AI Campaign / Begin Making Calls
blandAuth.post('/activate', async (req, res) => {
  try {
    const {
      phone,
      lead_id,
      lead_ids,
      prospect_name,
      on_warm_transfer,
      preferred_appointment_type,
      voice,
      max_calls_to_start = 1,
      continue_queue = true,
    } = req.body || {};

    // Ensure Bland AI is enabled and campaign is marked active
    const updates: any = {
      enabled: true,
      is_calling_paused: false,
      is_campaign_active: Boolean(continue_queue),
      campaign_started_at: new Date().toISOString(),
    };
    if (on_warm_transfer !== undefined) {
      updates.is_on_warm_transfer = Boolean(on_warm_transfer);
      updates.paused_reason = on_warm_transfer
        ? 'Broker on live Warm Transfer — AI booking Telephone, In-Person, or Video appointments only'
        : null;
    }
    const cfg = await saveBlandConfig(updates);

    const dispatched: any[] = [];

    // 5a. If a specific phone or lead_id was provided, dial it immediately
    if (phone || lead_id) {
      let targetPhone = phone;
      let targetName = prospect_name;
      if (lead_id) {
        const lead = await one<any>(`SELECT * FROM leads WHERE id=$1`, [lead_id]);
        if (lead) {
          targetPhone = targetPhone || lead.phone;
          targetName = targetName || `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
        }
      }
      if (targetPhone) {
        const callResult = await sendBlandCall({
          phone: targetPhone,
          leadId: lead_id,
          userId: req.user!.id,
          prospectName: targetName || 'Medicare Beneficiary',
          voice: voice || cfg.default_voice,
          onWarmTransfer: Boolean(cfg.is_on_warm_transfer),
          preferredAppointmentType: preferred_appointment_type,
        });
        dispatched.push({ phone: targetPhone, lead_id: lead_id || null, ...callResult });
      }
    }

    // 5b. If an array of lead_ids was provided, dispatch up to max_calls_to_start from that list
    if (Array.isArray(lead_ids) && lead_ids.length > 0 && dispatched.length === 0) {
      const limit = Math.min(Math.max(Number(max_calls_to_start) || 1, 1), 5);
      for (const lid of lead_ids.slice(0, limit)) {
        const lead = await one<any>(`SELECT * FROM leads WHERE id=$1`, [lid]);
        if (lead && lead.phone) {
          const callResult = await sendBlandCall({
            phone: lead.phone,
            leadId: lead.id,
            userId: req.user!.id,
            prospectName: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Medicare Beneficiary',
            voice: voice || cfg.default_voice,
            onWarmTransfer: Boolean(cfg.is_on_warm_transfer),
            preferredAppointmentType: preferred_appointment_type,
          });
          dispatched.push({ phone: lead.phone, lead_id: lead.id, name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(), ...callResult });
        }
      }
    }

    // 5c. Otherwise, pull the next callable lead from the CRM queue and begin making calls!
    if (dispatched.length === 0) {
      const nextResult = await dispatchNextLeadInQueue(req.user!.id);
      if (nextResult.dispatched) {
        dispatched.push(nextResult);
      }
    }

    // Count remaining callable leads in queue
    const queueCountRow = await one<any>(
      `SELECT count(*)::int AS cnt FROM leads
       WHERE dnc = false AND phone_invalid = false
         AND phone IS NOT NULL AND trim(phone) != ''
         AND status NOT IN ('Converted', 'DNC', 'Unqualified', 'Appointment Set')`
    );

    res.json({
      success: true,
      is_campaign_active: Boolean(cfg.is_campaign_active),
      is_on_warm_transfer: Boolean(cfg.is_on_warm_transfer),
      operating_mode: cfg.is_on_warm_transfer
        ? 'APPOINTMENT_ONLY_TELEPHONE_IN_PERSON_VIDEO'
        : 'WARM_TRANSFER_OR_APPOINTMENT',
      allowed_appointment_types: ALLOWED_BLAND_APPOINTMENT_TYPES,
      dispatched,
      queue_remaining: queueCountRow?.cnt || 0,
      message: dispatched.length > 0
        ? `Bland Agent AI activated! Dispatched ${dispatched.length} call(s)${cfg.is_on_warm_transfer ? ' in Warm Transfer Mode (booking Telephone, In-Person, or Video appointments only & continuing calls)' : ''}.`
        : `Bland Agent AI activated and standing by (${queueCountRow?.cnt || 0} callable leads in queue).`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Stop Autonomous Campaign Queue
blandAuth.post('/deactivate', async (_req, res) => {
  try {
    const saved = await setBlandCampaignActive(false);
    res.json({
      success: true,
      is_campaign_active: false,
      is_on_warm_transfer: Boolean(saved.is_on_warm_transfer),
      message: 'Bland Agent AI autonomous queue dialing stopped.',
      config: saved,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Dispatch Call to a Lead or Phone Number
blandAuth.post('/call', async (req, res) => {
  try {
    const {
      lead_id,
      phone,
      prospect_name,
      voice,
      custom_prompt,
      transfer_number,
      from_number,
      pathway_id,
      on_warm_transfer,
      preferred_appointment_type,
    } = req.body;

    let targetPhone = phone;
    let targetName = prospect_name;

    if (lead_id) {
      const lead = await one<any>(`SELECT * FROM leads WHERE id=$1`, [lead_id]);
      if (lead) {
        targetPhone = targetPhone || lead.phone;
        targetName = targetName || `${lead.first_name} ${lead.last_name}`;
      }
    }

    if (!targetPhone) {
      return res.status(400).json({ error: 'Phone number is required to dispatch call' });
    }

    const result = await sendBlandCall({
      phone: targetPhone,
      leadId: lead_id,
      userId: req.user!.id,
      prospectName: targetName,
      voice,
      customPrompt: custom_prompt,
      transferNumber: transfer_number,
      fromNumber: from_number,
      pathwayId: pathway_id,
      onWarmTransfer: on_warm_transfer !== undefined ? Boolean(on_warm_transfer) : undefined,
      preferredAppointmentType: preferred_appointment_type,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Test Call (from Settings Page or Activate Modal)
blandAuth.post('/test-call', async (req, res) => {
  try {
    const { test_phone, voice, custom_prompt, pathway_id, on_warm_transfer, preferred_appointment_type } = req.body;
    const phoneToCall = test_phone || '+14803345557';

    const result = await sendBlandCall({
      phone: phoneToCall,
      userId: req.user!.id,
      prospectName: req.user!.name || 'Medicare Beneficiary',
      voice,
      customPrompt: custom_prompt,
      pathwayId: pathway_id,
      onWarmTransfer: on_warm_transfer !== undefined ? Boolean(on_warm_transfer) : undefined,
      preferredAppointmentType: preferred_appointment_type,
    });

    res.json({
      ...result,
      test_phone: phoneToCall,
      voice: voice || 'maya',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Recent Bland AI Calls & Activity Feed
blandAuth.get('/recent-calls', async (_req, res) => {
  try {
    const rows = await q<any>(
      `SELECT id, subject, phone, status, disposition, duration_sec, created_at, meta
       FROM activities
       WHERE type = 'call' AND provider = 'bland_ai'
       ORDER BY created_at DESC
       LIMIT 15`
    );
    res.json({ calls: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Get Bland Call Details (Transcript & Recording)
blandAuth.get('/calls/:call_id', async (req, res) => {
  try {
    const details = await getBlandCallDetails(req.params.call_id);
    if (!details) {
      return res.status(404).json({ error: 'Call details not found' });
    }
    res.json(details);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
