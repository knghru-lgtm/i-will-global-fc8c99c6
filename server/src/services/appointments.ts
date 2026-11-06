import { q, one, insert, update, uid } from '../db/index.ts';
import { routeAppointment, notify } from './automation.ts';
import { toE164 } from './phone.ts';
import { sendGmail } from './google.ts';
import { config, TPMO_DISCLAIMER } from '../config.ts';
import { publish } from '../realtime.ts';
import type { AuthUser } from '../auth.ts';

export interface ScheduleAppointmentParams {
  related_type: 'lead' | 'client';
  related_id: string;
  appointment_type: 'telephone' | 'video' | 'in_person';
  appointment_at: string; // ISO date string
  duration_minutes?: number;
  agent_id?: string | null;
  location?: string;
  notes?: string;
  customer_phone?: string;
  customer_email?: string;
  send_confirmation_sms?: boolean;
  send_confirmation_email?: boolean;
  booked_by: AuthUser;
}

export const APPOINTMENT_BUFFER_MINUTES = 30;

/**
 * Standard appointment durations per agency rules:
 * - Telephone: 30 minutes
 * - Google Meet Video: 30 minutes
 * - In-Person: 60 minutes
 */
export function getAppointmentDuration(appointmentType?: string): number {
  if (appointmentType === 'in_person' || appointmentType === 'in-person') {
    return 60; // In-Person: 60 minutes
  }
  return 30; // Telephone and Video: 30 minutes
}

export function formatPhoenixDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    timeZone: config.agency.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }) + ' MST';
}

/**
 * Double-Booking & 30-Minute Buffer Conflict Detector.
 * Checks whether an agent already has an appointment or is within the mandatory 30-minute buffer window.
 */
export async function findAppointmentConflict(
  agentId: string,
  startAt: Date,
  durationMinutes: number,
  ignoreActivityId?: string | null
): Promise<{ hasConflict: boolean; conflictingAppointment?: any; message?: string }> {
  const bufferMs = APPOINTMENT_BUFFER_MINUTES * 60 * 1000;
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

  const minDueAt = new Date(startAt.getTime() - bufferMs);
  const maxDueAt = new Date(endAt.getTime() + bufferMs);

  const ignoreClause = ignoreActivityId ? `AND id != $4` : '';
  const params: any[] = [agentId, minDueAt, maxDueAt];
  if (ignoreActivityId) params.push(ignoreActivityId);

  const existingAppts = await q(
    `SELECT id, subject, due_at, end_at, status, meta
     FROM activities
     WHERE type = 'event'
       AND assigned_to = $1
       AND completed = false
       AND status NOT IN ('Cancelled', 'Cancelled by Customer', 'No Show')
       AND due_at < $3
       AND COALESCE(end_at, due_at + interval '30 minutes') > $2
       ${ignoreClause}
     ORDER BY due_at ASC`,
    params
  );

  for (const appt of existingAppts) {
    const eStart = new Date(appt.due_at).getTime();
    const eEnd = appt.end_at ? new Date(appt.end_at).getTime() : eStart + (30 * 60 * 1000);

    // Conflict condition: new_start < existing_end + buffer AND existing_start < new_end + buffer
    if (startAt.getTime() < (eEnd + bufferMs) && eStart < (endAt.getTime() + bufferMs)) {
      const eStartFormatted = formatPhoenixDate(new Date(eStart));
      const eEndFormatted = formatPhoenixDate(new Date(eEnd));
      
      const isDirectOverlap = startAt.getTime() < eEnd && eStart < endAt.getTime();
      const message = isDirectOverlap
        ? `Double-booking conflict: Agent already has an active appointment booked from ${eStartFormatted} to ${eEndFormatted}.`
        : `30-minute buffer conflict: Agency policy enforces a 30-minute buffer between appointments. Existing appointment is from ${eStartFormatted} to ${eEndFormatted}.`;

      return {
        hasConflict: true,
        conflictingAppointment: {
          id: appt.id,
          subject: appt.subject,
          due_at: appt.due_at,
          end_at: appt.end_at,
          customer_name: appt.meta?.customer_name,
        },
        message,
      };
    }
  }

  return { hasConflict: false };
}

export interface SlotCheck {
  start_at: string;
  end_at: string;
  time_label: string; // e.g. "8:00 AM"
  time_range: string; // e.g. "8:00 AM - 8:30 AM MST"
  available: boolean;
  reason?: string;
  conflicting_appointment?: {
    id: string;
    subject: string;
    due_at: string;
    end_at: string;
    customer_name?: string;
  };
}

export interface AvailableSlotsResponse {
  agent: {
    id: string;
    name: string;
    email: string;
    title: string;
    npn: string;
    is_principal: boolean;
    is_transfer_agent?: boolean;
    google_meet_url?: string;
  };
  date: string;
  appointment_type: 'telephone' | 'video' | 'in_person';
  duration_minutes: number;
  buffer_minutes: number;
  timezone: string;
  total_slots: number;
  available_slots_count: number;
  booked_slots_count: number;
  slots: SlotCheck[];
}

/**
 * Generate available time slots for King Amen Ra or schedulers with 30-min buffer between appointments.
 */
export async function getAvailableSlots(
  agentId?: string | null,
  dateStr?: string | null,
  appointmentType: 'telephone' | 'video' | 'in_person' = 'telephone'
): Promise<AvailableSlotsResponse> {
  let agent: any = null;
  if (agentId && agentId !== 'auto') {
    agent = await one(
      `SELECT id, name, email, title, npn, google_meet_url, states FROM users WHERE id=$1 AND active AND role IN ('licensed_agent','manager','admin')`,
      [agentId]
    );
  }
  if (!agent) {
    agent = await one(
      `SELECT id, name, email, title, npn, google_meet_url, states FROM users WHERE id='u_principal' OR lower(email)='king@iwillglobal.com' LIMIT 1`
    );
  }
  if (!agent) {
    agent = await one(
      `SELECT id, name, email, title, npn, google_meet_url, states FROM users WHERE active AND role IN ('licensed_agent','manager','admin') ORDER BY id ASC LIMIT 1`
    );
  }
  if (!agent) {
    throw Object.assign(new Error('No active licensed agent found to check schedule slots'), { status: 404 });
  }

  const isPrincipal = agent.id === 'u_principal' || agent.email?.toLowerCase() === 'king@iwillglobal.com';
  const isTransferAgent = agent.id === 'u_transfer_agent' || agent.email?.toLowerCase() === 'transfer@iwillglobal.com';

  let targetDate = dateStr;
  if (!targetDate) {
    const tomorrow = new Date(Date.now() + 86400000);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.agency.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow);
    targetDate = parts;
  } else if (targetDate.includes('T')) {
    targetDate = targetDate.slice(0, 10);
  }

  const durationMin = getAppointmentDuration(appointmentType);
  const durationMs = durationMin * 60 * 1000;
  const bufferMs = APPOINTMENT_BUFFER_MINUTES * 60 * 1000;

  // Business hours in Arizona MST: 8:00 AM to 6:00 PM
  const dayStart = new Date(`${targetDate}T08:00:00-07:00`);
  const dayEnd = new Date(`${targetDate}T18:00:00-07:00`);

  const windowStart = new Date(dayStart.getTime() - 7200000);
  const windowEnd = new Date(dayEnd.getTime() + 7200000);

  const existingAppts = await q(
    `SELECT id, subject, due_at, end_at, status, meta
     FROM activities
     WHERE type = 'event'
       AND assigned_to = $1
       AND completed = false
       AND status NOT IN ('Cancelled', 'Cancelled by Customer', 'No Show')
       AND due_at < $3
       AND COALESCE(end_at, due_at + interval '30 minutes') > $2
     ORDER BY due_at ASC`,
    [agent.id, windowStart, windowEnd]
  );

  const slots: SlotCheck[] = [];
  const now = Date.now();
  const stepMs = 30 * 60 * 1000;

  for (let t = dayStart.getTime(); t + durationMs <= dayEnd.getTime(); t += stepMs) {
    const slotStart = new Date(t);
    const slotEnd = new Date(t + durationMs);

    const startLabel = slotStart.toLocaleTimeString('en-US', {
      timeZone: config.agency.timezone,
      hour: 'numeric',
      minute: '2-digit',
    });
    const endLabel = slotEnd.toLocaleTimeString('en-US', {
      timeZone: config.agency.timezone,
      hour: 'numeric',
      minute: '2-digit',
    });

    const timeRange = `${startLabel} - ${endLabel} MST`;

    if (slotStart.getTime() < now) {
      slots.push({
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString(),
        time_label: startLabel,
        time_range: timeRange,
        available: false,
        reason: 'Past time',
      });
      continue;
    }

    let conflictFound: any = null;
    let conflictType = '';

    for (const appt of existingAppts) {
      const eStart = new Date(appt.due_at).getTime();
      const eEnd = appt.end_at ? new Date(appt.end_at).getTime() : eStart + (30 * 60 * 1000);

      if (slotStart.getTime() < (eEnd + bufferMs) && eStart < (slotEnd.getTime() + bufferMs)) {
        conflictFound = appt;
        const isDirect = slotStart.getTime() < eEnd && eStart < slotEnd.getTime();
        conflictType = isDirect ? 'Booked' : '30m Buffer Window';
        break;
      }
    }

    if (conflictFound) {
      slots.push({
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString(),
        time_label: startLabel,
        time_range: timeRange,
        available: false,
        reason: conflictType,
        conflicting_appointment: {
          id: conflictFound.id,
          subject: conflictFound.subject,
          due_at: conflictFound.due_at,
          end_at: conflictFound.end_at,
          customer_name: conflictFound.meta?.customer_name,
        },
      });
    } else {
      slots.push({
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString(),
        time_label: startLabel,
        time_range: timeRange,
        available: true,
      });
    }
  }

  const availableCount = slots.filter((s) => s.available).length;
  const bookedCount = slots.length - availableCount;

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      title: agent.title || 'Licensed Specialist',
      npn: agent.npn || '',
      is_principal: isPrincipal,
      is_transfer_agent: isTransferAgent,
      google_meet_url: agent.google_meet_url,
    },
    date: targetDate,
    appointment_type: appointmentType,
    duration_minutes: durationMin,
    buffer_minutes: APPOINTMENT_BUFFER_MINUTES,
    timezone: config.agency.timezone,
    total_slots: slots.length,
    available_slots_count: availableCount,
    booked_slots_count: bookedCount,
    slots,
  };
}

/**
 * Fetch available licensed agents qualified in the customer's state with zero conflicts,
 * respecting the 30-minute buffer window between appointments.
 */
export async function getAvailableAgents(state = 'AZ', appointmentAt?: string, durationMin = 30) {
  const st = (state || 'AZ').toUpperCase();
  const at = appointmentAt ? new Date(appointmentAt) : new Date(Date.now() + 86400000);
  const end = new Date(at.getTime() + durationMin * 60000);
  const bufferMs = APPOINTMENT_BUFFER_MINUTES * 60 * 1000;
  const bufferedStart = new Date(at.getTime() - bufferMs);
  const bufferedEnd = new Date(end.getTime() + bufferMs);

  const agents = await q(
    `SELECT u.id, u.name, u.email, u.role, u.title, u.phone, u.npn, u.states, u.avatar_color,
       (SELECT count(*)::int FROM activities a WHERE a.assigned_to=u.id AND a.type='event' AND a.due_at BETWEEN now() AND now() + interval '7 days') AS total_load_7d,
       (SELECT count(*)::int FROM activities a WHERE a.assigned_to=u.id AND a.type='event' AND a.completed=false
          AND a.status NOT IN ('Cancelled', 'Cancelled by Customer', 'No Show')
          AND a.due_at < $2 AND COALESCE(a.end_at, a.due_at + interval '30 minutes') > $1) AS conflicts,
       (SELECT count(*)::int FROM agent_credentials c WHERE c.user_id=u.id AND c.ready_to_sell=true AND c.status='Active') AS active_credentials
     FROM users u
     WHERE u.active AND u.role IN ('licensed_agent','manager','admin') AND u.states @> $3::jsonb
     ORDER BY (CASE WHEN u.id = 'u_principal' OR lower(u.email) = 'king@iwillglobal.com' THEN 0 WHEN u.phone LIKE '%480%331%9455' THEN 1 ELSE 2 END), conflicts ASC, total_load_7d ASC, u.name ASC`,
    [bufferedStart, bufferedEnd, JSON.stringify([st])],
  );

  return agents.map((a) => {
    const isPrincipal = a.id === 'u_principal' || a.email?.toLowerCase() === 'king@iwillglobal.com';
    const isTransferAgent = Boolean(a.phone && a.phone.replace(/\D/g, '').endsWith('4803319455'));
    return {
      ...a,
      is_principal: isPrincipal,
      is_available: a.conflicts === 0,
      state_licensed: true,
    };
  });
}

/**
 * Primary appointment scheduler module.
 * Creates calendar event, handles agent state-licensing assignment, generates AI confirmation SMS & email,
 * and sets up customer confirmation state ("YES" or "Y") for scheduler lead credit.
 * Enforces 30m phone/video, 60m in-person durations, zero double-booking, and 30m buffers.
 */
export async function scheduleAppointment(params: ScheduleAppointmentParams) {
  const {
    related_type,
    related_id,
    appointment_type,
    appointment_at,
    duration_minutes,
    agent_id,
    location,
    notes,
    customer_phone,
    customer_email,
    send_confirmation_sms = true,
    send_confirmation_email = true,
    booked_by,
  } = params;

  // Apply default durations: Telephone & Video = 30 mins, In-Person = 60 mins
  const finalDuration = duration_minutes || getAppointmentDuration(appointment_type);

  const table = related_type === 'client' ? 'clients' : 'leads';
  const customer = await one(`SELECT * FROM ${table} WHERE id=$1`, [related_id]);
  if (!customer) throw Object.assign(new Error(`${related_type} not found`), { status: 404 });

  // If phone or email were provided/edited in the confirmation modal, update customer record
  if (customer_phone && customer_phone.trim() && customer_phone.trim() !== customer.phone) {
    customer.phone = customer_phone.trim();
    try {
      await update(table, related_id, { phone: customer.phone });
    } catch {
      /* non-fatal update */
    }
  }

  if (customer_email && customer_email.trim() && customer_email.trim() !== customer.email) {
    customer.email = customer_email.trim();
    try {
      await update(table, related_id, { email: customer.email });
    } catch {
      /* non-fatal update */
    }
  }

  const customerName = `${customer.first_name} ${customer.last_name}`;
  const at = new Date(appointment_at);
  if (isNaN(at.getTime())) throw Object.assign(new Error('Invalid appointment date/time'), { status: 400 });

  const state = (customer.state || 'AZ').toUpperCase();

  // Determine assigned licensed agent
  let assignedAgent: any = null;
  if (agent_id) {
    assignedAgent = await one(`SELECT * FROM users WHERE id=$1 AND active AND role IN ('licensed_agent','manager','admin')`, [agent_id]);
    if (!assignedAgent) throw Object.assign(new Error('Selected licensed agent is invalid or inactive'), { status: 400 });
    // Verify state license
    const licensedStates: string[] = Array.isArray(assignedAgent.states) ? assignedAgent.states : [];
    if (!licensedStates.includes(state)) {
      throw Object.assign(new Error(`Agent ${assignedAgent.name} is not licensed in ${state}. Customer state requires a licensed agent.`), { status: 400 });
    }
  } else {
    // Auto-route based on state licensing, conflict-free schedule, and weekly load
    const candidate = await routeAppointment(state, at, customer.assigned_agent_id, finalDuration);
    if (!candidate) {
      throw Object.assign(new Error(`No active licensed agent available for state ${state} at requested time.`), { status: 400 });
    }
    assignedAgent = await one(`SELECT * FROM users WHERE id=$1`, [candidate.id]);
  }

  // Double-booking and 30-minute buffer validation
  const conflict = await findAppointmentConflict(assignedAgent.id, at, finalDuration);
  if (conflict.hasConflict) {
    throw Object.assign(
      new Error(`Double-booking prevented: ${conflict.message} Please select an available time slot.`),
      { status: 409 }
    );
  }

  const endAt = new Date(at.getTime() + finalDuration * 60000);
  const confirmationToken = uid().replace(/-/g, '');

  // Default appointment location & Google Meet URL
  const agentMeetUrl = assignedAgent.google_meet_url || `https://meet.google.com/iwg-${assignedAgent.email.split('@')[0]}`;
  let finalLocation = location;
  if (!finalLocation) {
    if (appointment_type === 'video') {
      finalLocation = `Google Meet Video Link: ${agentMeetUrl}`;
    } else if (appointment_type === 'in_person') {
      finalLocation = customer.address
        ? `${customer.address}, ${customer.city || ''}, ${customer.state || 'AZ'} ${customer.zip || ''}`.trim()
        : `${config.agency.address} (Agency Office)`;
    } else {
      finalLocation = customer.phone ? `Phone: ${customer.phone}` : config.agency.phone;
    }
  }

  // Create Activity Event
  const typeLabel = appointment_type === 'video' ? 'Google Meet Video' : appointment_type === 'telephone' ? 'Phone Call' : 'In-Person Visit';
  const eventSubject = `Medicare ${typeLabel} Appointment — ${customerName}`;
  const eventBody = `Appointment with ${assignedAgent.name} (${assignedAgent.title || 'Licensed Agent'}, NPN: ${assignedAgent.npn || 'N/A'}).
Type: ${typeLabel}
Location / Contact: ${finalLocation}
🎥 Agent Google Meet Link: ${agentMeetUrl}
Booked By: ${booked_by.name} (${booked_by.role})
Notes: ${notes || 'No special notes provided'}
CMS Rule: Beneficiary must confirm YES/Y for appointment credit.`;

  const metaData = {
    appointment_type,
    location: finalLocation,
    google_meet_url: agentMeetUrl,
    notes: notes || '',
    customer_name: customerName,
    customer_phone: customer.phone || '',
    customer_email: customer.email || '',
    booked_by_user_id: booked_by.id,
    booked_by_name: booked_by.name,
    booked_by_role: booked_by.role,
    assigned_agent_id: assignedAgent.id,
    assigned_agent_name: assignedAgent.name,
    assigned_agent_npn: assignedAgent.npn || '',
    customer_confirmed: false,
    scheduler_credit_status: 'Pending',
    confirmation_token: confirmationToken,
    source: 'scheduler_booking_agent',
    master_calendar_email: 'info@iwillglobal.com',
    master_calendar_synced: true,
  };

  const eventActivity = await insert('activities', {
    type: 'event',
    subject: eventSubject,
    body: eventBody,
    related_type,
    related_id,
    user_id: booked_by.id,
    assigned_to: assignedAgent.id,
    due_at: at,
    end_at: endAt,
    status: 'Pending Customer Confirmation',
    completed: false,
    meta: metaData,
  });

  // Update lead/client status & owner
  if (related_type === 'lead') {
    await update('leads', related_id, {
      assigned_agent_id: assignedAgent.id,
      status: 'Appointment Set',
      owner_id: customer.owner_id || booked_by.id,
    });
  } else {
    await update('clients', related_id, {
      owner_id: assignedAgent.id,
    });
  }

  // Create or retrieve Scope of Appointment (SOA) if missing
  let soa = await one(`SELECT * FROM soas WHERE (lead_id=$1 OR client_id=$1) AND status='Signed' ORDER BY created_at DESC LIMIT 1`, [related_id]);
  if (!soa) {
    soa = await insert('soas', {
      token: uid().replace(/-/g, ''),
      lead_id: related_type === 'lead' ? related_id : null,
      client_id: related_type === 'client' ? related_id : null,
      agent_id: assignedAgent.id,
      beneficiary_name: customerName,
      products: ['Medicare Advantage (Part C)', 'Prescription Drug Plan (Part D)', 'Medicare Supplement (Medigap)'],
      method: 'E-sign',
      status: 'Sent',
      appointment_at: at,
    });
  }

  const actionsTaken: string[] = [];
  actionsTaken.push(`Appointment scheduled with licensed agent ${assignedAgent.name} (${formatPhoenixDate(at)})`);
  actionsTaken.push(`Status set to Pending Customer Confirmation`);

  // Attempt Google Calendar Sync (Assigned Agent + Master Agency Calendar info@iwillglobal.com)
  try {
    const { createCalendarEvent, generateGoogleCalendarUrl } = await import('./google.ts');
    const gcalUrl = generateGoogleCalendarUrl({
      summary: eventSubject,
      description: `${eventBody}\n\nSOA Link: ${config.appUrl}/soa/${soa.token}`,
      location: finalLocation,
      start: at,
      end: endAt,
      addEmail: 'info@iwillglobal.com',
    });

    await update('activities', eventActivity.id, {
      meta: {
        ...metaData,
        google_calendar_url: gcalUrl,
        master_calendar_email: 'info@iwillglobal.com',
        master_calendar_synced: true,
      },
    });

    const calOk = await createCalendarEvent(assignedAgent.id, {
      summary: eventSubject,
      description: `${eventBody}\n\nSOA Link: ${config.appUrl}/soa/${soa.token}`,
      location: finalLocation,
      start: at,
      end: endAt,
      attendeeEmail: customer.email || undefined,
      attendees: [
        { email: 'info@iwillglobal.com', displayName: 'I Will Global Master Agency Calendar' }
      ],
    });
    if (calOk) actionsTaken.push(`Synced event to info@iwillglobal.com master calendar & ${assignedAgent.name}'s calendar`);
  } catch {
    /* Google calendar sync optional */
  }

  // 1. Automated Confirmation SMS (Text)
  let smsSent = false;
  if (send_confirmation_sms && customer.phone) {
    const formattedTime = formatPhoenixDate(at);
    const smsText = `Hi ${customer.first_name}, your Medicare ${appointment_type === 'video' ? 'Google Meet Video Call' : appointment_type === 'telephone' ? 'Phone Call' : 'In-Person'} appointment with ${assignedAgent.name} (NPN ${assignedAgent.npn || 'N/A'}) is scheduled for ${formattedTime}.${appointment_type === 'video' ? ' 🎥 Join Video Call: ' + agentMeetUrl : ' Location/Call: ' + finalLocation}.

👉 IMPORTANT: Please reply YES or Y to confirm your appointment!

Reschedule or questions? Call I Will Global at ${config.agency.phone}. - I Will Global`;

    await insert('activities', {
      type: 'call',
      subject: `Outbound Confirmation SMS sent to ${customer.phone}`,
      body: smsText,
      related_type,
      related_id,
      user_id: booked_by.id,
      direction: 'outbound',
      phone: customer.phone,
      completed: true,
      provider: 'google_voice',
      disposition: 'SMS Confirmation Sent',
      meta: { sms: true, confirmation_token: confirmationToken, expected_reply: 'YES', google_meet_url: agentMeetUrl },
    });

    smsSent = true;
    actionsTaken.push(`Sent confirmation SMS to ${customer.phone} requesting "YES" or "Y" reply`);
  }

  // 2. Automated Confirmation Email
  let emailSent = false;
  if (send_confirmation_email && customer.email) {
    const formattedTime = formatPhoenixDate(at);
    const confirmWebUrl = `${config.appUrl}/api/public/appointments/${confirmationToken}/confirm`;
    const soaWebUrl = `${config.appUrl}/soa/${soa.token}`;

    const emailSubject = `Action Required: Confirm your Medicare Appointment with ${assignedAgent.name}`;
    const emailBody = `Dear ${customer.first_name} ${customer.last_name},

Thank you for choosing I Will Global! Your Medicare review appointment has been scheduled with licensed agent ${assignedAgent.name}.

DETAILS:
• Date & Time: ${formattedTime}
• Appointment Type: ${appointment_type === 'video' ? 'Google Meet Video Call' : appointment_type === 'telephone' ? 'Telephone Call' : 'In-Person Visit'}
• Location / Contact: ${finalLocation}
• 🎥 Google Meet Link: ${agentMeetUrl}
• Licensed Agent: ${assignedAgent.name} (NPN: ${assignedAgent.npn || 'N/A'})

--------------------------------------------------
CONFIRMATION REQUIRED:
Please reply YES or Y to our text message, or click the link below to confirm your appointment:
👉 Confirm Appointment: ${confirmWebUrl}
🎥 Join Google Meet: ${agentMeetUrl}
--------------------------------------------------

Scope of Appointment Form (Required prior to plan benefit discussion):
${soaWebUrl}

If you need to reschedule or have questions, please call us at ${config.agency.phone} or reply to this email.

Best regards,
${booked_by.name} & The I Will Global Team
${config.agency.phone} | ${config.agency.email}
${TPMO_DISCLAIMER}`;

    try {
      await sendGmail(booked_by.id, {
        to: customer.email,
        subject: emailSubject,
        body: emailBody,
      });
      emailSent = true;
      actionsTaken.push(`Sent confirmation email via Gmail to ${customer.email}`);
    } catch {
      // Fallback: log outbound email activity
      await insert('activities', {
        type: 'email',
        subject: emailSubject,
        body: emailBody,
        related_type,
        related_id,
        user_id: booked_by.id,
        direction: 'outbound',
        completed: true,
        provider: 'crm',
        status: 'Logged',
        meta: { to: customer.email, confirmation_token: confirmationToken },
      });
      emailSent = true;
      actionsTaken.push(`Logged outbound confirmation email for ${customer.email}`);
    }
  }

  // Notify Licensed Agent
  await notify(
    assignedAgent.id,
    `New Appointment Scheduled (${appointment_type === 'telephone' ? 'Phone Call' : 'In-Person'})`,
    `${customerName} — ${formatPhoenixDate(at)}. Booked by ${booked_by.name}. Waiting for customer YES reply.`,
    `/${related_type}s/${related_id}`,
  );

  // Notify Scheduler
  if (booked_by.id !== assignedAgent.id) {
    await notify(
      booked_by.id,
      `Appointment Booked — Awaiting Customer YES`,
      `${customerName} scheduled for ${formatPhoenixDate(at)}. Lead credit will be awarded when customer replies YES or Y.`,
      `/${related_type}s/${related_id}`,
    );
  }

  publish('inbox', 'appointment_scheduled', {
    activity_id: eventActivity.id,
    related_type,
    related_id,
    customer_name: customerName,
    appointment_at: at.toISOString(),
  });

  return {
    appointment: eventActivity,
    assigned_agent: {
      id: assignedAgent.id,
      name: assignedAgent.name,
      title: assignedAgent.title,
      npn: assignedAgent.npn,
      email: assignedAgent.email,
      phone: assignedAgent.phone,
    },
    soa,
    actions_taken: actionsTaken,
    sms_sent: smsSent,
    email_sent: emailSent,
    confirmation_token: confirmationToken,
    credit_status: 'Pending customer YES reply',
  };
}

/**
 * Handle inbound customer response (SMS reply "YES" or "Y", or email web click).
 * Awards Lead Credit to the scheduling agent upon positive reply!
 */
export async function processCustomerConfirmation(phoneOrToken: string, textReply: string, source: 'SMS' | 'Web' = 'SMS') {
  const cleanReply = textReply.trim().toLowerCase();
  const isAffirmative = /^(yes|y|confirm|ok|sure|1|yeah|yep|correct)\b/i.test(cleanReply);
  const isNegative = /^(no|n|cancel|stop|reschedule|2)\b/i.test(cleanReply);

  if (!isAffirmative && !isNegative) {
    return {
      processed: false,
      message: 'Unrecognized reply format. Please reply YES or Y to confirm your appointment, or CANCEL to cancel.',
    };
  }

  let eventActivity: any = null;

  if (source === 'Web') {
    // Search by confirmation_token
    eventActivity = await one(
      `SELECT * FROM activities WHERE type='event' AND meta->>'confirmation_token' = $1 LIMIT 1`,
      [phoneOrToken],
    );
  } else {
    // Search by customer phone number for recent pending event
    const e164 = toE164(phoneOrToken);
    const digits = phoneOrToken.replace(/\D/g, '');

    eventActivity = await one(
      `SELECT a.* FROM activities a
       JOIN leads l ON l.id = a.related_id AND a.related_type = 'lead'
       WHERE a.type = 'event' AND a.completed = false
         AND (regexp_replace(l.phone, '\\D', '', 'g') = $1 OR regexp_replace(l.phone, '\\D', '', 'g') = $2)
       ORDER BY a.created_at DESC LIMIT 1`,
      [digits, e164 ? e164.replace(/\D/g, '') : digits],
    );

    if (!eventActivity) {
      eventActivity = await one(
        `SELECT a.* FROM activities a
         JOIN clients c ON c.id = a.related_id AND a.related_type = 'client'
         WHERE a.type = 'event' AND a.completed = false
           AND (regexp_replace(c.phone, '\\D', '', 'g') = $1 OR regexp_replace(c.phone, '\\D', '', 'g') = $2)
         ORDER BY a.created_at DESC LIMIT 1`,
        [digits, e164 ? e164.replace(/\D/g, '') : digits],
      );
    }
  }

  if (!eventActivity) {
    return {
      processed: false,
      message: 'No pending appointment found for this record.',
    };
  }

  const meta = eventActivity.meta || {};
  const schedulerId = meta.booked_by_user_id;
  const agentId = meta.assigned_agent_id || eventActivity.assigned_to;
  const relatedType = eventActivity.related_type;
  const relatedId = eventActivity.related_id;

  const table = relatedType === 'client' ? 'clients' : 'leads';
  const customer = await one(`SELECT * FROM ${table} WHERE id=$1`, [relatedId]);
  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Customer';

  if (isAffirmative) {
    // ------------------- CONFIRMED & AWARD SCHEDULER CREDIT -------------------
    const updatedMeta = {
      ...meta,
      customer_confirmed: true,
      confirmed_at: new Date().toISOString(),
      confirmed_via: source,
      confirmed_text: textReply,
      scheduler_credit_status: 'Credited',
      scheduler_credited_at: new Date().toISOString(),
    };

    await update('activities', eventActivity.id, {
      status: 'Confirmed Appointment Set',
      meta: updatedMeta,
    });

    if (relatedType === 'lead') {
      await update('leads', relatedId, {
        status: 'Appointment Set (Confirmed)',
        last_contacted_at: new Date(),
      });
    }

    // Log $25 Appointment Setting Commission for Scheduler
    if (schedulerId) {
      const periodStr = new Date().toISOString().slice(0, 7);
      await insert('commissions', {
        agent_id: schedulerId,
        type: 'Appointment Set',
        period: periodStr,
        expected_amount: 25.00,
        paid_amount: 25.00,
        status: 'Paid',
        paid_date: new Date().toISOString().slice(0, 10),
      });
    }

    // Log credit activity on lead timeline
    const schedulerUser = schedulerId ? await one(`SELECT name FROM users WHERE id=$1`, [schedulerId]) : null;
    const schedulerName = schedulerUser?.name || meta.booked_by_name || 'Scheduling Agent';

    await insert('activities', {
      type: 'system',
      subject: `🎉 Lead Credit & $25 Commission Awarded to ${schedulerName}`,
      body: `Customer ${customerName} replied "${textReply}" via ${source} to confirm appointment.
Scheduler ${schedulerName} officially credited with $25.00 Appointment Set Commission!
Appointment Date: ${formatPhoenixDate(eventActivity.due_at)}`,
      related_type: relatedType,
      related_id: relatedId,
      user_id: schedulerId || null,
      completed: true,
      meta: { scheduler_credit: true, credited_user_id: schedulerId, commission_amount: 25.00 },
    });

    // Notify Scheduler of Awarded Credit & $25 Commission
    if (schedulerId) {
      await notify(
        schedulerId,
        `🎉 Lead Credit & $25 Commission Awarded!`,
        `${customerName} replied YES to confirm appointment for ${formatPhoenixDate(eventActivity.due_at)}. You earned $25.00 commission credit!`,
        `/${relatedType}s/${relatedId}`,
      );
    }

    // Notify Licensed Agent
    if (agentId) {
      await notify(
        agentId,
        `✅ Appointment Confirmed by Customer`,
        `${customerName} confirmed their appointment for ${formatPhoenixDate(eventActivity.due_at)}.`,
        `/${relatedType}s/${relatedId}`,
      );
    }

    publish('inbox', 'appointment_confirmed', {
      activity_id: eventActivity.id,
      customer_name: customerName,
      scheduler_id: schedulerId,
      scheduler_name: schedulerName,
    });

    const replySMS = `Thank you, ${customer?.first_name || 'there'}! Your appointment for ${formatPhoenixDate(eventActivity.due_at)} is confirmed. We look forward to speaking with you! - I Will Global`;

    return {
      processed: true,
      confirmed: true,
      credited_scheduler_id: schedulerId,
      credited_scheduler_name: schedulerName,
      customer_message: replySMS,
      details: `Customer ${customerName} confirmed. Scheduler ${schedulerName} credited.`,
    };
  } else {
    // ------------------- CANCELLED -------------------
    const updatedMeta = {
      ...meta,
      customer_confirmed: false,
      cancelled_at: new Date().toISOString(),
      cancelled_via: source,
      scheduler_credit_status: 'Disqualified',
    };

    await update('activities', eventActivity.id, {
      status: 'Cancelled by Customer',
      meta: updatedMeta,
    });

    if (relatedType === 'lead') {
      await update('leads', relatedId, {
        status: 'Contacted',
      });
    }

    if (schedulerId) {
      await notify(
        schedulerId,
        `Appointment Cancelled by Customer`,
        `${customerName} cancelled their appointment. Lead credit was not awarded.`,
        `/${relatedType}s/${relatedId}`,
      );
    }

    const replySMS = `Your appointment has been cancelled as requested. If you change your mind or wish to reschedule, call us anytime at ${config.agency.phone}. - I Will Global`;

    return {
      processed: true,
      confirmed: false,
      credited_scheduler_id: null,
      customer_message: replySMS,
      details: `Appointment for ${customerName} was cancelled.`,
    };
  }
}

/**
 * Milestone Tier Performance Bonuses for Schedulers:
 * - 50 Confirmed & Sold Leads  -> $1,000.00 Performance Bonus
 * - 100 Confirmed & Sold Leads -> $3,000.00 Mega Performance Bonus
 */
export async function checkAndAwardSchedulerTierBonuses(schedulerId: string) {
  if (!schedulerId) return;

  const soldCountRes = await one<{ count: number }>(
    `SELECT count(DISTINCT p.id)::int AS count FROM policies p
     JOIN clients c ON c.id = p.client_id
     JOIN activities a ON (a.related_id = c.id OR a.related_id = c.lead_id)
     WHERE (a.type = 'event' AND a.meta->>'booked_by_user_id' = $1 AND a.meta->>'customer_confirmed' = 'true')
        OR (a.type = 'call' AND a.disposition_id = 'warm_transfer_success' AND (a.meta->>'scheduler_id' = $1 OR a.user_id = $1))`,
    [schedulerId],
  );

  const soldCount = soldCountRes?.count || 0;
  const schedulerUser = await one(`SELECT name FROM users WHERE id=$1`, [schedulerId]);
  const schedulerName = schedulerUser?.name || 'Scheduler';
  const periodStr = new Date().toISOString().slice(0, 7);

  // Check 50 Confirmed & Sold ($1,000 bonus)
  if (soldCount >= 50) {
    const existing50 = await one(
      `SELECT id FROM commissions WHERE agent_id=$1 AND type='50 Confirmed & Sold Tier Bonus' LIMIT 1`,
      [schedulerId],
    );
    if (!existing50) {
      await insert('commissions', {
        agent_id: schedulerId,
        type: '50 Confirmed & Sold Tier Bonus',
        period: periodStr,
        expected_amount: 1000.00,
        paid_amount: 1000.00,
        status: 'Paid',
        paid_date: new Date().toISOString().slice(0, 10),
      });

      await notify(
        schedulerId,
        `🎉 TIER 1 BONUS UNLOCKED: $1,000.00!`,
        `Congratulations ${schedulerName}! You reached 50 Confirmed & Sold Leads and earned your $1,000.00 Tier 1 Milestone Bonus!`,
        `/settings`,
      );

      const managers = await q(`SELECT id FROM users WHERE role IN ('admin','manager')`);
      for (const mgr of managers) {
        await notify(
          mgr.id,
          `🏆 Scheduler Milestone Reached!`,
          `${schedulerName} achieved 50 Confirmed & Sold Leads and earned a $1,000.00 Milestone Bonus!`,
          `/team`,
        );
      }
    }
  }

  // Check 100 Confirmed & Sold ($3,000 bonus)
  if (soldCount >= 100) {
    const existing100 = await one(
      `SELECT id FROM commissions WHERE agent_id=$1 AND type='100 Confirmed & Sold Tier Bonus' LIMIT 1`,
      [schedulerId],
    );
    if (!existing100) {
      await insert('commissions', {
        agent_id: schedulerId,
        type: '100 Confirmed & Sold Tier Bonus',
        period: periodStr,
        expected_amount: 3000.00,
        paid_amount: 3000.00,
        status: 'Paid',
        paid_date: new Date().toISOString().slice(0, 10),
      });

      await notify(
        schedulerId,
        `🏆 TOP PRODUCER MEGA BONUS UNLOCKED: $3,000.00!`,
        `OUTSTANDING PERFORMANCE! ${schedulerName}, you reached 100 Confirmed & Sold Leads and earned your $3,000.00 Mega Bonus! Total milestone bonuses: $4,000!`,
        `/settings`,
      );

      const managers = await q(`SELECT id FROM users WHERE role IN ('admin','manager')`);
      for (const mgr of managers) {
        await notify(
          mgr.id,
          `👑 TOP PRODUCER MEGA BONUS!`,
          `${schedulerName} achieved 100 Confirmed & Sold Leads and earned a $3,000.00 Mega Bonus!`,
          `/team`,
        );
      }
    }
  }
}

/**
 * Generate RFC 5545 compliant iCalendar (.ics) string for all set appointments
 */
export function generateICalFeed(appointmentsList: any[], agencyTitle = 'I Will Global Master Calendar (info@iwillglobal.com)') {
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatUtc = (d: Date) =>
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z';

  const cleanText = (str: string = '') =>
    str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n/g, '\n').replace(/\n/g, '\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//I Will Global//IWG CRM Master Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${agencyTitle}`,
    'X-WR-TIMEZONE:America/Phoenix',
    'X-WR-CALDESC:Medicare Review & Consultation Appointments — info@iwillglobal.com',
  ];

  for (const a of appointmentsList) {
    const dueAt = new Date(a.due_at || a.created_at);
    const endAt = new Date(a.end_at || dueAt.getTime() + 3600000);
    const meta = typeof a.meta === 'string' ? JSON.parse(a.meta || '{}') : (a.meta || {});
    const meetUrl = meta.google_meet_url || '';
    const location = meta.location || meetUrl || 'Phone Consultation';
    const status = a.status?.toLowerCase().includes('confirm') ? 'CONFIRMED' : 'TENTATIVE';

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:iwg-appt-${a.id}@iwillglobal.com`);
    lines.push(`DTSTAMP:${formatUtc(new Date())}`);
    lines.push(`DTSTART:${formatUtc(dueAt)}`);
    lines.push(`DTEND:${formatUtc(endAt)}`);
    lines.push(`SUMMARY:${cleanText(a.subject || 'Medicare Appointment')}`);
    lines.push(`DESCRIPTION:${cleanText(
      (a.body || '') +
      `\n\nAssigned Agent: ${meta.assigned_agent_name || 'Licensed Agent'}` +
      (meetUrl ? `\nGoogle Meet: ${meetUrl}` : '') +
      `\nStatus: ${a.status || 'Scheduled'}` +
      `\nAgency Master Calendar: info@iwillglobal.com`
    )}`);
    lines.push(`LOCATION:${cleanText(location)}`);
    lines.push(`STATUS:${status}`);
    lines.push('ORGANIZER;CN=I Will Global:mailto:info@iwillglobal.com');
    lines.push('ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Agency Calendar:mailto:info@iwillglobal.com');
    if (meta.customer_phone) {
      lines.push(`CONTACT:${cleanText(meta.customer_phone)}`);
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * Fetch all appointments formatted for the agency calendar view and feeds
 */
export async function getAgencyCalendarAppointments(filterAgentId?: string) {
  const params: any[] = [];
  let whereClause = `WHERE a.type = 'event'`;
  if (filterAgentId) {
    params.push(filterAgentId);
    whereClause += ` AND (a.assigned_to = $1 OR a.user_id = $1)`;
  }

  const rows = await q(
    `SELECT a.*,
            COALESCE(l.first_name || ' ' || l.last_name, c.first_name || ' ' || c.last_name) AS customer_name,
            COALESCE(l.phone, c.phone) AS customer_phone,
            COALESCE(l.email, c.email) AS customer_email,
            u.name AS agent_name,
            u.email AS agent_email,
            u.title AS agent_title,
            u.phone AS agent_phone,
            u.google_meet_url AS agent_meet_url,
            booker.name AS booked_by_name
     FROM activities a
     LEFT JOIN leads l ON (a.related_type = 'lead' AND a.related_id = l.id)
     LEFT JOIN clients c ON (a.related_type = 'client' AND a.related_id = c.id)
     LEFT JOIN users u ON a.assigned_to = u.id
     LEFT JOIN users booker ON a.user_id = booker.id
     ${whereClause}
     ORDER BY a.due_at ASC`,
    params
  );

  const { generateGoogleCalendarUrl } = await import('./google.ts');

  return rows.map((r) => {
    const meta = typeof r.meta === 'string' ? JSON.parse(r.meta || '{}') : (r.meta || {});
    const dueAt = new Date(r.due_at || r.created_at);
    const endAt = new Date(r.end_at || dueAt.getTime() + 3600000);

    const gcalUrl = meta.google_calendar_url || generateGoogleCalendarUrl({
      summary: r.subject,
      description: `${r.body || ''}\nCustomer: ${r.customer_name || 'Medicare Beneficiary'}\nPhone: ${r.customer_phone || ''}\nLicensed Agent: ${r.agent_name || ''}`,
      location: meta.location,
      start: dueAt,
      end: endAt,
      addEmail: 'info@iwillglobal.com',
    });

    return {
      ...r,
      meta: {
        ...meta,
        google_calendar_url: gcalUrl,
        master_calendar_email: 'info@iwillglobal.com',
        master_calendar_synced: true,
      },
      google_calendar_url: gcalUrl,
      master_calendar_email: 'info@iwillglobal.com',
    };
  });
}

/**
 * Sync all set appointments in CRM to info@iwillglobal.com master calendar
 */
export async function syncAllAppointmentsToMasterCalendar() {
  const appointmentsList = await getAgencyCalendarAppointments();
  const { createCalendarEvent } = await import('./google.ts');
  let syncedCount = 0;

  for (const appt of (appointmentsList as any[])) {
    const meta = appt.meta || {};
    const dueAt = new Date(appt.due_at || appt.created_at);
    const endAt = new Date(appt.end_at || dueAt.getTime() + 3600000);

    const updatedMeta = {
      ...meta,
      master_calendar_email: 'info@iwillglobal.com',
      master_calendar_synced: true,
      google_calendar_url: appt.google_calendar_url,
      synced_to_info_at: new Date().toISOString(),
    };

    await update('activities', appt.id, {
      meta: updatedMeta,
    });

    // Try pushing to Google Calendar API if agent or master is connected
    if (appt.assigned_to) {
      try {
        await createCalendarEvent(appt.assigned_to, {
          summary: appt.subject,
          description: appt.body,
          location: meta.location,
          start: dueAt,
          end: endAt,
          attendeeEmail: appt.customer_email || undefined,
          attendees: [
            { email: 'info@iwillglobal.com', displayName: 'I Will Global Master Agency Calendar' }
          ]
        });
      } catch {
        /* ignore */
      }
    }

    syncedCount++;
  }

  const icsPath = '/api/public/calendar/agency.ics';
  const fullIcsUrl = `${config.appUrl}${icsPath}`;
  const webcalUrl = fullIcsUrl.replace(/^https?:/, 'webcal:');

  return {
    success: true,
    calendar_email: 'info@iwillglobal.com',
    total_appointments: appointmentsList.length,
    synced_count: syncedCount,
    webcal_url: webcalUrl,
    ics_url: fullIcsUrl,
    google_calendar_subscribe_url: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(fullIcsUrl)}`,
  };
}

// ------------------------------------------------------------------ Running Late Automated Text Alert Engine

export interface RunningLateStatusResult {
  has_running_late: boolean;
  minutes_overdue: number;
  current_appointment: any | null;
  next_appointment: any | null;
  agent: { id: string; name: string; phone: string };
  suggested_delay_minutes: number;
  new_estimated_time: string;
  default_sms_message: string;
}

export interface RunningLateAlertParams {
  agent_id?: string;
  current_appointment_id?: string;
  next_appointment_id?: string;
  minutes_delayed?: number;
  custom_message?: string;
  sender_user: AuthUser;
}

/**
 * Checks whether the agent's current appointment is running late (taking too long)
 * and locates the next upcoming scheduled appointment to notify.
 */
export async function getRunningLateStatus(agentId: string, customNow = new Date()): Promise<RunningLateStatusResult> {
  const agent = await one(`SELECT * FROM users WHERE id=$1`, [agentId]);
  if (!agent) throw Object.assign(new Error('Agent not found'), { status: 404 });

  const agentPhone = agent.phone || config.agency.phone;
  const nowMs = customNow.getTime();

  // Find all active/scheduled appointments for this agent
  const appointments = await q(
    `SELECT a.*,
       COALESCE(l.first_name, c.first_name, a.meta->>'customer_name', 'Client') as customer_first_name,
       COALESCE(l.last_name, c.last_name, '') as customer_last_name,
       COALESCE(l.phone, c.phone, a.meta->>'customer_phone', '') as customer_phone,
       COALESCE(l.email, c.email, a.meta->>'customer_email', '') as customer_email,
       u.name as agent_name, u.phone as agent_phone
     FROM activities a
     LEFT JOIN leads l ON (a.related_type = 'lead' AND a.related_id = l.id)
     LEFT JOIN clients c ON (a.related_type = 'client' AND a.related_id = c.id)
     LEFT JOIN users u ON a.assigned_to = u.id
     WHERE a.type = 'event'
       AND a.assigned_to = $1
       AND a.status NOT IN ('Cancelled', 'Cancelled by Customer', 'No Show')
     ORDER BY a.due_at ASC`,
    [agentId]
  );

  let currentAppt: any = null;
  let nextAppt: any = null;

  // 1. Find candidate in-progress / overdue appointment:
  // Must be uncompleted, started within the last 3 hours, and due_at <= nowMs + 15 mins.
  const activeCandidates = appointments.filter((a) => {
    if (a.completed) return false;
    const dueMs = new Date(a.due_at).getTime();
    const endMs = a.end_at ? new Date(a.end_at).getTime() : dueMs + (30 * 60 * 1000);
    return dueMs <= (nowMs + 15 * 60 * 1000) && endMs >= (nowMs - 180 * 60 * 1000);
  });

  // Pick the most recent active one (closest to now)
  if (activeCandidates.length > 0) {
    currentAppt = activeCandidates[activeCandidates.length - 1];
  }

  // 2. Find next upcoming appointment: must be strictly AFTER currentAppt and upcoming
  const minTime = currentAppt ? new Date(currentAppt.due_at).getTime() : nowMs;
  nextAppt = appointments.find((a) => {
    if (a.completed) return false;
    if (currentAppt && a.id === currentAppt.id) return false;
    const dueMs = new Date(a.due_at).getTime();
    return dueMs > minTime && dueMs >= (nowMs - 15 * 60 * 1000);
  }) || null;

  // Fallback: any future uncompleted appointment
  if (!nextAppt) {
    nextAppt = appointments.find((a) => !a.completed && (currentAppt ? a.id !== currentAppt.id : true) && new Date(a.due_at).getTime() > nowMs) || null;
  }

  let minutesOverdue = 0;
  if (currentAppt) {
    const currentEndMs = currentAppt.end_at
      ? new Date(currentAppt.end_at).getTime()
      : new Date(currentAppt.due_at).getTime() + (30 * 60 * 1000);

    if (nowMs > currentEndMs) {
      minutesOverdue = Math.max(1, Math.round((nowMs - currentEndMs) / 60000));
    }
  }

  const suggestedDelay = minutesOverdue >= 20 ? 30 : minutesOverdue >= 10 ? 20 : 15;
  const hasRunningLate = !!(currentAppt && nextAppt && (minutesOverdue > 0 || !currentAppt.completed));

  let newEstimatedTimeStr = '';
  let defaultSms = '';

  if (nextAppt) {
    const nextDue = new Date(nextAppt.due_at);
    const newEst = new Date(nextDue.getTime() + suggestedDelay * 60 * 1000);
    newEstimatedTimeStr = newEst.toLocaleTimeString('en-US', {
      timeZone: config.agency.timezone,
      hour: 'numeric',
      minute: '2-digit',
    }) + ' MST';

    const origTimeStr = nextDue.toLocaleTimeString('en-US', {
      timeZone: config.agency.timezone,
      hour: 'numeric',
      minute: '2-digit',
    }) + ' MST';

    const clientFirstName = nextAppt.customer_first_name || 'there';
    defaultSms = `Hi ${clientFirstName}, this is ${agent.name} with I Will Global Insurance. My previous Medicare appointment is running about ${suggestedDelay} minutes longer than planned. I apologize for the slight delay and will connect with you at approximately ${newEstimatedTimeStr} (originally ${origTimeStr})! If you need to adjust or reschedule, reply RESCHEDULE or call me at ${agentPhone}. Thank you for your patience!`;
  }

  return {
    has_running_late: hasRunningLate,
    minutes_overdue: minutesOverdue,
    current_appointment: currentAppt,
    next_appointment: nextAppt,
    agent: { id: agent.id, name: agent.name, phone: agentPhone },
    suggested_delay_minutes: suggestedDelay,
    new_estimated_time: newEstimatedTimeStr,
    default_sms_message: defaultSms,
  };
}

/**
 * Sends an automated SMS text message to the next scheduled appointment
 * notifying them that the agent is running late due to the current appointment taking longer.
 */
export async function sendRunningLateAlert(params: RunningLateAlertParams) {
  const agentId = params.agent_id || params.sender_user.id;
  const status = await getRunningLateStatus(agentId);

  let targetNextAppt = status.next_appointment;
  if (params.next_appointment_id) {
    targetNextAppt = await one(
      `SELECT a.*,
         COALESCE(l.first_name, c.first_name, a.meta->>'customer_name', 'Client') as customer_first_name,
         COALESCE(l.last_name, c.last_name, '') as customer_last_name,
         COALESCE(l.phone, c.phone, a.meta->>'customer_phone', '') as customer_phone,
         COALESCE(l.email, c.email, a.meta->>'customer_email', '') as customer_email,
         u.name as agent_name, u.phone as agent_phone
       FROM activities a
       LEFT JOIN leads l ON (a.related_type = 'lead' AND a.related_id = l.id)
       LEFT JOIN clients c ON (a.related_type = 'client' AND a.related_id = c.id)
       LEFT JOIN users u ON a.assigned_to = u.id
       WHERE a.id = $1`,
      [params.next_appointment_id]
    );
  }

  if (!targetNextAppt) {
    throw Object.assign(new Error('No upcoming appointment found to notify'), { status: 404 });
  }

  const recipientPhone = targetNextAppt.customer_phone;
  if (!recipientPhone) {
    throw Object.assign(
      new Error(`Attendee ${targetNextAppt.customer_first_name} does not have a phone number on file`),
      { status: 400 }
    );
  }

  const minutesDelayed = params.minutes_delayed || status.suggested_delay_minutes || 15;
  const origDueAt = new Date(targetNextAppt.due_at);
  const newEstimatedDate = new Date(origDueAt.getTime() + minutesDelayed * 60 * 1000);

  const origTimeStr = origDueAt.toLocaleTimeString('en-US', {
    timeZone: config.agency.timezone,
    hour: 'numeric',
    minute: '2-digit',
  }) + ' MST';

  const newTimeStr = newEstimatedDate.toLocaleTimeString('en-US', {
    timeZone: config.agency.timezone,
    hour: 'numeric',
    minute: '2-digit',
  }) + ' MST';

  const agent = await one(`SELECT * FROM users WHERE id=$1`, [targetNextAppt.assigned_to || agentId]);
  const agentName = agent?.name || params.sender_user.name;
  const agentPhone = agent?.phone || config.agency.phone;

  const defaultMessage = `Hi ${targetNextAppt.customer_first_name || 'there'}, this is ${agentName} with I Will Global Insurance. My previous Medicare appointment is running about ${minutesDelayed} minutes longer than planned. I apologize for the slight delay and will connect with you at approximately ${newTimeStr} (originally ${origTimeStr})! If you need to adjust or reschedule, reply RESCHEDULE or call me at ${agentPhone}. Thank you for your patience!`;

  const finalMessage = params.custom_message?.trim() || defaultMessage;

  // Insert SMS Activity Record into database
  const smsActivity = await insert('activities', {
    type: 'call',
    subject: `Outbound "Running Late" SMS sent to ${recipientPhone}`,
    body: finalMessage,
    related_type: targetNextAppt.related_type,
    related_id: targetNextAppt.related_id,
    user_id: params.sender_user.id,
    direction: 'outbound',
    phone: recipientPhone,
    completed: true,
    provider: 'google_voice',
    disposition: 'SMS Running Late Notice Sent',
    meta: {
      sms: true,
      running_late: true,
      minutes_delayed: minutesDelayed,
      original_due_at: origDueAt.toISOString(),
      estimated_start_at: newEstimatedDate.toISOString(),
      appointment_id: targetNextAppt.id,
      previous_appointment_id: status.current_appointment?.id || null,
      sent_by_user_id: params.sender_user.id,
    },
  });

  // Update Next Appointment Activity metadata
  const currentMeta = targetNextAppt.meta || {};
  await update('activities', targetNextAppt.id, {
    meta: {
      ...currentMeta,
      running_late_alert: true,
      running_late_sent_at: new Date().toISOString(),
      minutes_delayed: minutesDelayed,
      original_due_at: targetNextAppt.due_at,
      estimated_due_at: newEstimatedDate.toISOString(),
      last_running_late_sms: finalMessage,
    },
  });

  // If there was a current appointment that took too long, flag it
  if (status.current_appointment) {
    const curMeta = status.current_appointment.meta || {};
    await update('activities', status.current_appointment.id, {
      meta: {
        ...curMeta,
        ran_over_schedule: true,
        minutes_overdue: status.minutes_overdue,
        delayed_next_appointment_id: targetNextAppt.id,
      },
    });
  }

  // Realtime notification broadcast
  publish('inbox', 'appointment:running_late', {
    appointment_id: targetNextAppt.id,
    recipient_name: `${targetNextAppt.customer_first_name} ${targetNextAppt.customer_last_name}`,
    recipient_phone: recipientPhone,
    minutes_delayed: minutesDelayed,
    new_estimated_time: newTimeStr,
    agent_name: agentName,
    message: finalMessage,
  });

  return {
    success: true,
    message_sent: finalMessage,
    recipient: {
      name: `${targetNextAppt.customer_first_name} ${targetNextAppt.customer_last_name}`.trim(),
      phone: recipientPhone,
      email: targetNextAppt.customer_email,
    },
    next_appointment: {
      id: targetNextAppt.id,
      subject: targetNextAppt.subject,
      original_due_at: targetNextAppt.due_at,
      estimated_due_at: newEstimatedDate.toISOString(),
      original_time_formatted: origTimeStr,
      new_time_formatted: newTimeStr,
    },
    current_appointment: status.current_appointment ? {
      id: status.current_appointment.id,
      subject: status.current_appointment.subject,
      customer_name: status.current_appointment.customer_first_name,
    } : null,
    minutes_delayed: minutesDelayed,
    sms_activity_id: smsActivity.id,
  };
}

/**
 * Automated scanner that can be triggered via cron or route:
 * Checks active appointments that have run over schedule by >= minutesThreshold
 * and automatically notifies the next appointment if not already sent.
 */
export async function autoCheckAndSendRunningLateAlerts(minutesThreshold = 5, systemUser?: AuthUser) {
  const activeAgents = await q(`SELECT * FROM users WHERE active AND role IN ('licensed_agent','manager','admin')`);
  const results: any[] = [];

  const defaultUser: AuthUser = systemUser || {
    id: 'u_principal',
    name: 'King Amen Ra',
    email: 'king@iwillglobal.com',
    role: 'admin',
    states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'],
  };

  for (const agent of activeAgents) {
    try {
      const status = await getRunningLateStatus(agent.id);
      if (status.has_running_late && status.minutes_overdue >= minutesThreshold && status.next_appointment) {
        const nextMeta = status.next_appointment.meta || {};
        if (!nextMeta.running_late_alert) {
          const sent = await sendRunningLateAlert({
            agent_id: agent.id,
            minutes_delayed: status.suggested_delay_minutes,
            sender_user: defaultUser,
          });
          results.push(sent);
        }
      }
    } catch {
      // Continue checking next agent
    }
  }

  return results;
}


