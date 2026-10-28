import { Router } from 'express';
import {
  getBlandConfig,
  saveBlandConfig,
  BLAND_VOICES,
  sendBlandCall,
  handleBlandWebhook,
  getBlandCallDetails,
} from '../services/bland.ts';
import { one } from '../db/index.ts';

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

// 1. Get Bland AI Configuration
blandAuth.get('/config', async (req, res) => {
  try {
    const cfg = await getBlandConfig();
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
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Save Bland AI Configuration (Admin / Manager only)
blandAuth.post('/config', async (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'Only administrators can configure Bland AI Voice Agents' });
  }

  try {
    const saved = await saveBlandConfig(req.body);
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
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. List Available Voices
blandAuth.get('/voices', (_req, res) => {
  res.json({ voices: BLAND_VOICES });
});

// 4. Dispatch Call to a Lead or Phone Number
blandAuth.post('/call', async (req, res) => {
  try {
    const { lead_id, phone, prospect_name, voice, custom_prompt, transfer_number, from_number, pathway_id } = req.body;

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
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Test Call (from Settings Page)
blandAuth.post('/test-call', async (req, res) => {
  try {
    const { test_phone, voice, custom_prompt, pathway_id } = req.body;
    const phoneToCall = test_phone || (req.user as any)?.phone || '+16024569681';

    const result = await sendBlandCall({
      phone: phoneToCall,
      userId: req.user!.id,
      prospectName: req.user!.name || 'Medicare Testing Agent',
      voice,
      customPrompt: custom_prompt || `This is a test call from the I Will Global Medicare CRM Bland AI integration. The AI Voice Agent is functioning properly and ready to engage beneficiaries for Medicare plan reviews and scheduling.`,
      firstSentence: `Hello ${req.user!.name?.split(' ')[0] || 'there'}, this is a test call from your I Will Global CRM Bland AI voice agent. Can you hear me clearly?`,
      pathwayId: pathway_id,
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

// 6. Get Bland Call Details (Transcript & Recording)
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
