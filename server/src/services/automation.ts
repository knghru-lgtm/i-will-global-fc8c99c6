import { q, one, insert, update, uid } from '../db/index.ts';
import { scoreLead } from './scoring.ts';
import type { AuthUser } from '../auth.ts';
import { config } from '../config.ts';

export interface DispositionAutomation {
  lead_status?: string;
  retry_days?: number;
  needs_callback_time?: boolean;
  needs_appointment?: boolean;
  send_soa?: boolean;
  soa_signed?: boolean;
  set_dnc?: boolean;
  flag_phone_invalid?: boolean;
  opp_stage?: string;
  create_policy?: boolean;
  requeue?: boolean;
  annual_review?: boolean;
  task_subject?: string;
  reassign_to_kamila?: boolean;
}

export async function notify(userId: string, title: string, body = '', link = '') {
  await insert('notifications', { user_id: userId, title, body, link });
}

export async function logSystem(relatedType: string, relatedId: string, subject: string, body = '', userId: string | null = null) {
  return insert('activities', { type: 'system', subject, body, related_type: relatedType, related_id: relatedId, user_id: userId, completed: true });
}

/**
 * Appointment routing for schedulers: pick a licensed agent licensed in the beneficiary's state,
 * free at the requested time, with the lightest upcoming appointment load. Keeps the preferred agent if eligible.
 */
export async function routeAppointment(state: string | null, at: Date, preferredAgentId?: string | null, durationMin = 30) {
  const st = (state || 'AZ').toUpperCase();
  const end = new Date(at.getTime() + durationMin * 60000);
  const bufferMs = 30 * 60 * 1000;
  const bufferedStart = new Date(at.getTime() - bufferMs);
  const bufferedEnd = new Date(end.getTime() + bufferMs);

  const candidates = await q(
    `SELECT u.id, u.name,
       (SELECT count(*)::int FROM activities a WHERE a.assigned_to=u.id AND a.type='event' AND a.due_at BETWEEN now() AND now() + interval '7 days') AS load,
       (SELECT count(*)::int FROM activities a WHERE a.assigned_to=u.id AND a.type='event' AND a.completed=false
          AND a.status NOT IN ('Cancelled', 'Cancelled by Customer', 'No Show')
          AND a.due_at < $2 AND COALESCE(a.end_at, a.due_at + interval '30 minutes') > $1) AS conflicts
     FROM users u
     WHERE u.active AND u.role IN ('licensed_agent','manager','admin') AND u.states @> $3::jsonb
     ORDER BY (CASE WHEN u.id = 'u_principal' OR lower(u.email) = 'king@iwillglobal.com' THEN 0 ELSE 1 END), load ASC, u.name ASC`,
    [bufferedStart, bufferedEnd, JSON.stringify([st])],
  );
  const free = candidates.filter((c) => c.conflicts === 0);
  const preferred = free.find((c) => c.id === preferredAgentId);
  return preferred || free[0] || null;
}

interface ApplyCtx {
  user: AuthUser;
  call: any;
  disposition: any;
  relatedType: string;
  relatedId: string;
  callbackAt?: string | null;
  appointmentAt?: string | null;
  agentId?: string | null;
  soaProducts?: string[];
  policy?: any;
}

/** Runs a disposition's automations and returns human-readable action log. */
export async function applyDisposition(ctx: ApplyCtx): Promise<{ actions: string[]; created: Record<string, any> }> {
  const a: DispositionAutomation = ctx.disposition.automation || {};
  const actions: string[] = [];
  const created: Record<string, any> = {};
  const table = ctx.relatedType === 'client' ? 'clients' : ctx.relatedType === 'lead' ? 'leads' : null;
  const record = table ? await one(`SELECT * FROM ${table} WHERE id=$1`, [ctx.relatedId]) : null;
  const name = record ? `${record.first_name} ${record.last_name}` : 'contact';

  if (ctx.disposition.licensed_only && ctx.user.role === 'scheduler') {
    throw Object.assign(new Error(`"${ctx.disposition.label}" requires a licensed agent`), { status: 403 });
  }

  // Lead bookkeeping
  if (table === 'leads' && record) {
    const alreadyIncremented = ctx.call?.meta?.attempt_incremented;
    const patch: any = {
      attempts: alreadyIncremented ? Math.max(record.attempts || 1, 1) : ((record.attempts || 0) + 1),
      last_disposition: ctx.disposition.label,
      last_contacted_at: new Date(),
    };
    if (a.lead_status) patch.status = a.lead_status;
    else if (ctx.disposition.category === 'connected' && record.status === 'New') patch.status = 'Contacted';
    if (a.set_dnc) { patch.dnc = true; patch.status = 'DNC'; }
    if (a.flag_phone_invalid) patch.phone_invalid = true;
    patch.next_callback_at = null;
    Object.assign(patch, scoreLead({ ...record, ...patch }));
    await update('leads', record.id, patch);
    if (patch.status && patch.status !== record.status) actions.push(`Lead status → ${patch.status}`);
    if (a.set_dnc) actions.push('Marked Do Not Call — dialing blocked');
    if (a.flag_phone_invalid) actions.push('Phone flagged invalid');
  }
  if (table === 'clients' && record && a.set_dnc) {
    await update('clients', record.id, { dnc: true });
    actions.push('Client marked Do Not Call');
  }

  // Non-English / Language Barrier: Unassign from current scheduler & reassign to Kamila
  if (ctx.disposition.id === 'non_english' || a.reassign_to_kamila) {
    const kamila = await one(
      `SELECT id, name, email FROM users WHERE id='u_sch_kmartinez' OR lower(email)='kmartinez@iwillglobal.com' OR lower(name) LIKE '%kami%' LIMIT 1`
    );
    const targetAssigneeId = kamila?.id || 'u_sch_kmartinez';
    const targetAssigneeName = kamila?.name || 'Kamila Martinez';

    if (table === 'leads' && record) {
      const updatedNotes = record.notes
        ? `${record.notes}\n[Language Barrier - Non-English] Unassigned from ${ctx.user.name} and reassigned to ${targetAssigneeName} for Spanish/bilingual outreach.`
        : `[Language Barrier - Non-English] Unassigned from ${ctx.user.name} and reassigned to ${targetAssigneeName} for Spanish/bilingual outreach.`;

      await update('leads', record.id, {
        owner_id: targetAssigneeId,
        status: 'Contacted',
        last_disposition: ctx.disposition.label || 'Non-English / Language Barrier (Reassigned to Kamila)',
        notes: updatedNotes,
      });

      // Insert high-priority follow-up task for Kamila
      const followUpDate = new Date(Date.now() + 2 * 3600000); // 2 hours
      const followUpTask = await insert('activities', {
        type: 'task',
        subject: `🌐 Non-English / Spanish Outreach — ${name}`,
        related_type: 'lead',
        related_id: record.id,
        user_id: ctx.user.id,
        assigned_to: targetAssigneeId,
        due_at: followUpDate,
        status: 'Open',
        priority: 'High',
        body: `Prospect was marked Non-English by ${ctx.user.name}. Reassigned to you for bilingual / Spanish communication. Phone: ${record.phone || ''}`,
        meta: { source: 'disposition', disposition: 'non_english', previous_scheduler: ctx.user.name, reassigned_to: targetAssigneeName },
      });
      created.task = followUpTask;

      // Notify Kamila
      await notify(
        targetAssigneeId,
        '🌐 Non-English Prospect Reassigned to You',
        `${name} (${record.phone || 'No phone'}) was marked Non-English by ${ctx.user.name} and reassigned to your dialer queue.`,
        `/leads/${record.id}`
      );

      actions.push(`Unassigned from ${ctx.user.name} and reassigned to ${targetAssigneeName} for Spanish/bilingual outreach`);
    } else if (table === 'clients' && record) {
      await update('clients', record.id, {
        owner_id: targetAssigneeId,
      });
      actions.push(`Client reassigned to ${targetAssigneeName} for Spanish/bilingual outreach`);
    }
  }

  // Callback task
  const callbackAt = ctx.callbackAt ? new Date(ctx.callbackAt)
    : a.retry_days ? new Date(Date.now() + a.retry_days * 86400000) : null;
  if (callbackAt && (a.needs_callback_time || a.retry_days)) {
    const task = await insert('activities', {
      type: 'task', subject: a.task_subject || `Call back ${name}`, related_type: ctx.relatedType, related_id: ctx.relatedId,
      user_id: ctx.user.id, assigned_to: ctx.user.id, due_at: callbackAt, status: 'Open', priority: a.needs_callback_time ? 'High' : 'Normal',
      meta: { source: 'disposition', disposition: ctx.disposition.label },
    });
    created.task = task;
    if (table === 'leads') await update('leads', ctx.relatedId, { next_callback_at: callbackAt });
    actions.push(`Callback task scheduled ${callbackAt.toLocaleString('en-US', { timeZone: config.agency.timezone, dateStyle: 'medium', timeStyle: 'short' })}`);
  }

  // SOA
  if (a.send_soa || a.soa_signed) {
    const soa = await insert('soas', {
      token: uid().replace(/-/g, ''),
      lead_id: ctx.relatedType === 'lead' ? ctx.relatedId : null,
      client_id: ctx.relatedType === 'client' ? ctx.relatedId : null,
      agent_id: record?.assigned_agent_id || (ctx.user.role === 'scheduler' ? null : ctx.user.id),
      beneficiary_name: name,
      products: ctx.soaProducts?.length ? ctx.soaProducts : ['Medicare Advantage (Part C)', 'Prescription Drug Plan (Part D)'],
      method: a.soa_signed ? 'Verbal (recorded)' : 'E-sign',
      status: a.soa_signed ? 'Signed' : 'Sent',
      signed_at: a.soa_signed ? new Date() : null,
      signer_name: a.soa_signed ? name : null,
    });
    created.soa = soa;
    actions.push(a.soa_signed ? 'Scope of Appointment recorded as signed' : `SOA e-sign link created: ${config.appUrl}/soa/${soa.token}`);
  }

  // Appointment (scheduler → licensed agent routing)
  if (a.needs_appointment && ctx.appointmentAt) {
    const at = new Date(ctx.appointmentAt);
    let agent = ctx.agentId ? await one(`SELECT id,name FROM users WHERE id=$1`, [ctx.agentId]) : null;
    if (!agent) agent = await routeAppointment(record?.state, at, record?.assigned_agent_id);
    const assignee = agent?.id || ctx.user.id;
    const ev = await insert('activities', {
      type: 'event', subject: `Medicare appointment — ${name}`, related_type: ctx.relatedType, related_id: ctx.relatedId,
      user_id: ctx.user.id, assigned_to: assignee, due_at: at, end_at: new Date(at.getTime() + 3600000), status: 'Scheduled',
      body: `Booked by ${ctx.user.name}. Phone: ${record?.phone || ''}`,
      meta: { booked_by: ctx.user.id, source: 'disposition' },
    });
    created.event = ev;
    if (table === 'leads') await update('leads', ctx.relatedId, { assigned_agent_id: assignee, status: 'Appointment Set' });
    if (agent && agent.id !== ctx.user.id) {
      await notify(agent.id, 'New appointment booked', `${name} — ${at.toLocaleString('en-US', { timeZone: config.agency.timezone })} (booked by ${ctx.user.name})`, `/${ctx.relatedType}s/${ctx.relatedId}`);
    }
    actions.push(`Appointment booked with ${agent?.name || ctx.user.name}`);
    try {
      const { createCalendarEvent } = await import('./google.ts');
      const ok = await createCalendarEvent(assignee, { summary: ev.subject, description: ev.body, start: at, end: new Date(at.getTime() + 3600000), attendeeEmail: record?.email });
      if (ok) actions.push('Added to Google Calendar');
    } catch { /* calendar optional */ }
  }

  // Opportunity stage
  if (a.opp_stage) {
    const opp = await one(
      `SELECT * FROM opportunities WHERE (client_id=$1 OR lead_id=$1) AND stage NOT IN ('Enrolled','Lost') ORDER BY updated_at DESC LIMIT 1`,
      [ctx.relatedId]);
    if (opp) {
      await update('opportunities', opp.id, { stage: a.opp_stage, stage_changed_at: new Date() });
      actions.push(`Opportunity "${opp.name}" → ${a.opp_stage}`);
    }
  }

  // Application submitted → pending policy (licensed only)
  if (a.create_policy && ctx.policy) {
    let targetClientId = ctx.relatedId;
    if (ctx.relatedType === 'lead') {
      let existingClient = await one(`SELECT id FROM clients WHERE lead_id=$1`, [ctx.relatedId]);
      if (!existingClient) {
        existingClient = await insert('clients', {
          lead_id: ctx.relatedId,
          first_name: record?.first_name || 'Valued',
          last_name: record?.last_name || 'Client',
          phone: record?.phone,
          email: record?.email,
          state: record?.state || 'AZ',
          owner_id: ctx.user.id,
          source: 'Call Disposition Policy Submission',
        });
        await update('leads', ctx.relatedId, { status: 'Converted' });
        actions.push(`Converted lead to client: ${existingClient.first_name} ${existingClient.last_name}`);
      }
      targetClientId = existingClient.id;
    }

    const pol = await insert('policies', {
      client_id: targetClientId, agent_id: ctx.user.id, status: 'Pending', submitted_at: new Date(),
      carrier: ctx.policy.carrier, plan_name: ctx.policy.plan_name, plan_type: ctx.policy.plan_type || 'MAPD',
      plan_id: ctx.policy.plan_id || null, effective_date: ctx.policy.effective_date || null, premium: Number(ctx.policy.premium || 0),
    });
    created.policy = pol;
    actions.push(`Pending policy created: ${pol.carrier} ${pol.plan_name}`);

    // Award additional $25.00 Policy Sold Bonus to the Scheduler who booked & confirmed the appointment
    try {
      const appt = await one(
        `SELECT meta FROM activities WHERE (related_id=$1 OR related_id=(SELECT lead_id FROM clients WHERE id=$1)) AND type='event' AND meta->>'customer_confirmed' = 'true' LIMIT 1`,
        [ctx.relatedId],
      );
      const schedulerId = appt?.meta?.booked_by_user_id;
      if (schedulerId) {
        const periodStr = new Date().toISOString().slice(0, 7);
        await insert('commissions', {
          policy_id: pol.id,
          agent_id: schedulerId,
          carrier: pol.carrier,
          type: 'Policy Sold Bonus',
          period: periodStr,
          expected_amount: 25.00,
          paid_amount: 25.00,
          status: 'Earned',
          paid_date: new Date().toISOString().slice(0, 10),
        });
        actions.push(`Awarded additional $25.00 Policy Sold Bonus to Scheduler`);
        await notify(
          schedulerId,
          `🎉 $25 Policy Sold Bonus Earned!`,
          `Policy sold for ${name} (${pol.carrier} ${pol.plan_name}). You earned an additional $25.00 bonus! (Total lead payout: $50)`,
          `/clients/${ctx.relatedId}`,
        );
      }
    } catch {
      /* Optional scheduler bonus fallback */
    }
  }

  if (a.annual_review) {
    const y = new Date().getFullYear();
    const reviewAt = new Date(new Date() > new Date(y, 9, 1) ? y + 1 : y, 9, 1, 9);
    const task = await insert('activities', {
      type: 'task', subject: `Annual plan review — ${name}`, related_type: ctx.relatedType, related_id: ctx.relatedId,
      user_id: ctx.user.id, assigned_to: record?.assigned_agent_id || ctx.user.id, due_at: reviewAt, status: 'Open', priority: 'Normal',
      meta: { source: 'disposition' },
    });
    created.review = task;
    actions.push(`Annual review reminder set for ${reviewAt.toDateString()}`);
  }

  
  // If King or an agent dispositions a lead, resume Bland AI outbound calling if it was paused
  try {
    const isKing = ctx.user.id === '3afbca01-76cd-4fa9-91cc-f3a1a4821276' ||
                   ctx.user.id === 'u_principal' ||
                   ctx.user.email?.toLowerCase() === 'king@iwillglobal.com' ||
                   ctx.user.name?.toLowerCase().includes('king');
    if (isKing || ctx.user.role === 'licensed_agent' || ctx.user.role === 'admin' || ctx.user.role === 'manager') {
      const { getBlandConfig, setBlandCallingPause } = await import('./bland.ts');
      const bCfg = await getBlandConfig();
      if (bCfg.is_calling_paused) {
        await setBlandCallingPause(false, null);
        actions.push('Resumed Bland AI outbound dialer following lead disposition');
      }
    }
  } catch (blandErr) {
    // Non-blocking
  }

  if (a.requeue) actions.push('Returned to dial queue');
  return { actions, created };
}

export const DEFAULT_DISPOSITIONS: Array<{ id: string; label: string; category: string; color: string; icon: string; licensed_only?: boolean; automation: DispositionAutomation }> = [
  { id: 'warm_transfer_success', label: 'Warm Transfer Complete', category: 'outcome', color: '#10b981', icon: '📞⚡', automation: { lead_status: 'Contacted (Warm Transferred)', opp_stage: 'Needs Analysis' } },
  { id: 'warm_transfer_failed', label: 'Warm Transfer Failed / Busy', category: 'connected', color: '#f59e0b', icon: '⚠️', automation: { retry_days: 1, needs_appointment: true } },
  { id: 'interested', label: 'Connected – Interested', category: 'connected', color: '#10b981', icon: '👍', automation: { lead_status: 'Contacted', retry_days: 1, task_subject: 'Follow up — interested' } },
  { id: 'soa_sent', label: 'SOA Sent', category: 'connected', color: '#6366f1', icon: '✉️', automation: { lead_status: 'SOA Sent', send_soa: true, retry_days: 1, task_subject: 'Confirm SOA signature' } },
  { id: 'soa_signed', label: 'SOA Signed (Verbal)', category: 'connected', color: '#8b5cf6', icon: '✍️', automation: { lead_status: 'SOA Signed', soa_signed: true, opp_stage: 'SOA Signed' } },
  { id: 'appointment_set', label: 'Appointment Set', category: 'outcome', color: '#c8963e', icon: '📅', automation: { needs_appointment: true, lead_status: 'Appointment Set' } },
  { id: 'app_submitted', label: 'Application Submitted', category: 'outcome', color: '#059669', icon: '🏆', licensed_only: true, automation: { create_policy: true, opp_stage: 'Application Submitted', annual_review: true } },
  { id: 'callback', label: 'Callback Requested', category: 'connected', color: '#0ea5e9', icon: '⏰', automation: { needs_callback_time: true, task_subject: 'Requested callback' } },
  { id: 'voicemail', label: 'Left Voicemail', category: 'not_connected', color: '#f59e0b', icon: '📼', automation: { retry_days: 2, requeue: true, task_subject: 'Retry after voicemail' } },
  { id: 'no_answer', label: 'No Answer', category: 'not_connected', color: '#94a3b8', icon: '📵', automation: { retry_days: 1, requeue: true, task_subject: 'Retry — no answer' } },
  { id: 'busy', label: 'Busy', category: 'not_connected', color: '#a3a3a3', icon: '⛔', automation: { retry_days: 1, requeue: true, task_subject: 'Retry — busy' } },
  { id: 'call_attempted', label: 'Call Placed / Outbound Dial', category: 'not_connected', color: '#64748b', icon: '📞', automation: { requeue: true } },
  { id: 'already_covered', label: 'Already Covered / Happy', category: 'connected', color: '#14b8a6', icon: '😊', automation: { lead_status: 'Nurture', annual_review: true } },
  { id: 'not_interested', label: 'Not Interested', category: 'connected', color: '#ef4444', icon: '👎', automation: { lead_status: 'Nurture' } },
  { id: 'not_eligible', label: 'Not Eligible', category: 'connected', color: '#f97316', icon: '🚫', automation: { lead_status: 'Unqualified' } },
  { id: 'wrong_number', label: 'Wrong Number', category: 'not_connected', color: '#78716c', icon: '❌', automation: { flag_phone_invalid: true } },
  { id: 'non_english', label: 'Non-English / Language Barrier (Reassign to Kamila)', category: 'connected', color: '#0284c7', icon: '🌐', licensed_only: false, automation: { lead_status: 'Contacted', reassign_to_kamila: true } },
  { id: 'dnc', label: 'Do Not Call', category: 'outcome', color: '#b91c1c', icon: '🛑', automation: { set_dnc: true } },
];
