import { Router } from 'express';
import {
  getAvailableAgents,
  getAvailableSlots,
  getAppointmentDuration,
  scheduleAppointment,
  processCustomerConfirmation,
  getAgencyCalendarAppointments,
  syncAllAppointmentsToMasterCalendar,
  generateICalFeed,
  APPOINTMENT_BUFFER_MINUTES,
  getRunningLateStatus,
  sendRunningLateAlert,
  autoCheckAndSendRunningLateAlerts,
} from '../services/appointments.ts';
import { requireAuth, isManager, isAdminUser } from '../auth.ts';
import { q, one, audit } from '../db/index.ts';
import { config } from '../config.ts';

export const appointments = Router();
export const publicAppointments = Router();

// ------------------------------------------------------------------ Authenticated Routes
function isAgentOrAdmin(u?: any): boolean {
  if (!u) return false;
  return u.role === 'admin' || u.role === 'licensed_agent' || u.email?.toLowerCase() === 'king@iwillglobal.com' || u.email?.toLowerCase() === 'aneesha@iwillglobal.com';
}

function isAdminOnly(u?: any): boolean {
  if (!u) return false;
  return u.role === 'admin' || u.email?.toLowerCase() === 'king@iwillglobal.com' || u.email?.toLowerCase() === 'aneesha@iwillglobal.com';
}

/** Check if agent is running late due to current appointment taking too long - ADMIN & AGENTS ONLY */
appointments.get('/running-late-status', async (req, res) => {
  try {
    if (!isAgentOrAdmin(req.user)) {
      return res.status(403).json({ error: 'Running late alerts are only available for administrators and licensed agents' });
    }
    const targetAgentId = (isAdminOnly(req.user) && req.query.agent_id) ? String(req.query.agent_id) : req.user!.id;
    const status = await getRunningLateStatus(targetAgentId);
    res.json(status);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Send automated SMS text to next appointment informing client the agent is running late - ADMIN & AGENTS ONLY */
appointments.post('/running-late', async (req, res) => {
  try {
    if (!isAgentOrAdmin(req.user)) {
      return res.status(403).json({ error: 'Running late alerts are only available for administrators and licensed agents' });
    }
    const targetAgentId = (isAdminOnly(req.user) && req.body.agent_id) ? String(req.body.agent_id) : req.user!.id;
    const result = await sendRunningLateAlert({
      agent_id: targetAgentId,
      current_appointment_id: req.body.current_appointment_id,
      next_appointment_id: req.body.next_appointment_id,
      minutes_delayed: req.body.minutes_delayed ? Number(req.body.minutes_delayed) : undefined,
      custom_message: req.body.custom_message,
      sender_user: req.user!,
    });

    await audit(req.user!.id, 'send_running_late_sms', 'appointment', result.next_appointment.id, {
      recipient: result.recipient,
      minutes_delayed: result.minutes_delayed,
      new_estimated_time: result.next_appointment.new_time_formatted,
    });

    res.json(result);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Automated scanner for overdue active appointments - ADMIN & AGENTS ONLY */
appointments.post('/auto-running-late-check', async (req, res) => {
  try {
    if (!isAgentOrAdmin(req.user)) {
      return res.status(403).json({ error: 'Running late alerts are only available for administrators and licensed agents' });
    }
    const threshold = req.body.minutes_threshold ? Number(req.body.minutes_threshold) : 5;
    const results = await autoCheckAndSendRunningLateAlerts(threshold, req.user!);
    res.json({ checked_at: new Date().toISOString(), triggered_count: results.length, alerts: results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** List available state-licensed agents for a given state & date/time */
appointments.get('/available-agents', async (req, res) => {
  const state = String(req.query.state || 'AZ');
  const at = req.query.at ? String(req.query.at) : undefined;
  const durationMin = req.query.duration ? Number(req.query.duration) : 30;
  res.json(await getAvailableAgents(state, at, durationMin));
});

/**
 * Available Time Slots Explorer & Conflict Checker
 * Allows King Amen Ra and schedulers to see available time slots on any given date,
 * respecting 30m telephone/video, 60m in-person durations, and 30m buffer spacing.
 */
appointments.get('/available-slots', async (req, res) => {
  try {
    const agentId = req.query.agent_id ? String(req.query.agent_id) : undefined;
    const date = req.query.date ? String(req.query.date) : undefined;
    const apptType = (req.query.appointment_type === 'in_person' ? 'in_person' : req.query.appointment_type === 'video' ? 'video' : 'telephone');
    const slots = await getAvailableSlots(agentId, date, apptType);
    res.json(slots);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Schedule a Telephone, Video, or In-Person appointment with a state-licensed agent */
appointments.post('/schedule', async (req, res) => {
  try {
    const apptType = req.body.appointment_type === 'in_person' ? 'in_person' : req.body.appointment_type === 'video' ? 'video' : 'telephone';
    const defaultDur = getAppointmentDuration(apptType);
    const durationMinutes = req.body.duration_minutes ? Number(req.body.duration_minutes) : defaultDur;

    const result = await scheduleAppointment({
      related_type: req.body.related_type === 'client' ? 'client' : 'lead',
      related_id: req.body.related_id,
      appointment_type: apptType,
      appointment_at: req.body.appointment_at,
      duration_minutes: durationMinutes,
      agent_id: req.body.agent_id || null,
      location: req.body.location || undefined,
      notes: req.body.notes || undefined,
      customer_phone: req.body.customer_phone || undefined,
      customer_email: req.body.customer_email || undefined,
      send_confirmation_sms: req.body.send_confirmation_sms !== false,
      send_confirmation_email: req.body.send_confirmation_email !== false,
      booked_by: req.user!,
    });

    await audit(req.user!.id, 'schedule_appointment', req.body.related_type, req.body.related_id, {
      appointment_id: result.appointment.id,
      assigned_agent_id: result.assigned_agent.id,
      type: req.body.appointment_type,
    });

    res.status(201).json(result);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Manual override: Admin/Manager can manually award scheduler lead credit if customer confirmed verbally */
appointments.post('/:id/confirm-manual', async (req, res) => {
  if (!isManager(req.user)) return res.status(403).json({ error: 'Managers only' });
  const result = await processCustomerConfirmation(req.params.id, 'YES', 'Web');
  res.json(result);
});

/** Scheduler Lead Credits & Tier Milestone Bonuses Leaderboard */
appointments.get('/scheduler-credits', async (req, res) => {
  const admin = isAdminUser(req.user);
  let userCondition = `u.active AND u.role IN ('scheduler', 'manager', 'admin')`;
  const params: any[] = [];
  if (!admin) {
    params.push(req.user!.id);
    userCondition = `u.active AND u.id = $1`;
  }

  const credits = await q(
    `SELECT u.id AS user_id, u.name AS user_name, u.avatar_color,
       count(a.*) FILTER (WHERE (a.type='event' AND a.meta->>'booked_by_user_id' = u.id) OR (a.type='call' AND a.disposition_id='warm_transfer_success' AND (a.meta->>'scheduler_id' = u.id OR a.user_id = u.id)))::int AS total_booked,
       count(a.*) FILTER (WHERE (a.type='event' AND a.meta->>'booked_by_user_id' = u.id AND a.meta->>'scheduler_credit_status' = 'Credited') OR (a.type='call' AND a.disposition_id='warm_transfer_success' AND a.meta->>'scheduler_credit_status' = 'Credited' AND (a.meta->>'scheduler_id' = u.id OR a.user_id = u.id)))::int AS confirmed_credits,
       count(a.*) FILTER (WHERE a.type='event' AND a.meta->>'booked_by_user_id' = u.id AND a.status = 'Cancelled by Customer')::int AS cancelled,
       (SELECT count(DISTINCT p.id)::int FROM policies p
        JOIN clients cl ON cl.id = p.client_id
        JOIN activities act ON (act.related_id = cl.id OR act.related_id = cl.lead_id)
        WHERE (act.type = 'event' AND act.meta->>'booked_by_user_id' = u.id AND act.meta->>'customer_confirmed' = 'true')
           OR (act.type = 'call' AND act.disposition_id = 'warm_transfer_success' AND (act.meta->>'scheduler_id' = u.id OR act.user_id = u.id))) AS confirmed_and_sold
     FROM users u
     LEFT JOIN activities a ON ((a.type='event' AND a.meta->>'booked_by_user_id' = u.id)
                            OR (a.type='call' AND a.disposition_id='warm_transfer_success' AND (a.meta->>'scheduler_id' = u.id OR a.user_id = u.id)))
                            AND NOT (a.type='call' AND EXISTS (SELECT 1 FROM activities e WHERE e.type='event' AND e.meta->>'transfer_id' = a.id))
     WHERE ${userCondition}
     GROUP BY u.id, u.name, u.avatar_color
     ORDER BY confirmed_and_sold DESC, confirmed_credits DESC, total_booked DESC`,
    params,
  );

  res.json(
    credits.map((c) => {
      const sold = c.confirmed_and_sold || 0;
      const tier50 = sold >= 50;
      const tier100 = sold >= 100;
      const baseEarnings = (c.confirmed_credits * 25) + (sold * 25);
      const bonusEarnings = (tier50 ? 1000 : 0) + (tier100 ? 3000 : 0);

      return {
        ...c,
        confirmed_and_sold: sold,
        confirmation_rate: c.total_booked > 0 ? Math.round((c.confirmed_credits / c.total_booked) * 100) : 0,
        tier_50_progress: Math.min(100, Math.round((sold / 50) * 100)),
        tier_100_progress: Math.min(100, Math.round((sold / 100) * 100)),
        tier_50_achieved: tier50,
        tier_100_achieved: tier100,
        bonus_earnings: bonusEarnings,
        total_earnings: baseEarnings + bonusEarnings,
      };
    }),
  );
});

/** Agency Master Calendar (info@iwillglobal.com): List all scheduled appointments with Google Calendar links */
appointments.get('/calendar', async (req, res) => {
  const agentFilter = req.query.agent_id ? String(req.query.agent_id) : undefined;
  const list = await getAgencyCalendarAppointments(agentFilter);

  const icsPath = '/api/public/calendar/agency.ics';
  const fullIcsUrl = `${config.appUrl}${icsPath}`;
  const webcalUrl = fullIcsUrl.replace(/^https?:/, 'webcal:');

  res.json({
    calendar_email: 'info@iwillglobal.com',
    agency_name: config.agency.name,
    total_appointments: list.length,
    webcal_url: webcalUrl,
    ics_url: fullIcsUrl,
    google_calendar_subscribe_url: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(fullIcsUrl)}`,
    appointments: list,
  });
});

/** Sync all existing and upcoming appointments to info@iwillglobal.com master calendar */
appointments.post('/sync-master-calendar', async (req, res) => {
  const result = await syncAllAppointmentsToMasterCalendar();
  await audit(req.user!.id, 'sync_master_calendar', 'calendar', 'info@iwillglobal.com', result);
  res.json(result);
});

/** Authenticated iCal feed */
appointments.get('/calendar.ics', async (_req, res) => {
  const list = await getAgencyCalendarAppointments();
  const icsContent = generateICalFeed(list, 'I Will Global Master Calendar (info@iwillglobal.com)');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="iwillglobal-appointments.ics"');
  res.send(icsContent);
});

// ------------------------------------------------------------------ Public / Web Confirmation Endpoints
/** Inbound SMS simulator / webhook for customer YES / Y reply */
publicAppointments.post('/sms/inbound', async (req, res) => {
  const phone = req.body.phone || req.body.From || req.body.from;
  const text = req.body.text || req.body.Body || req.body.body || '';

  if (!phone || !text) return res.status(400).json({ error: 'phone and text required' });

  const result = await processCustomerConfirmation(String(phone), String(text), 'SMS');
  res.json(result);
});

/** Web confirmation page when customer clicks email link */
publicAppointments.get('/confirm-appointment/:token', async (req, res) => {
  const token = req.params.token;
  const result = await processCustomerConfirmation(token, 'YES', 'Web');

  if (result.processed && result.confirmed) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Appointment Confirmed — I Will Global</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Inter', -apple-system, sans-serif; background: #051039; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
          .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(200,150,62,0.3); border-radius: 16px; padding: 40px 30px; max-width: 480px; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.5); backdrop-filter: blur(10px); }
          .icon { font-size: 64px; margin-bottom: 16px; }
          h1 { color: #c8963e; margin: 0 0 10px; font-size: 26px; }
          p { color: #cbd5e1; font-size: 16px; line-height: 1.6; margin-bottom: 24px; }
          .btn { background: linear-gradient(135deg, #c8963e, #936021); color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; display: inline-block; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h1>Appointment Confirmed!</h1>
          <p>${result.details || 'Thank you! Your Medicare review appointment with I Will Global is confirmed. We look forward to speaking with you.'}</p>
          <a href="https://iwillglobal.com" class="btn">Return to iwillglobal.com</a>
        </div>
      </body>
      </html>
    `);
  } else {
    res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Appointment Notice — I Will Global</title>
        <style>
          body { font-family: sans-serif; background: #051039; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
          .card { background: rgba(255,255,255,0.06); border-radius: 16px; padding: 40px; max-width: 480px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Notice</h2>
          <p>${result.message || 'Appointment confirmation request could not be processed.'}</p>
        </div>
      </body>
      </html>
    `);
  }
});

/**
 * Public iCal (.ics) calendar feed for info@iwillglobal.com
 * Allows Google Calendar, Apple Calendar, and Outlook to subscribe and sync all set appointments automatically.
 */
const handlePublicICal = async (_req: any, res: any) => {
  const list = await getAgencyCalendarAppointments();
  const icsContent = generateICalFeed(list, 'I Will Global Master Calendar (info@iwillglobal.com)');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Disposition', 'inline; filename="agency-appointments.ics"');
  res.send(icsContent);
};

publicAppointments.get('/calendar/agency.ics', handlePublicICal);
publicAppointments.get('/calendar/info@iwillglobal.com.ics', handlePublicICal);
// Handle typo alias info@iwillgloabl.com as requested by user
publicAppointments.get('/calendar/info@iwillgloabl.com.ics', handlePublicICal);
publicAppointments.get('/calendar.ics', handlePublicICal);

/** CAN-SPAM & Google/Yahoo required 1-Click Unsubscribe Handler */
publicAppointments.get('/unsubscribe', async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (email) {
    await q(`UPDATE leads SET dnc=true, status='DNC' WHERE lower(email)=$1`, [email]);
    await q(`UPDATE clients SET dnc=true WHERE lower(email)=$1`, [email]);
  }
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Unsubscribed — I Will Global</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: 'Inter', -apple-system, sans-serif; background: #051039; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
        .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(200,150,62,0.3); border-radius: 16px; padding: 40px 30px; max-width: 480px; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
        h1 { color: #c8963e; margin: 0 0 10px; font-size: 24px; }
        p { color: #cbd5e1; font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div style="font-size: 48px; margin-bottom: 12px;">✅</div>
        <h1>Unsubscribed Successfully</h1>
        <p>Your email address <strong>${email || 'on file'}</strong> has been removed from marketing communications from I Will Global in compliance with CAN-SPAM and Google/Yahoo sender standards.</p>
        <div style="font-size: 13px; color: #94a3b8;">I Will Global | 4800 N Scottsdale Rd, Scottsdale, AZ 85251</div>
      </div>
    </body>
    </html>
  `);
});

publicAppointments.post('/unsubscribe', async (req, res) => {
  const email = String(req.body.email || req.query.email || '').trim().toLowerCase();
  if (email) {
    await q(`UPDATE leads SET dnc=true, status='DNC' WHERE lower(email)=$1`, [email]);
    await q(`UPDATE clients SET dnc=true WHERE lower(email)=$1`, [email]);
  }
  res.json({ success: true, unsubscribed: email });
});
