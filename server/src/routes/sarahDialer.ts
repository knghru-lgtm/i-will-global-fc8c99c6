import { Router } from 'express';
import {
  getSarahDialerConfig,
  saveSarahDialerConfig,
  SARAH_VOICES,
  ALLOWED_SARAH_APPOINTMENT_TYPES,
  sendSarahCall,
  handleSarahWebhook,
  getSarahCallDetails,
  setWarmTransferStatus,
  setSarahCampaignActive,
  dispatchNextLeadInQueue,
  canDispatchOutboundCall,
  getInboundDirectory,
  dispatchAiWhisperTransfer,
  stopSarahOutboundCalls,
  runSarahAutoDialerTick,
  getCallingWindow,
  countSarahAssignedRemaining,
  SARAH_AI_USER_ID,
} from '../services/sarahDialer.ts';
import { one, q, insert } from '../db/index.ts';
import { publish } from '../realtime.ts';
import {
  executeSarahTool,
  upsertReceptionistLeadFromContext,
  checkReceptionistWorkHours,
  RECEPTIONIST_WORK_HOURS_LABEL,
  handleSarahHttpTurn,
  loadSarahCallSession,
  saveSarahCallSession,
  synthesizeSarahNeuralAudio,
} from '../services/sarahVoiceService.ts';

function escapeXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const inboundCallHistoryMap = new Map<
  string,
  {
    history: Array<{ speaker: string; text: string }>;
    lead_id?: string | null;
    prospect_name?: string;
    prospect_phone?: string;
    address?: string;
    product_interest?: string;
  }
>();

export const sarahPublic = Router();
export const sarahAuth = Router();

// Public Webhook receiver called by Sarah Voice Engine upon call completion
sarahPublic.post('/webhook', async (req, res) => {
  try {
    const result = await handleSarahWebhook(req.body);
    res.json(result);
  } catch (err: any) {
    console.error('Sarah webhook error:', err);
    res.status(500).json({ error: err.message || 'Webhook processing failed' });
  }
});

// Scheduled auto-dialer trigger (Vercel Cron fires every 15 minutes across the calling window; no CRM login required).
// Idempotent and bounded: only dials Sarah-assigned prospects, inside calling hours, within the concurrent-line limit.
sarahPublic.get(['/cron/tick', '/cron/tick/:slot'], async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runSarahAutoDialerTick({ reason: 'cron' });
    res.json({ ok: true, dispatched: result.dispatched.length, skipped: (result as any).skipped || null, window_open: result.window_open });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public Team Directory endpoint for the main webpage ("Our Team")
sarahPublic.get('/public-directory', async (_req, res) => {
  try {
    const dir = await getInboundDirectory();
    // Public website: desk entries that internally route to King's direct line are shown with the
    // agency main line (480) 331-9455, which Sarah answers and routes.
    const directory = dir.directory.map((d) =>
      d.e164 === '+16024569681' && !d.name.toLowerCase().includes('king amen ra')
        ? { ...d, phone: '(480) 331-9455', e164: '+14803319455' }
        : d
    );
    res.json({ ...dir, directory });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Inbound Receptionist handler when people call (480) 331-9455 (+14803319455) — answers immediately
sarahPublic.all('/inbound', async (req, res) => {
  try {
    const dir = await getInboundDirectory();
    const cfg = await getSarahDialerConfig();
    const callSessionKey = String(
      req.body?.CallSid ||
        req.query?.CallSid ||
        req.body?.session_id ||
        req.query?.session_id ||
        req.body?.call_id ||
        req.query?.call_id ||
        req.body?.From ||
        req.body?.from ||
        req.query?.From ||
        req.query?.from ||
        req.body?.caller_phone ||
        req.query?.caller_phone ||
        'inbound-default'
    );
    const dbSession = await loadSarahCallSession(callSessionKey);
    const memSession = inboundCallHistoryMap.get(callSessionKey);
    const prevSession: any = dbSession || memSession || { history: [] };

    const callerPhone = String(
      req.body?.From ||
        req.body?.from ||
        req.query?.From ||
        req.query?.from ||
        req.body?.caller_phone ||
        req.query?.caller_phone ||
        prevSession.prospect_phone ||
        ''
    );
    const callerName = String(
      req.body?.caller_name || req.query?.caller_name || req.body?.CallerName || prevSession.prospect_name || ''
    );
    const callerAddress = String(
      req.body?.address || req.query?.address || prevSession.address || ''
    );
    const callerState = String(
      req.body?.state || req.body?.FromState || req.query?.state || prevSession.state || 'AZ'
    );
    const callerHowHeard = String(
      req.body?.how_heard || req.query?.how_heard || prevSession.how_heard || ''
    );
    const requestedPerson = req.body?.requested_person || req.body?.transfer_to || req.query?.transfer_to;
    const appointmentType = req.body?.appointment_type || req.query?.appointment_type;
    const preferredDatetime = req.body?.preferred_datetime || req.query?.preferred_datetime;
    const productLine = req.body?.product_line || req.query?.product_line || prevSession.product_interest;
    const userSpeech = String(
      req.body?.SpeechResult ||
        req.body?.speech ||
        req.body?.message ||
        req.body?.transcript ||
        req.body?.text ||
        req.query?.SpeechResult ||
        req.query?.speech ||
        req.query?.message ||
        req.query?.transcript ||
        ''
    ).trim();
    const isGatherTimeout = String(req.query?.timeout || '') === '1';

    const isTwimlRequest = Boolean(
      req.body?.CallSid ||
        req.query?.CallSid ||
        req.query?.format === 'twiml' ||
        String(req.headers.accept || '').includes('xml')
    );

    let transferResult: any = null;
    let appointmentResult: any = null;
    let activityId: string | null = null;
    let inboundLeadId: string | null =
      req.body?.lead_id || req.query?.lead_id || prevSession.lead_id || null;

    const defaultOpeningSentence =
      'Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?';
    let spokenReply = defaultOpeningSentence;
    let turnAudioBase64: string | null = null;
    let turnAudioMime = 'audio/wav';
    let resolvedCallerName = callerName;
    let resolvedCallerPhone = callerPhone;
    let resolvedCallerAddress = callerAddress;
    let resolvedCallerState = callerState;
    let resolvedHowHeard = callerHowHeard;

    if (req.method === 'POST' || userSpeech || isTwimlRequest) {
      // Automatically create or update the Call-In Lead in CRM when caller details are available
      if (callerPhone || callerName || callerAddress) {
        const upsertedId = await upsertReceptionistLeadFromContext(
          {
            mode: 'inbound',
            lead_id: inboundLeadId || undefined,
            prospect_name: callerName,
            prospect_phone: callerPhone,
            address: callerAddress,
            state: callerState,
            how_heard: callerHowHeard,
            product_interest: productLine,
            source_channel: 'call_in_lead',
          },
          req.body?.notes || 'Inbound call picked up internally on 1st ring on (480) 331-9455 by Cloned App Receptionist'
        );
        if (upsertedId) inboundLeadId = upsertedId;
      }

      const workHoursStatus = checkReceptionistWorkHours({
        mode: 'inbound',
        force_work_hours: Boolean(req.body?.force_work_hours || req.query?.force_work_hours),
        simulated_now_iso: String(req.body?.simulated_now_iso || req.query?.simulated_now_iso || '') || undefined,
      });

      if (userSpeech) {
        const turnResult = await handleSarahHttpTurn({
          message: userSpeech,
          session_id: callSessionKey,
          history: prevSession.history,
          skip_inline_tts: isTwimlRequest || Boolean(req.body?.skip_inline_tts),
          context: {
            mode: 'inbound',
            source_channel: 'call_in_lead',
            lead_id: inboundLeadId || undefined,
            prospect_name: callerName,
            prospect_phone: callerPhone,
            address: callerAddress,
            state: callerState,
            how_heard: callerHowHeard,
            product_interest: productLine,
            on_warm_transfer: Boolean(cfg.is_on_warm_transfer),
            force_work_hours: Boolean(req.body?.force_work_hours || req.query?.force_work_hours),
            simulated_now_iso: String(req.body?.simulated_now_iso || req.query?.simulated_now_iso || '') || undefined,
          },
        });
        if (turnResult?.reply) {
          spokenReply = turnResult.reply;
        }
        turnAudioBase64 = turnResult?.audio_base64 || null;
        turnAudioMime = turnResult?.audio_mime || 'audio/wav';
        if (turnResult?.lead_id) inboundLeadId = turnResult.lead_id;
        if (turnResult?.prospect_name) resolvedCallerName = turnResult.prospect_name;
        if (turnResult?.prospect_phone) resolvedCallerPhone = turnResult.prospect_phone;
        if (turnResult?.prospect_address) resolvedCallerAddress = turnResult.prospect_address;
        if ((turnResult as any)?.prospect_state) resolvedCallerState = (turnResult as any).prospect_state;
        if ((turnResult as any)?.how_heard) resolvedHowHeard = (turnResult as any).how_heard;
        if (turnResult?.transfer) transferResult = turnResult.transfer;
        if (turnResult?.appointment) appointmentResult = turnResult.appointment;

        const nextHistory = [
          ...(prevSession.history || []).slice(-14),
          { speaker: 'user' as const, text: userSpeech },
          { speaker: 'sarah' as const, text: spokenReply },
        ];
        const nextState = {
          history: nextHistory,
          lead_id: inboundLeadId || undefined,
          prospect_name: resolvedCallerName,
          prospect_phone: resolvedCallerPhone,
          address: resolvedCallerAddress,
          state: resolvedCallerState,
          how_heard: resolvedHowHeard,
          product_interest: turnResult?.product_interest || productLine,
        };
        inboundCallHistoryMap.set(callSessionKey, nextState);
        await saveSarahCallSession(callSessionKey, nextState);
      } else if (isGatherTimeout) {
        // Never repeat the opening greeting if the caller hasn't spoken yet — ask a gentle follow-up once!
        spokenReply =
          'I am still right here with you. Would you like to set an appointment with our Principal Broker, King Amen Ra, or may I get your full name, phone number, and street address?';
        if (!isTwimlRequest && !req.body?.skip_inline_tts) {
          const tts = await synthesizeSarahNeuralAudio(spokenReply);
          turnAudioBase64 = tts.audio_base64;
          turnAudioMime = tts.audio_mime || 'audio/wav';
        }
      } else {
        // Initial 1st-ring pickup: get pre-cached Vindemiatrix greeting WAV in 0ms and reset session history cleanly
        if (!isTwimlRequest && !req.body?.skip_inline_tts) {
          const tts = await synthesizeSarahNeuralAudio(spokenReply);
          turnAudioBase64 = tts.audio_base64;
          turnAudioMime = tts.audio_mime || 'audio/wav';
        }
        const initState = {
          history: [{ speaker: 'sarah' as const, text: spokenReply }],
          lead_id: inboundLeadId || undefined,
          prospect_name: callerName,
          prospect_phone: callerPhone,
          address: callerAddress,
          state: callerState,
          how_heard: callerHowHeard,
          product_interest: productLine,
        };
        inboundCallHistoryMap.set(callSessionKey, initState);
        await saveSarahCallSession(callSessionKey, initState);
      }

      if (requestedPerson && !cfg.is_on_warm_transfer && !transferResult) {
        transferResult = await executeSarahTool(
          'whisper_warm_transfer',
          {
            recipient_name: String(requestedPerson),
            customer_name: callerName || 'Inbound Caller',
            customer_phone: callerPhone,
            customer_state: req.body?.state || 'AZ',
            reason_for_call: req.body?.reason || 'Inbound call on (480) 331-9455 requesting advisor',
            lead_id: inboundLeadId,
          },
          {
            mode: 'inbound',
            source_channel: 'call_in_lead',
            lead_id: inboundLeadId || undefined,
            prospect_name: callerName,
            prospect_phone: callerPhone,
            address: callerAddress,
            state: req.body?.state || 'AZ',
            product_interest: productLine,
            force_work_hours: Boolean(req.body?.force_work_hours || req.query?.force_work_hours),
            simulated_now_iso: String(req.body?.simulated_now_iso || req.query?.simulated_now_iso || '') || undefined,
          }
        );
      }

      if ((appointmentType || (requestedPerson && cfg.is_on_warm_transfer)) && !appointmentResult) {
        appointmentResult = await executeSarahTool(
          'book_appointment',
          {
            lead_id: inboundLeadId,
            customer_name: callerName,
            phone: callerPhone,
            address: callerAddress,
            product_interest: productLine,
            appointment_type: String(appointmentType || 'Telephone'),
            preferred_datetime: String(preferredDatetime || 'Tomorrow at 10:00 AM'),
            state: req.body?.state || 'AZ',
            notes: req.body?.notes || 'Booked by Receptionist on inbound call to (480) 331-9455',
          },
          {
            mode: 'inbound',
            source_channel: 'call_in_lead',
            lead_id: inboundLeadId || undefined,
            prospect_name: callerName,
            prospect_phone: callerPhone,
            address: callerAddress,
            state: req.body?.state || 'AZ',
            product_interest: productLine,
          }
        );
        if (appointmentResult?.lead_id) inboundLeadId = appointmentResult.lead_id;
      }

      const inboundAct = await insert('activities', {
        type: 'call',
        subject: `🎧 Receptionist Inbound Call on (480) 331-9455 — ${callerName || callerPhone || 'Call-In Lead'}`,
        body: `Inbound call answered immediately by Receptionist on (480) 331-9455 (+14803319455).\nOfficial Work Hours: ${RECEPTIONIST_WORK_HOURS_LABEL} (Open Now: ${workHoursStatus.isOpen ? 'YES' : 'NO — No Warm Transfers Outside Work Hours'})\nLead Source Tag: Call-In Lead\nCaller: ${callerName || 'Pending Name'} (${callerPhone || 'Pending Phone'})${callerAddress ? `\nAddress: ${callerAddress}` : ''}${userSpeech ? `\nCaller Said: "${userSpeech}"\nReceptionist Replied: "${spokenReply}"` : ''}${transferResult?.success ? `\nLive Outbound Call to ${transferResult.recipient_name} (${transferResult.recipient_phone}) Initiated (Call ID: ${transferResult.sarah_call_id || 'Pending'}): "${transferResult.private_whisper_delivered}"` : transferResult?.outside_work_hours ? `\nWarm Transfer Blocked Outside Work Hours (${RECEPTIONIST_WORK_HOURS_LABEL}) — Transitioned to Appointment Booking` : ''}${appointmentResult?.success ? `\nAppointment Scheduled: ${appointmentResult.appointment_type} on ${appointmentResult.preferred_datetime}` : ''}`,
        related_type: 'lead',
        related_id: appointmentResult?.lead_id || inboundLeadId || null,
        user_id: SARAH_AI_USER_ID,
        status: 'Completed',
        completed: true,
        direction: 'inbound',
        phone: callerPhone || '+14803319455',
        provider: 'google_voice_ai',
        disposition_id: appointmentResult?.success ? 'appointment_set' : transferResult?.success ? 'warm_transfer_success' : 'contacted_interested',
        disposition: appointmentResult?.success
          ? `Receptionist Inbound — ${appointmentResult.appointment_type} Appointment Booked`
          : transferResult?.success
          ? `Receptionist Inbound — Live Call to ${transferResult.recipient_name} (${transferResult.recipient_phone})`
          : transferResult?.outside_work_hours
          ? `Receptionist Inbound — Outside Work Hours (${RECEPTIONIST_WORK_HOURS_LABEL}) — Appointment Offered`
          : 'Receptionist Inbound — Answered Immediately on (480) 331-9455',
        duration_sec: 45,
        meta: {
          mode: 'inbound_receptionist',
          lead_source: 'Call-In Lead',
          line: '(480) 331-9455',
          line_e164: '+14803319455',
          answered_immediately: true,
          ring_delay_ms: 0,
          work_hours: RECEPTIONIST_WORK_HOURS_LABEL,
          work_hours_status: workHoursStatus,
          caller_phone: callerPhone,
          caller_name: callerName,
          caller_address: callerAddress,
          lead_id: inboundLeadId,
          user_speech: userSpeech || null,
          receptionist_reply: spokenReply,
          transfer_result: transferResult,
          appointment_result: appointmentResult,
        },
      });
      activityId = inboundAct?.id || null;

      // Broadcast real-time SSE notification so any open CRM browser window pops open & answers immediately!
      try {
        publish('inbox', 'inbound_call_ringing', {
          call_id: callSessionKey,
          line: '(480) 331-9455',
          line_e164: '+14803319455',
          caller_phone: callerPhone,
          caller_name: callerName,
          caller_address: callerAddress,
          lead_id: inboundLeadId,
          user_speech: userSpeech || null,
          reply: spokenReply,
          answered_immediately: true,
        });
      } catch {
        // ignore SSE error
      }
    }

    // If called by a PSTN/SIP/Twilio/Telnyx/Google Voice forwarding trunk expecting TwiML/TeXML voice XML,
    // play Sarah's natural Vindemiatrix voice WAV (<Play>) inside the call stream without Chrome or speaker!
    const baseUrl = `${req.protocol || 'https'}://${req.get('host') || 'iwillglobal.com'}`;
    const audioPlayUrl = `${baseUrl}/api/sarah/audio.wav?text=${encodeURIComponent(spokenReply)}`;

    if (isTwimlRequest) {
      res.setHeader('Content-Type', 'text/xml; charset=utf-8');
      if (transferResult?.success) {
        const targetPhone = transferResult.recipient_phone || '+16024569681';
        const holdText =
          transferResult.hold_message ||
          spokenReply ||
          'Please hold for just a moment while I call King Amen Ra on 602-456-9681 and connect you.';
        const holdAudioUrl = `${baseUrl}/api/sarah/audio.wav?text=${encodeURIComponent(holdText)}`;
        return res.status(200).send(
          `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Play>${escapeXml(holdAudioUrl)}</Play>\n  <Dial callerId="+14803319455" timeout="25">${escapeXml(targetPhone)}</Dial>\n</Response>`
        );
      }
      const actionUrl = `/api/sarah/inbound?format=twiml&session_id=${encodeURIComponent(callSessionKey)}${inboundLeadId ? `&lead_id=${encodeURIComponent(inboundLeadId)}` : ''}`;
      const fallbackTag = isGatherTimeout
        ? `  <Hangup/>`
        : `  <Redirect method="POST">${escapeXml(`${actionUrl}&timeout=1`)}</Redirect>`;
      return res.status(200).send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Gather input="speech dtmf" speechTimeout="auto" language="en-US" action="${escapeXml(actionUrl)}" method="POST">\n    <Play>${escapeXml(audioPlayUrl)}</Play>\n  </Gather>\n${fallbackTag}\n</Response>`
      );
    }

    const currentWorkHours = checkReceptionistWorkHours({
      mode: 'inbound',
      force_work_hours: Boolean(req.body?.force_work_hours || req.query?.force_work_hours),
      simulated_now_iso: String(req.body?.simulated_now_iso || req.query?.simulated_now_iso || '') || undefined,
    });

    res.json({
      ok: true,
      success: true,
      status: 'answered_internally',
      answered_immediately: true,
      answered_internally: true,
      cell_phone_triggered: false,
      speaker_triggered: false,
      wait_for_greeting: false,
      ring_delay_ms: 0,
      session_id: callSessionKey,
      receptionist: 'Receptionist',
      receptionist_name: 'Receptionist',
      voice: 'Vindemiatrix',
      work_hours: RECEPTIONIST_WORK_HOURS_LABEL,
      work_hours_status: currentWorkHours,
      warm_transfers_allowed_now: currentWorkHours.isOpen && !cfg.is_on_warm_transfer,
      lead_source: 'Call-In Lead',
      lead_id: inboundLeadId,
      line: '(480) 331-9455',
      line_e164: '+14803319455',
      line_number: '+14803319455',
      display_number: '(480) 331-9455',
      caller_phone: resolvedCallerPhone,
      caller_name: resolvedCallerName,
      caller_address: resolvedCallerAddress,
      caller_state: resolvedCallerState,
      how_heard: resolvedHowHeard || null,
      first_sentence: defaultOpeningSentence,
      reply: spokenReply,
      audio_url: `/api/sarah/audio.wav?text=${encodeURIComponent(spokenReply)}`,
      audio_base64: turnAudioBase64,
      audio_mime: turnAudioMime,
      transfer_phone_number: '+16024569681',
      directory_count: dir.directory.length,
      transfer_list: dir.transfer_list,
      directory: dir.directory,
      on_warm_transfer: Boolean(cfg.is_on_warm_transfer),
      telephony_provider: 'google_voice',
      google_voice_inbox_url: 'https://voice.google.com/u/0/calls',
      sarah_live_ws: '/api/sarah/live?mode=inbound',
      activity_id: activityId,
      transfer_result: transferResult,
      appointment_result: appointmentResult,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Authenticated Endpoints

// 1. Get Sarah Voice Engine Configuration & Live Operating Status
sarahAuth.get('/config', async (_req, res) => {
  try {
    const cfg = await getSarahDialerConfig();
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
      weekend_calling_hours_start: cfg.weekend_calling_hours_start,
      weekend_calling_hours_end: cfg.weekend_calling_hours_end,
      calling_days: cfg.calling_days,
      calling_window: (() => {
        const w = getCallingWindow(cfg);
        return { open: w.open, today: w.today_label, schedule: w.schedule_label, next_open: w.next_open_label };
      })(),
      sarah_ai_user_id: SARAH_AI_USER_ID,
      sarah_assigned: await countSarahAssignedRemaining(),
      max_concurrent_calls: cfg.max_concurrent_calls,
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
      allowed_appointment_types: ALLOWED_SARAH_APPOINTMENT_TYPES,
      operating_mode: dispatchCheck.operating_mode,
      can_dispatch: dispatchCheck.allowed,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Save Sarah Outbound Caller & Receptionist Configuration (Admin / Manager / Authenticated User)
sarahAuth.post('/config', async (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager' && req.user?.role !== 'licensed_agent') {
    return res.status(403).json({ error: 'Only administrators or licensed brokers can configure Sarah Outbound Caller & Receptionist' });
  }

  try {
    const saved = await saveSarahDialerConfig(req.body);
    const dispatchCheck = await canDispatchOutboundCall();
    res.json({
      success: true,
      message: 'Sarah Outbound Caller & Receptionist configuration saved successfully!',
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
        allowed_appointment_types: ALLOWED_SARAH_APPOINTMENT_TYPES,
        operating_mode: dispatchCheck.operating_mode,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. List Available Voices
sarahAuth.get('/voices', (_req, res) => {
  res.json({ voices: SARAH_VOICES, allowed_appointment_types: ALLOWED_SARAH_APPOINTMENT_TYPES });
});

// 3b. Get Inbound AI Receptionist & Team Directory Transfer Map
sarahAuth.get('/directory', async (_req, res) => {
  try {
    const dir = await getInboundDirectory();
    res.json(dir);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3c. Automatic AI Whisper Transfer for All Callers & All Directory Members
sarahAuth.post('/whisper-transfer', async (req, res) => {
  try {
    const {
      recipient_name,
      recipient_phone,
      prospect_name,
      prospect_phone,
      state,
      notes,
      place_live_whisper_call,
    } = req.body || {};

    const result = await dispatchAiWhisperTransfer({
      recipient_name,
      recipient_phone,
      prospect_name,
      prospect_phone,
      state,
      notes,
      caller_name: req.user?.name || 'Sarah',
      place_live_whisper_call: Boolean(place_live_whisper_call),
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Set Warm Transfer Mode (Agent knows King Amen Ra is on a warm transfer call -> books Telephone, In-Person, or Video appointments only & continues calling)
sarahAuth.post('/warm-transfer-mode', async (req, res) => {
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
      allowed_appointment_types: ALLOWED_SARAH_APPOINTMENT_TYPES,
      message: saved.is_on_warm_transfer
        ? 'Warm Transfer Mode ACTIVE: Sarah Outbound Caller knows you are on a warm transfer call, will ONLY book Telephone, In-Person, or Video appointments, and will continue making calls.'
        : 'Warm Transfer Mode OFF: Sarah Outbound Caller will live warm-transfer qualified prospects to +16024569681 or book Telephone, In-Person, or Video appointments.',
      config: saved,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Backwards-compatible aliases used by existing dialer / warm transfer hooks:
// Instead of halting outbound calls on warm transfer, they switch the agent into Warm Transfer Appointment-Only mode while continuing to make calls!
sarahAuth.post('/pause', async (req, res) => {
  try {
    const { reason, lead_id, call_id, manual_stop } = req.body || {};
    if (manual_stop) {
      const saved = await saveSarahDialerConfig({
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
      allowed_appointment_types: ALLOWED_SARAH_APPOINTMENT_TYPES,
      config: saved,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

sarahAuth.post('/resume', async (_req, res) => {
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

// 5. Activate Sarah Agent AI Campaign / Begin Making Calls
sarahAuth.post('/activate', async (req, res) => {
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

    // Ensure Sarah Voice Engine is enabled and campaign is marked active
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
    const cfg = await saveSarahDialerConfig(updates);
    const callingWindow = getCallingWindow(cfg);

    const dispatched: any[] = [];
    let assignedCount = 0;
    let gateMessage: string | null = null;

    // 5a. Selected prospects are assigned to Sarah / Sarah Voice Engine so the autonomous dialer works them every day until reached.
    if (Array.isArray(lead_ids) && lead_ids.length > 0) {
      const updated = await q(
        `UPDATE leads SET owner_id = $1, updated_at = now() WHERE id = ANY($2) RETURNING id`,
        [SARAH_AI_USER_ID, lead_ids]
      );
      assignedCount = updated.length;
    } else if (continue_queue) {
      // Ensure all callable leads in the CRM are assigned if none have been explicitly assigned yet
      const existingAssigned = await one(
        `SELECT count(*)::int AS cnt FROM leads WHERE owner_id = $1 OR assigned_agent_id = $1`,
        [SARAH_AI_USER_ID]
      );
      if (!existingAssigned?.cnt) {
        const autoAssigned = await q(
          `UPDATE leads SET assigned_agent_id = $1, updated_at = now()
           WHERE COALESCE(dnc, false) = false
             AND COALESCE(phone_invalid, false) = false
             AND phone IS NOT NULL AND trim(phone) != ''
             AND COALESCE(status, 'New') NOT IN ('Converted', 'DNC', 'Unqualified', 'Appointment Set')
           RETURNING id`,
          [SARAH_AI_USER_ID]
        );
        assignedCount = autoAssigned.length;
      }
    }

    // 5b. If a specific phone or lead_id was provided, dial it immediately (inside calling hours)
    if (phone || lead_id) {
      let targetPhone = phone;
      let targetName = prospect_name;
      let targetState: string | undefined;
      if (lead_id) {
        const lead = await one<any>(`SELECT * FROM leads WHERE id=$1`, [lead_id]);
        if (lead) {
          targetPhone = targetPhone || lead.phone;
          targetName = targetName || `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
          targetState = lead.state || undefined;
        }
      }
      if (targetPhone) {
        try {
          const callResult = await sendSarahCall({
            phone: targetPhone,
            related_type: 'lead',
            related_id: lead_id,
            user: req.user!,
            prospect_name: targetName || 'Medicare Beneficiary',
            state: targetState,
            voice: voice || cfg.default_voice,
            on_warm_transfer: Boolean(cfg.is_on_warm_transfer),
            preferred_appointment_type,
            override_pause: true,
          });
          dispatched.push({ phone: targetPhone, lead_id: lead_id || null, ...callResult });
        } catch (err: any) {
          if (err?.code === 'CALLING_GATE_RESTRICTED') gateMessage = err.message;
          else throw err;
        }
      }
    }

    // 5c. Fill every open line with the next prospects assigned to Sarah Voice Engine.
    let tick: any = null;
    if (continue_queue) {
      tick = await runSarahAutoDialerTick({ reason: 'activate', force: true });
      if (tick?.dispatched?.length) dispatched.push(...tick.dispatched);
    }

    const assigned = await countSarahAssignedRemaining(callingWindow.start_of_day);

    let message: string;
    if (!callingWindow.open) {
      message = `📞 Sarah Outbound Caller is ACTIVE and armed. Outside calling hours right now (${callingWindow.schedule_label}). ${callingWindow.next_open_label} ${assigned.remaining_today > 0 ? `${assigned.remaining_today} assigned prospect(s) are queued.` : ''}`.trim();
    } else if (dispatched.length > 0) {
      message = `📞 Sarah Outbound Caller activated! Dialing ${dispatched.length} prospect(s) now via Google Voice on (480) 331-9455${cfg.is_on_warm_transfer ? ' in Warm Transfer Mode (Telephone, In-Person, or Video appointments only)' : ''}. ${assigned.remaining_today} assigned prospect(s) remaining today — Sarah keeps calling until ${callingWindow.today_label.split('– ')[1] || 'close'}.`;
    } else if (assigned.assigned_total === 0) {
      message = '📞 Sarah Outbound Caller is ACTIVE, but no prospects are assigned yet. Select prospects and click "Assign to Sarah Outbound" to queue them.';
    } else if (assigned.remaining_today === 0) {
      message = `📞 Sarah Outbound Caller is ACTIVE. All ${assigned.assigned_total} assigned prospect(s) have been called today — new assignments and due callbacks will be dialed automatically.`;
    } else {
      message = `📞 Sarah Outbound Caller is ACTIVE with ${assigned.remaining_today} assigned prospect(s) queued — all lines are busy; the next prospect is dialed the moment a line frees up.`;
    }
    if (assignedCount > 0) message = `✅ ${assignedCount} prospect(s) assigned to Sarah Outbound Caller. ${message}`;
    if (gateMessage) message = `${gateMessage} ${message}`;

    res.json({
      success: true,
      is_campaign_active: Boolean(cfg.is_campaign_active),
      is_on_warm_transfer: Boolean(cfg.is_on_warm_transfer),
      operating_mode: cfg.is_on_warm_transfer
        ? 'APPOINTMENT_ONLY_TELEPHONE_IN_PERSON_VIDEO'
        : 'WARM_TRANSFER_OR_APPOINTMENT',
      allowed_appointment_types: ALLOWED_SARAH_APPOINTMENT_TYPES,
      dispatched,
      call_id: dispatched[0]?.call_id || null,
      assigned_to_sarah: assignedCount,
      sarah_assigned_total: assigned.assigned_total,
      queue_remaining: assigned.remaining_today,
      calling_window: { open: callingWindow.open, today: callingWindow.today_label, schedule: callingWindow.schedule_label, next_open: callingWindow.next_open_label },
      message,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5d. CRM heartbeat: keeps the autonomous dialer filling open lines while anyone has the CRM open.
sarahAuth.post('/tick', async (_req, res) => {
  try {
    const result = await runSarahAutoDialerTick({ reason: 'heartbeat' });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5e. Assign selected prospects to Sarah Outbound Caller (they are dialed automatically during calling hours)
sarahAuth.post('/assign', async (req, res) => {
  try {
    const { lead_ids } = req.body || {};
    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      return res.status(400).json({ error: 'Select at least one prospect to assign to Sarah Outbound Caller' });
    }
    const updated = await q(
      `UPDATE leads SET owner_id = $1, updated_at = now() WHERE id = ANY($2) RETURNING id`,
      [SARAH_AI_USER_ID, lead_ids]
    );
    const cfg = await getSarahDialerConfig();
    const tick = cfg.is_campaign_active ? await runSarahAutoDialerTick({ reason: 'assign', force: true }) : null;
    const assigned = await countSarahAssignedRemaining();
    res.json({
      success: true,
      assigned: updated.length,
      sarah_assigned_total: assigned.assigned_total,
      queue_remaining: assigned.remaining_today,
      dispatched: tick?.dispatched || [],
      is_campaign_active: Boolean(cfg.is_campaign_active),
      message: `📞 ${updated.length} prospect(s) assigned to Sarah Outbound Caller.${cfg.is_campaign_active ? ' Sarah is active and will call them during calling hours.' : ' Click "Start Outbound Calls" to begin dialing.'}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Stop Autonomous Campaign Queue & Active Outbound Calls
sarahAuth.post('/deactivate', async (req, res) => {
  try {
    const { call_id, stop_all = true } = req.body || {};
    const result = await stopSarahOutboundCalls({ call_id, stop_all });
    res.json({
      success: true,
      is_campaign_active: false,
      is_on_warm_transfer: Boolean(result.config.is_on_warm_transfer),
      stopped_call_id: result.stopped_call_id,
      message: result.message || 'Sarah Outbound Caller stopped.',
      config: result.config,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6b. Stop a Specific Call or All Active Calls
sarahAuth.post('/stop', async (req, res) => {
  try {
    const { call_id, stop_all = true } = req.body || {};
    const result = await stopSarahOutboundCalls({ call_id, stop_all });
    res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Dispatch Call to a Lead or Phone Number
sarahAuth.post('/call', async (req, res) => {
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
      transfer_on_request,
      requested_person,
      transfer_to,
    } = req.body;

    let targetPhone = phone;
    let targetName = prospect_name;
    let targetState: string | undefined;

    if (lead_id) {
      const lead = await one<any>(`SELECT * FROM leads WHERE id=$1`, [lead_id]);
      if (lead) {
        targetPhone = targetPhone || lead.phone;
        targetName = targetName || `${lead.first_name} ${lead.last_name}`;
        targetState = lead.state || undefined;
      }
    }

    if (!targetPhone) {
      return res.status(400).json({ error: 'Phone number is required to dispatch call' });
    }

    const requestedAdvisor = requested_person || transfer_to;
    const result = await sendSarahCall({
      phone: targetPhone,
      related_type: 'lead',
      related_id: lead_id,
      user: req.user!,
      prospect_name: targetName,
      state: targetState,
      voice,
      custom_prompt,
      transfer_phone_number: transfer_number,
      fromNumber: from_number,
      pathway_id,
      on_warm_transfer: on_warm_transfer !== undefined ? Boolean(on_warm_transfer) : undefined,
      preferred_appointment_type,
      transfer_on_request: Boolean(transfer_on_request || requestedAdvisor),
      requested_person: requestedAdvisor,
      override_pause: true,
    });

    let transferResult: any = null;
    if ((transfer_on_request || requestedAdvisor) && !result.on_warm_transfer) {
      transferResult = await executeSarahTool(
        'whisper_warm_transfer',
        {
          recipient_name: requestedAdvisor || 'King Amen Ra',
          prospect_name: targetName || 'Medicare Beneficiary',
          prospect_phone: targetPhone,
          state: targetState || 'AZ',
        },
        {
          mode: 'outbound',
          lead_id,
          prospect_name: targetName || 'Medicare Beneficiary',
          prospect_phone: targetPhone,
          state: targetState || 'AZ',
        }
      );
    }

    res.json({
      ...result,
      transfer_result: transferResult || result.whisper_transfer,
    });
  } catch (err: any) {
    res.status(err?.status === 409 ? 409 : 500).json({ error: err.message });
  }
});

// 8. Test Call (from Settings Page or Activate Modal)
sarahAuth.post('/test-call', async (req, res) => {
  try {
    const {
      test_phone,
      voice,
      custom_prompt,
      pathway_id,
      on_warm_transfer,
      preferred_appointment_type,
      transfer_on_request,
      requested_person,
      transfer_to,
    } = req.body;
    const phoneToCall = String(test_phone || '').trim();
    if (!phoneToCall) {
      return res.status(400).json({ error: 'Please enter a phone number to place a test call.' });
    }
    const requestedAdvisor = requested_person || transfer_to;

    const result = await sendSarahCall({
      phone: phoneToCall,
      user: req.user!,
      prospect_name: req.user!.name || 'Medicare Beneficiary',
      voice,
      custom_prompt,
      pathway_id,
      on_warm_transfer: on_warm_transfer !== undefined ? Boolean(on_warm_transfer) : undefined,
      preferred_appointment_type,
      transfer_on_request: Boolean(transfer_on_request || requestedAdvisor),
      requested_person: requestedAdvisor,
      override_pause: true,
    });

    let transferResult: any = null;
    if ((transfer_on_request || requestedAdvisor) && !result.on_warm_transfer) {
      transferResult = await executeSarahTool(
        'whisper_warm_transfer',
        {
          recipient_name: requestedAdvisor || 'King Amen Ra',
          prospect_name: req.user!.name || 'Medicare Beneficiary',
          prospect_phone: phoneToCall,
          state: 'AZ',
        },
        {
          mode: 'outbound',
          prospect_name: req.user!.name || 'Medicare Beneficiary',
          prospect_phone: phoneToCall,
          state: 'AZ',
        }
      );
    }

    res.json({
      ...result,
      test_phone: phoneToCall,
      voice: voice || 'maya',
      transfer_result: transferResult || result.whisper_transfer,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Recent Sarah Voice Engine Calls & Activity Feed
sarahAuth.get('/recent-calls', async (_req, res) => {
  try {
    const rows = await q<any>(
      `SELECT id, subject, phone, status, disposition, duration_sec, created_at, meta
       FROM activities
       WHERE type = 'call' AND provider = 'google_voice_ai'
       ORDER BY created_at DESC
       LIMIT 15`
    );
    res.json({ calls: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Get Sarah Call Details (Transcript & Recording)
sarahAuth.get('/calls/:call_id', async (req, res) => {
  try {
    const details = await getSarahCallDetails(req.params.call_id);
    if (!details) {
      return res.status(404).json({ error: 'Call details not found' });
    }
    res.json(details);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
