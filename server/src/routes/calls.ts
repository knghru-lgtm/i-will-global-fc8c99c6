import { Router } from 'express';
import { q, one, insert, update, audit } from '../db/index.ts';
import { getProvider } from '../services/telephony.ts';
import { isWithinCallingHours, localHour, toE164 } from '../services/phone.ts';
import { applyDisposition } from '../services/automation.ts';
import { OBJECTS } from './objects.ts';
import { buildWhere } from './records.ts';
import { isManager, isAdminUser } from '../auth.ts';
import { summarizeCall } from '../services/ai/index.ts';
import { TPMO_DISCLAIMER } from '../config.ts';
import { setWarmTransferStatus, buildAiWhisperScripts } from '../services/bland.ts';

export const calls = Router();

async function loadTarget(type: string, id: string) {
  if (type === 'lead') return one(`SELECT * FROM leads WHERE id=$1`, [id]);
  if (type === 'client') return one(`SELECT * FROM clients WHERE id=$1`, [id]);
  return null;
}

/** Start a call: compliance checks, log in-progress call, return Google Voice dial links. */
calls.post('/start', async (req, res) => {
  const { related_type, related_id, override } = req.body;
  const target = await loadTarget(related_type, related_id);
  if (!target) return res.status(404).json({ error: 'Contact not found' });
  if (req.user!.role === 'scheduler' && related_type === 'lead') {
    if (target.owner_id && target.owner_id !== req.user!.id) {
      return res.status(403).json({ error: 'This lead belongs to another scheduler' });
    }
    // Auto-claim unassigned lead when scheduler dials
    if (!target.owner_id) {
      await update('leads', target.id, { owner_id: req.user!.id, updated_at: new Date() });
    }
  }
  if (target.dnc) return res.status(409).json({ error: 'Do Not Call — dialing blocked for this contact', code: 'DNC' });
  const phone = req.body.phone || target.phone;
  const provider = getProvider(req.body.provider);
  const dial = provider.prepareDial(phone, req.user?.email);
  if (!dial) return res.status(400).json({ error: 'No valid phone number', code: 'INVALID_PHONE' });

  const warnings: string[] = [];
  if (!isWithinCallingHours(target.state)) {
    const msg = `Outside TCPA calling hours (8am–9pm) — it is ${localHour(target.state)}:00 for this contact`;
    if (!override && !isManager(req.user)) return res.status(409).json({ error: msg, code: 'QUIET_HOURS' });
    warnings.push(msg + (isManager(req.user) ? ' (manager override)' : ' (override)'));
  }
  if (target.phone_invalid) warnings.push('This number was previously marked as wrong/invalid');
  if (related_type === 'lead' && !target.tcpa_consent && /purchased|list/i.test(target.source || '')) {
    warnings.push('No TCPA consent on file — manual dial only, verify DNC registry before calling');
  }
  const soa = await one(
    `SELECT status, signed_at FROM soas WHERE (lead_id=$1 OR client_id=$1) ORDER BY created_at DESC LIMIT 1`, [related_id]);

  const call = await insert('activities', {
    type: 'call',
    subject: `Call — ${target.first_name} ${target.last_name}`,
    related_type,
    related_id,
    user_id: req.user!.id,
    status: 'In Progress',
    completed: true,
    direction: 'outbound',
    phone: dial.e164,
    provider: dial.provider,
    disposition_id: 'call_attempted',
    disposition: 'Call Placed / Outbound Dial',
    duration_sec: 15,
    meta: {
      started_at: new Date().toISOString(),
      attempt_incremented: true,
      dialer_mode: req.user!.role === 'scheduler' ? 'scheduler_dialer' : 'direct',
    },
  });

  const nextAttempts = (target.attempts || 0) + 1;
  if (related_type === 'lead') {
    await update('leads', target.id, {
      attempts: nextAttempts,
      last_contacted_at: new Date(),
      last_disposition: 'Call Placed',
      status: target.status === 'New' ? 'Contacted' : target.status,
      updated_at: new Date(),
    });
    target.attempts = nextAttempts;
    target.last_disposition = 'Call Placed';
    if (target.status === 'New') target.status = 'Contacted';
  }

  await audit(req.user!.id, 'call_start', 'activities', call.id, { phone: dial.e164, target: target.id });
  res.json({
    call, dial, warnings,
    contact: { id: target.id, name: `${target.first_name} ${target.last_name}`, phone: target.phone, state: target.state, dob: target.dob,
      status: target.status, score: target.score, last_disposition: target.last_disposition, attempts: target.attempts },
    compliance: {
      soa_status: soa?.status || 'None',
      tpmo_disclaimer: TPMO_DISCLAIMER,
      scheduler_mode: req.user!.role === 'scheduler',
      recording_note: 'Google Voice records automatically only on Workspace Voice Premier with the admin recording policy enabled.',
    },
  });
});

// ------------------------------------------------------------------ Warm Transfer Engine
/** Initiate Warm Transfer: Schedulers select an available state-licensed agent and transfer prospect call in real-time. */
calls.post('/transfer/initiate', async (req, res) => {
  const { call_id, related_type, related_id, target_agent_id, notes, prospect_data } = req.body;
  let target = await loadTarget(related_type, related_id);

  if (!target && prospect_data && prospect_data.first_name) {
    const { scoreLead } = await import('../services/scoring.ts');
    const score = scoreLead(prospect_data);
    target = await insert('leads', {
      first_name: prospect_data.first_name,
      last_name: prospect_data.last_name || 'Prospect',
      phone: prospect_data.phone || '',
      email: prospect_data.email || null,
      state: prospect_data.state || 'AZ',
      zip: prospect_data.zip || null,
      status: 'Contacted',
      owner_id: req.user!.id,
      source: 'Warm Transfer Prospect',
      notes: notes || 'Warm transfer in progress',
      ...score,
    });
  }

  if (!target) return res.status(404).json({ error: 'Prospect or lead record not found' });

  let targetAgent = await one(
    `SELECT id, name, email, phone, role, npn, states FROM users WHERE id=$1 AND active`,
    [target_agent_id],
  );

  if (!targetAgent && req.body.target_agent_name) {
    targetAgent = await one(
      `SELECT id, name, email, phone, role, npn, states FROM users WHERE lower(name)=lower($1) AND active`,
      [req.body.target_agent_name],
    );
  }

  if (!targetAgent) {
    targetAgent = {
      id: target_agent_id || 'u_principal',
      name: req.body.target_agent_name || 'King Amen Ra',
      email: 'king@iwillglobal.com',
      phone: req.body.target_agent_phone || '(602) 456-9681',
      role: 'admin',
      npn: '16094432',
      states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'],
    };
  }

  const aiWhisper = buildAiWhisperScripts({
    recipient_name: targetAgent.name,
    caller_name: req.user!.name || 'Sarah',
    prospect_name: `${target.first_name || ''} ${target.last_name || ''}`.trim() || 'Beneficiary',
    state: (target.state || 'AZ').toUpperCase(),
    notes: notes || '',
  });

  const transferMeta = {
    warm_transfer: true,
    auto_ai_whisper: true,
    ai_whisper_briefing: aiWhisper.whisper_briefing,
    ai_merge_introduction: aiWhisper.merge_introduction,
    scheduler_id: req.user!.id,
    scheduler_name: req.user!.name,
    target_agent_id: targetAgent.id,
    target_agent_name: targetAgent.name,
    transfer_status: 'Ringing',
    started_at: new Date().toISOString(),
    notes: notes || '',
    prospect_details: prospect_data || {},
  };

  let activity: any = null;
  if (call_id) {
    activity = await update('activities', call_id, {
      status: 'Warm Transfer Ringing',
      assigned_to: targetAgent.id,
      meta: transferMeta,
    });
  } else {
    activity = await insert('activities', {
      type: 'call',
      subject: `🔥 Warm Transfer: ${target.first_name} ${target.last_name} → ${targetAgent.name}`,
      related_type: related_type || 'lead',
      related_id: target.id,
      user_id: req.user!.id,
      assigned_to: targetAgent.id,
      status: 'Warm Transfer Ringing',
      direction: 'outbound',
      phone: target.phone,
      provider: 'google_voice',
      meta: transferMeta,
    });
  }

  const { notify } = await import('../services/automation.ts');
  const { publish } = await import('../realtime.ts');

  // Inform Bland AI that King Amen Ra is on a warm transfer call -> AI selects ONLY Telephone, In-Person, or Video appointments and continues calling!
  try {
    await setWarmTransferStatus({
      on_warm_transfer: true,
      lead_id: target.id,
      call_id: activity.id,
      reason: `Warm Transfer active with ${target.first_name} ${target.last_name} — Bland AI booking Telephone, In-Person, or Video appointments only & continuing calls`,
    });
  } catch { /* ignore */ }

  await notify(
    targetAgent.id,
    `🔥 Incoming Warm Transfer: ${target.first_name} ${target.last_name}`,
    `Scheduler ${req.user!.name} is warm transferring prospect ${target.first_name} ${target.last_name} (${target.state || 'AZ'}). Click to accept call.`,
    `/${related_type || 'lead'}s/${target.id}`,
  );

  publish('inbox', 'warm_transfer_incoming', {
    transfer_id: activity.id,
    customer_name: `${target.first_name} ${target.last_name}`,
    state: target.state || 'AZ',
    scheduler_name: req.user!.name,
    target_agent_id: targetAgent.id,
    target_agent_name: targetAgent.name,
    notes,
  });

  res.json({
    transfer_id: activity.id,
    status: 'Agent Ringing',
    auto_ai_whisper: true,
    ai_whisper_briefing: aiWhisper.whisper_briefing,
    ai_merge_introduction: aiWhisper.merge_introduction,
    target_agent: targetAgent,
    contact: target,
    activity,
  });
});

/** Accept Warm Transfer: Target licensed agent accepts call & briefing. */
calls.post('/transfer/accept', async (req, res) => {
  const { transfer_id } = req.body;
  const activity = await one(`SELECT * FROM activities WHERE id=$1 AND type='call'`, [transfer_id]);
  if (!activity) return res.status(404).json({ error: 'Warm transfer call not found' });

  const updatedMeta = { 
    ...(activity.meta || {}), 
    transfer_status: 'Briefing Connected', 
    accepted_at: new Date().toISOString(),
    picked_up_by_king: true,
  };
  const updated = await update('activities', activity.id, { status: 'Warm Transfer Briefing', meta: updatedMeta });
  const target = await loadTarget(activity.related_type, activity.related_id);
  try {
    await setWarmTransferStatus({
      on_warm_transfer: true,
      lead_id: activity.related_id,
      call_id: activity.id,
      reason: 'Broker on Warm Transfer Briefing — Bland AI booking Telephone, In-Person, or Video appointments only & continuing calls',
    });
  } catch { /* ignore */ }

  const { publish } = await import('../realtime.ts');
  publish('inbox', 'warm_transfer_accepted', { transfer_id: activity.id, agent_id: req.user!.id, agent_name: req.user!.name });

  res.json({
    activity: updated,
    contact: target,
    briefing: {
      scheduler_name: activity.meta?.scheduler_name,
      notes: activity.meta?.notes,
      prospect_details: activity.meta?.prospect_details,
    },
  });
});

/** 3-Way Conference Connect: Schedulers connect agent, scheduler, and prospect into a live 3-way call. */
calls.post('/transfer/3way-connect', async (req, res) => {
  const { transfer_id, call_picked_up_by_king = true } = req.body;
  const activity = await one(`SELECT * FROM activities WHERE id=$1 AND type='call'`, [transfer_id]);
  if (!activity) return res.status(404).json({ error: 'Warm transfer call not found' });

  const updatedMeta = {
    ...(activity.meta || {}),
    three_way_conference: true,
    three_way_active: true,
    three_way_connected_at: new Date().toISOString(),
    picked_up_by_king: Boolean(call_picked_up_by_king),
    transfer_status: '3-Way Conference Live',
  };

  const updated = await update('activities', activity.id, {
    status: '3-Way Conference Live',
    meta: updatedMeta,
  });
  try {
    await setWarmTransferStatus({
      on_warm_transfer: true,
      lead_id: activity.related_id,
      call_id: activity.id,
      reason: 'Broker on live 3-Way Conference — Bland AI booking Telephone, In-Person, or Video appointments only & continuing calls',
    });
  } catch { /* ignore */ }

  const { publish } = await import('../realtime.ts');
  publish('inbox', 'warm_transfer_3way_active', {
    transfer_id: activity.id,
    scheduler_id: req.user!.id,
    scheduler_name: req.user!.name,
    target_agent_id: activity.assigned_to,
  });

  res.json({
    ok: true,
    activity: updated,
    status: '3-Way Conference Live',
  });
});

/** 3-Way Conference Drop: Scheduler drops off 3-way line leaving Agent and Prospect to complete consultation. */
calls.post('/transfer/3way-drop', async (req, res) => {
  const { transfer_id } = req.body;
  const activity = await one(`SELECT * FROM activities WHERE id=$1 AND type='call'`, [transfer_id]);
  if (!activity) return res.status(404).json({ error: 'Warm transfer call not found' });

  const updatedMeta = {
    ...(activity.meta || {}),
    scheduler_dropped_at: new Date().toISOString(),
    agent_prospect_remaining: true,
    transfer_status: '3-Way Scheduler Dropped (Agent & Prospect Active)',
  };

  const updated = await update('activities', activity.id, {
    meta: updatedMeta,
  });

  res.json({
    ok: true,
    activity: updated,
    status: '3-Way Scheduler Dropped',
  });
});

/** Complete Warm Transfer: Handoff call, assign lead/client to licensed agent, and credit scheduler $25 ONLY IF picked up by King. */
calls.post('/transfer/complete', async (req, res) => {
  const { transfer_id, disposition_id = 'warm_transfer_success', notes, policy, three_way_duration_sec, scheduler_dropped, call_picked_up_by_king } = req.body;
  const activity = await one(`SELECT * FROM activities WHERE id=$1 AND type='call'`, [transfer_id]);
  if (!activity) return res.status(404).json({ error: 'Warm transfer not found' });

  const schedulerId = activity.meta?.scheduler_id || activity.user_id || req.user!.id;
  const schedulerName = activity.meta?.scheduler_name || (schedulerId === req.user!.id ? req.user!.name : 'Scheduler');
  const targetAgentId = activity.meta?.target_agent_id || activity.assigned_to || (req.user!.role === 'licensed_agent' ? req.user!.id : '3afbca01-76cd-4fa9-91cc-f3a1a4821276');
  const leadOrClient: any = await loadTarget(activity.related_type, activity.related_id);

  if (activity.related_type === 'lead' && leadOrClient) {
    await update('leads', leadOrClient.id, {
      owner_id: targetAgentId,
      assigned_agent_id: targetAgentId,
      status: 'Contacted (Warm Transferred)',
      last_contacted_at: new Date(),
    });
  }

  const targetAgent = await one(`SELECT id, name, phone, email FROM users WHERE id=$1`, [targetAgentId]);
  const isKing = targetAgentId === '3afbca01-76cd-4fa9-91cc-f3a1a4821276' ||
                 targetAgentId === 'u_principal' ||
                 targetAgent?.email?.toLowerCase() === 'king@iwillglobal.com' ||
                 targetAgent?.name?.toLowerCase().includes('king');

  // ONLY credit scheduler if target agent is King AND call was actually picked up by King!
  const pickedUpByKing = Boolean(
    isKing &&
    (activity.meta?.picked_up_by_king || activity.meta?.accepted_at || activity.meta?.three_way_connected_at || call_picked_up_by_king) &&
    disposition_id === 'warm_transfer_success'
  );

  // Award Scheduler $25.00 Lead Credit ONLY if call was picked up by King!
  if (schedulerId && pickedUpByKing) {
    const periodStr = new Date().toISOString().slice(0, 7);
    await insert('commissions', {
      agent_id: schedulerId,
      type: 'Appointment Set (Warm Transfer)',
      period: periodStr,
      expected_amount: 25.00,
      paid_amount: 25.00,
      status: 'Paid',
      paid_date: new Date().toISOString().slice(0, 10),
    });

    const { notify } = await import('../services/automation.ts');
    await notify(
      schedulerId,
      `🎉 $25 Lead Credit Awarded (Warm Transfer)!`,
      `Warm transfer for ${leadOrClient?.first_name || 'prospect'} was picked up by King and completed. You earned $25.00 lead credit!`,
      `/${activity.related_type}s/${activity.related_id}`,
    );
  }

  // Register Live Consultation Appointment
  const now = new Date();
  const endAt = new Date(now.getTime() + 30 * 60000);
  const clientName = `${leadOrClient?.first_name || 'Prospect'} ${leadOrClient?.last_name || ''}`.trim();
  const targetAgentName = targetAgent?.name || activity.meta?.target_agent_name || 'King Amen Ra';

  const is3Way = activity.meta?.three_way_conference || true;
  const appointmentEvent = await insert('activities', {
    type: 'event',
    subject: `🤝 3-Way Live Consultation (Warm Transfer) — ${clientName || 'Prospect'}`,
    body: `Live 3-way conference call handoff connecting scheduler ${schedulerName}, licensed agent ${targetAgentName}, and prospect ${clientName} on same call. Notes: ${notes || activity.meta?.notes || ''}`,
    related_type: activity.related_type,
    related_id: activity.related_id,
    user_id: schedulerId,
    assigned_to: targetAgentId,
    due_at: now,
    end_at: endAt,
    status: 'Completed',
    completed: true,
    meta: {
      booked_by_user_id: schedulerId,
      booked_by_name: schedulerName,
      appointment_type: 'telephone',
      customer_confirmed: true,
      scheduler_credit_status: pickedUpByKing ? 'Credited' : 'Not Credited (Call Not Picked Up by King)',
      call_picked_up_by_king: pickedUpByKing,
      warm_transfer: true,
      three_way_conference: is3Way,
      three_way_duration_sec: Number(three_way_duration_sec) || 0,
      scheduler_dropped: Boolean(scheduler_dropped),
      transfer_id: activity.id,
      master_calendar_email: 'info@iwillglobal.com',
      master_calendar_synced: true,
    },
  });

  const disposition = (await one(`SELECT * FROM dispositions WHERE id=$1`, [disposition_id]))
    || { label: 'Warm Transfer Complete', category: 'outcome', automation: { opp_stage: 'Needs Analysis' } };

  const { applyDisposition } = await import('../services/automation.ts');
  const result = await applyDisposition({
    user: req.user!,
    call: activity,
    disposition,
    relatedType: activity.related_type,
    relatedId: activity.related_id,
    policy,
  });

  const updated = await update('activities', activity.id, {
    status: 'Completed',
    completed: true,
    disposition_id,
    disposition: disposition.label,
    body: notes || activity.body,
    meta: {
      ...(activity.meta || {}),
      warm_transfer: true,
      three_way_conference: true,
      three_way_duration_sec: Number(three_way_duration_sec) || 0,
      scheduler_dropped: Boolean(scheduler_dropped),
      scheduler_id: schedulerId,
      scheduler_name: schedulerName,
      target_agent_id: targetAgentId,
      target_agent_name: targetAgentName,
      appointment_event_id: appointmentEvent.id,
      call_picked_up_by_king: pickedUpByKing,
      scheduler_credit_status: pickedUpByKing ? 'Credited' : 'Not Credited (Call Not Picked Up by King)',
      transfer_status: pickedUpByKing ? 'Handed Off (3-Way Conference)' : 'Transferred (King Did Not Pick Up)',
      ended_at: new Date().toISOString(),
      actions: result.actions,
    },
  });

  try {
    await setWarmTransferStatus({ on_warm_transfer: false });
  } catch { /* ignore */ }

  res.json({
    activity: updated,
    actions: result.actions,
    appointment_event_id: appointmentEvent.id,
    scheduler_credit_awarded: pickedUpByKing,
    scheduler_amount: pickedUpByKing ? 25.00 : 0,
    credit_status: pickedUpByKing ? 'Credited' : 'Not Credited (Call Not Picked Up by King)',
  });
});

/** Complete a call with a required disposition and run automations. */
calls.post('/:id/complete', async (req, res) => {
  const call = await one(`SELECT * FROM activities WHERE id=$1 AND type='call'`, [req.params.id]);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (call.user_id !== req.user!.id && !isManager(req.user)) return res.status(403).json({ error: 'Not your call' });
  const { disposition_id, notes, duration_sec, tpmo_given, callback_at, appointment_at, agent_id, soa_products, policy } = req.body;
  if (!disposition_id) return res.status(400).json({ error: 'A disposition is required to complete the call' });
  const disposition = await one(`SELECT * FROM dispositions WHERE id=$1 AND active`, [disposition_id]);
  if (!disposition) return res.status(400).json({ error: 'Unknown disposition' });
  if (disposition.automation?.needs_callback_time && !callback_at) return res.status(400).json({ error: 'Pick a callback date/time' });
  if (disposition.automation?.needs_appointment && !appointment_at) return res.status(400).json({ error: 'Pick an appointment date/time' });

  const result = await applyDisposition({
    user: req.user!, call, disposition, relatedType: call.related_type, relatedId: call.related_id,
    callbackAt: callback_at, appointmentAt: appointment_at, agentId: agent_id, soaProducts: soa_products, policy,
  });

  const started = call.meta?.started_at ? new Date(call.meta.started_at).getTime() : Date.now();
  const duration = Number.isFinite(Number(duration_sec)) && Number(duration_sec) > 0 ? Math.round(Number(duration_sec)) : Math.round((Date.now() - started) / 1000);
  let ai_summary: string | null = null;
  if (notes && String(notes).trim().length > 15) {
    try { ai_summary = (await summarizeCall(String(notes), disposition.label, req.user!.role)).summary; } catch { /* optional */ }
  }
  const updated = await update('activities', call.id, {
    status: 'Completed', completed: true, disposition_id, disposition: disposition.label, body: notes || null,
    duration_sec: duration, ai_summary,
    meta: { ...call.meta, ended_at: new Date().toISOString(), tpmo_given: Boolean(tpmo_given), actions: result.actions },
  });
  await audit(req.user!.id, 'call_disposition', 'activities', call.id, { disposition: disposition.label });
  res.json({ call: updated, actions: result.actions, created: result.created });
});

/** Power dialer queue built from lead list filters. Excludes DNC/invalid; due callbacks first, then score. */
calls.get('/queue', async (req, res) => {
  const def = OBJECTS.leads;
  const { sql, params } = buildWhere(def, req.user!, req.query as any);
  const extra = `t.dnc = false AND t.phone_invalid = false AND t.phone IS NOT NULL AND trim(t.phone) != '' AND t.status NOT IN ('Converted','DNC','Unqualified')`;
  const where = sql ? `${sql} AND ${extra}` : `WHERE ${extra}`;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  let rows = await q(
    `SELECT t.* FROM leads t ${where}
     ORDER BY (t.next_callback_at IS NOT NULL AND t.next_callback_at <= now()) DESC, t.score DESC, t.attempts ASC
     LIMIT ${limit}`, params);

  // If a scheduler has no leads assigned yet, pull available callable leads from the Master List Bank unassigned pool
  if (rows.length === 0 && req.user!.role === 'scheduler') {
    const unassignedRows = await q(
      `SELECT t.* FROM leads t
       WHERE (t.owner_id IS NULL OR t.owner_id = '')
         AND t.dnc = false AND t.phone_invalid = false AND t.phone IS NOT NULL AND trim(t.phone) != ''
         AND t.status NOT IN ('Converted','DNC','Unqualified')
       ORDER BY t.score DESC, t.attempts ASC, t.created_at ASC
       LIMIT ${limit}`
    );
    rows = unassignedRows;
  }

  res.json({ rows: rows.map((r) => ({ ...r, callable_now: isWithinCallingHours(r.state) })) });
});

/** Manually log a call that happened outside the CRM (e.g., inbound on Google Voice). */
calls.post('/log', async (req, res) => {
  const { related_type, related_id, direction = 'inbound', notes, duration_sec, disposition_id } = req.body;
  const target = await loadTarget(related_type, related_id);
  if (!target) return res.status(404).json({ error: 'Contact not found' });
  const disposition = disposition_id ? await one(`SELECT * FROM dispositions WHERE id=$1`, [disposition_id]) : null;
  const call = await insert('activities', {
    type: 'call', subject: `${direction === 'inbound' ? 'Inbound' : 'Outbound'} call — ${target.first_name} ${target.last_name}`,
    related_type, related_id, user_id: req.user!.id, status: 'Completed', completed: true, direction,
    phone: toE164(target.phone), provider: 'google_voice', body: notes, duration_sec: Number(duration_sec) || null,
    disposition_id, disposition: disposition?.label || null,
  });
  res.status(201).json(call);
});

/** Quick disposition a prospect directly (e.g. from Copilot or any screen) and run automations. */
calls.post('/quick-disposition', async (req, res) => {
  const { related_type = 'lead', related_id, disposition_id, notes, duration_sec = 60, tpmo_given = false, callback_at, appointment_at, agent_id } = req.body;
  if (!related_id) return res.status(400).json({ error: 'related_id is required' });
  if (!disposition_id) return res.status(400).json({ error: 'disposition_id is required' });

  const target = await loadTarget(related_type, related_id);
  if (!target) return res.status(404).json({ error: 'Prospect not found' });

  const disposition = await one(`SELECT * FROM dispositions WHERE id=$1 AND active`, [disposition_id]);
  if (!disposition) return res.status(400).json({ error: 'Unknown disposition' });

  if (disposition.licensed_only && req.user!.role === 'scheduler') {
    return res.status(403).json({ error: `"${disposition.label}" requires a licensed agent` });
  }
  if (disposition.automation?.needs_callback_time && !callback_at) {
    return res.status(400).json({ error: 'Pick a callback date/time' });
  }
  if (disposition.automation?.needs_appointment && !appointment_at) {
    return res.status(400).json({ error: 'Pick an appointment date/time' });
  }

  const existingCall = await one(
    `SELECT id, meta FROM activities WHERE type='call' AND user_id=$1 AND related_type=$2 AND related_id=$3 AND status='In Progress' ORDER BY created_at DESC LIMIT 1`,
    [req.user!.id, related_type, related_id]
  );

  let call: any;
  if (existingCall) {
    call = await update('activities', existingCall.id, {
      status: 'Completed',
      completed: true,
      disposition_id,
      disposition: disposition.label,
      body: notes || null,
      duration_sec: Number(duration_sec) || 30,
      meta: { ...(existingCall.meta || {}), tpmo_given: Boolean(tpmo_given), ended_at: new Date().toISOString(), source: 'quick_disposition' },
    });
  } else {
    call = await insert('activities', {
      type: 'call',
      subject: `Call disposition — ${target.first_name} ${target.last_name}`,
      related_type,
      related_id,
      user_id: req.user!.id,
      status: 'Completed',
      completed: true,
      direction: 'outbound',
      phone: toE164(target.phone),
      provider: 'google_voice',
      body: notes || null,
      duration_sec: Number(duration_sec) || 60,
      disposition_id,
      disposition: disposition.label,
      meta: { tpmo_given: Boolean(tpmo_given), source: 'quick_disposition' },
    });
  }

  const { applyDisposition } = await import('../services/automation.ts');
  const result = await applyDisposition({
    user: req.user!,
    call,
    disposition,
    relatedType: related_type,
    relatedId: related_id,
    callbackAt: callback_at,
    appointmentAt: appointment_at,
    agentId: agent_id,
  });

  await audit(req.user!.id, 'call_disposition', 'activities', call.id, { disposition: disposition.label, source: 'copilot' });
  res.json({ success: true, call, actions: result.actions, created: result.created });
});

/** Calling analytics: volume, connect rate, disposition mix, per-agent, hour heatmap. */
calls.get('/stats', async (req, res) => {
  const days = Number(req.query.days) || 7;
  const admin = isAdminUser(req.user);
  const userFilter = admin ? (req.query.user_id ? String(req.query.user_id) : null) : req.user!.id;
  const params: any[] = [String(days)];
  let uf = '';
  if (userFilter) { params.push(userFilter); uf = `AND a.user_id = $2`; }
  const base = `FROM activities a LEFT JOIN dispositions d ON d.id = a.disposition_id
                WHERE a.type='call' AND a.created_at >= now() - ($1 || ' days')::interval ${uf}`;
  const totals = await one(
    `SELECT count(*)::int AS calls,
            count(*) FILTER (WHERE d.category IS NOT NULL AND d.category <> 'not_connected')::int AS connects,
            count(*) FILTER (WHERE d.id IN ('appointment_set', 'warm_transfer_success'))::int AS appointments,
            count(*) FILTER (WHERE d.id IN ('soa_sent','soa_signed'))::int AS soas,
            count(*) FILTER (WHERE d.id='app_submitted')::int AS applications,
            COALESCE(sum(a.duration_sec),0)::int AS talk_sec ${base}`, params);
  const mix = await q(`SELECT COALESCE(d.id, 'call_attempted') AS id, COALESCE(d.label, 'Call Placed / Outbound Dial') AS label, COALESCE(d.color, '#64748b') AS color, count(*)::int AS n ${base} GROUP BY 1, 2, 3 ORDER BY n DESC`, params);
  const byAgent = await q(
    `SELECT u.id, u.name, u.role, count(*)::int AS calls,
            count(*) FILTER (WHERE d.category IS NOT NULL AND d.category <> 'not_connected')::int AS connects,
            count(*) FILTER (WHERE d.id IN ('appointment_set', 'warm_transfer_success'))::int AS appointments,
            count(*) FILTER (WHERE d.id='app_submitted')::int AS applications
     ${base.replace('FROM activities a', 'FROM activities a JOIN users u ON u.id = a.user_id')}
     GROUP BY u.id, u.name, u.role ORDER BY calls DESC`, params);
  const heat = await q(
    `SELECT extract(isodow FROM a.created_at AT TIME ZONE 'America/Phoenix')::int AS dow,
            extract(hour FROM a.created_at AT TIME ZONE 'America/Phoenix')::int AS hour,
            count(*)::int AS calls, count(*) FILTER (WHERE d.category IS NOT NULL AND d.category <> 'not_connected')::int AS connects
     ${base} GROUP BY 1,2`, params);
  const daily = await q(
    `SELECT to_char(a.created_at AT TIME ZONE 'America/Phoenix','YYYY-MM-DD') AS day, count(*)::int AS calls,
            count(*) FILTER (WHERE d.category IS NOT NULL AND d.category <> 'not_connected')::int AS connects
     ${base} GROUP BY 1 ORDER BY 1`, params);
  res.json({ totals, mix, byAgent, heat, daily, days, is_admin: admin });
});


