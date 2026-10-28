import { q, one, insert } from '../../db/index.ts';
import type { AuthUser } from '../../auth.ts';
import { isManager, isAdminUser } from '../../auth.ts';
import { currentPeriod, nextPeriod } from '../enrollment.ts';

/** CRM tools exposed to the agent Copilot (Gemini function-calling) — always scoped to the user's visibility. */

function leadScope(u: AuthUser, params: any[]) {
  if (isAdminUser(u)) return 'true';
  if (u.role === 'scheduler') { params.push(u.id); return `(owner_id = $${params.length})`; }
  if (u.role === 'licensed_agent') { params.push(u.id); return `(owner_id = $${params.length} OR assigned_agent_id = $${params.length})`; }
  return 'true';
}
function ownerScope(u: AuthUser, col: string, params: any[]) {
  if (isManager(u)) return 'true';
  params.push(u.id);
  return `${col} = $${params.length}`;
}

export const toolDeclarations = [
  {
    name: 'search_leads',
    description: 'Search leads. Use for questions about prospects, turning 65, scores, statuses, counties.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, phone, city or zip text search' },
        status: { type: 'string', description: 'Lead status e.g. New, Contacted, SOA Sent, SOA Signed, Appointment Set, Nurture' },
        county: { type: 'string' },
        min_score: { type: 'number' },
        turning_65_within_days: { type: 'number', description: 'Only leads whose 65th birthday is within N days from today' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'search_clients',
    description: 'Search existing clients (policyholders) by name, county, carrier or plan type.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' }, county: { type: 'string' }, carrier: { type: 'string' }, plan_type: { type: 'string' }, limit: { type: 'number' },
      },
    },
  },
  { name: 'get_pipeline_summary', description: 'Opportunity counts and expected commission by stage.', parameters: { type: 'object', properties: {} } },
  {
    name: 'get_tasks',
    description: 'List the user\'s open tasks and appointments.',
    parameters: { type: 'object', properties: { range: { type: 'string', enum: ['today', 'overdue', 'week'] } } },
  },
  { name: 'get_call_stats', description: 'Calling metrics (calls, connects, appointments) for last N days.', parameters: { type: 'object', properties: { days: { type: 'number' } } } },
  { name: 'who_to_call_today', description: 'Prioritized call list ranked by score, enrollment window and due callbacks.', parameters: { type: 'object', properties: { limit: { type: 'number' } } } },
  {
    name: 'get_policy_summary',
    description: 'Policy counts and premium by carrier/plan type/status.',
    parameters: { type: 'object', properties: { status: { type: 'string' } } },
  },
  { name: 'get_commission_summary', description: 'Commission expected vs paid by period and carrier.', parameters: { type: 'object', properties: {} } },
  { name: 'get_enrollment_calendar', description: 'Current/next Medicare enrollment period and counts of T65 leads.', parameters: { type: 'object', properties: {} } },
  {
    name: 'create_task',
    description: 'Create a follow-up task for the user, optionally linked to a lead/client by name.',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string' }, contact_name: { type: 'string' }, due_at: { type: 'string', description: 'ISO date-time' },
      },
      required: ['subject'],
    },
  },
];

const COLS_LEAD = `id, first_name || ' ' || last_name AS name, phone, county, status, score, dob, last_disposition, next_callback_at`;

export async function runTool(name: string, args: any, u: AuthUser): Promise<any> {
  const params: any[] = [];
  const lim = Math.min(Number(args?.limit) || 10, 50);
  switch (name) {
    case 'search_leads': {
      const w = [leadScope(u, params), `status NOT IN ('Converted')`];
      if (args.query) { params.push(`%${args.query}%`); w.push(`(first_name || ' ' || last_name || ' ' || COALESCE(phone,'') || ' ' || COALESCE(city,'') || ' ' || COALESCE(zip,'')) ILIKE $${params.length}`); }
      if (args.status) { params.push(args.status); w.push(`status ILIKE $${params.length}`); }
      if (args.county) { params.push(args.county); w.push(`county ILIKE $${params.length}`); }
      if (args.min_score) { params.push(Number(args.min_score)); w.push(`score >= $${params.length}`); }
      if (args.turning_65_within_days) {
        params.push(Number(args.turning_65_within_days));
        w.push(`dob IS NOT NULL AND (dob::date + interval '65 years') BETWEEN current_date AND current_date + ($${params.length} || ' days')::interval`);
        params[params.length - 1] = String(params[params.length - 1]);
      }
      const rows = await q(`SELECT ${COLS_LEAD} FROM leads WHERE ${w.join(' AND ')} ORDER BY score DESC LIMIT ${lim}`, params);
      const total = await one(`SELECT count(*)::int AS n FROM leads WHERE ${w.join(' AND ')}`, params);
      return { total: total?.n ?? rows.length, rows, link_base: '/leads/' };
    }
    case 'search_clients': {
      if (u.role === 'scheduler') return { error: 'Schedulers cannot search client policy data' };
      const w = [ownerScope(u, 'c.owner_id', params)];
      if (args.query) { params.push(`%${args.query}%`); w.push(`(c.first_name || ' ' || c.last_name || ' ' || COALESCE(c.city,'')) ILIKE $${params.length}`); }
      if (args.county) { params.push(args.county); w.push(`c.county ILIKE $${params.length}`); }
      if (args.carrier) { params.push(`%${args.carrier}%`); w.push(`EXISTS (SELECT 1 FROM policies p WHERE p.client_id=c.id AND p.carrier ILIKE $${params.length})`); }
      if (args.plan_type) { params.push(args.plan_type); w.push(`EXISTS (SELECT 1 FROM policies p WHERE p.client_id=c.id AND p.plan_type ILIKE $${params.length})`); }
      const rows = await q(
        `SELECT c.id, c.first_name || ' ' || c.last_name AS name, c.phone, c.county,
           (SELECT string_agg(p.carrier || ' ' || p.plan_type, ', ') FROM policies p WHERE p.client_id=c.id AND p.status='Active') AS policies
         FROM clients c WHERE ${w.join(' AND ')} ORDER BY c.last_name LIMIT ${lim}`, params);
      const total = await one(`SELECT count(*)::int AS n FROM clients c WHERE ${w.join(' AND ')}`, params);
      return { total: total?.n ?? rows.length, rows, link_base: '/clients/' };
    }
    case 'get_pipeline_summary': {
      if (u.role === 'scheduler') return { error: 'Not available for schedulers' };
      return { stages: await q(
        `SELECT stage, count(*)::int AS deals, COALESCE(sum(expected_commission),0)::float AS expected_commission
         FROM opportunities WHERE ${ownerScope(u, 'owner_id', params)} GROUP BY stage ORDER BY deals DESC`, params) };
    }
    case 'get_tasks': {
      params.push(u.id);
      const range = args.range || 'today';
      const cond = range === 'overdue' ? `due_at < now()` : range === 'week' ? `due_at < now() + interval '7 days'` : `due_at < date_trunc('day', now()) + interval '1 day'`;
      const rows = await q(
        `SELECT id, type, subject, due_at, related_type, related_id, priority FROM activities
         WHERE (assigned_to = $1 OR user_id = $1) AND type IN ('task','event') AND completed = false AND ${cond}
         ORDER BY due_at ASC LIMIT 25`, params);
      return { range, total: rows.length, rows };
    }
    case 'get_call_stats': {
      const days = String(Number(args.days) || 7);
      params.push(days);
      const scope = isAdminUser(u) ? '' : (params.push(u.id), `AND a.user_id = $2`);
      return one(
        `SELECT count(*)::int AS calls,
                count(*) FILTER (WHERE d.category <> 'not_connected')::int AS connects,
                count(*) FILTER (WHERE d.id IN ('appointment_set', 'warm_transfer_success'))::int AS appointments,
                count(*) FILTER (WHERE d.id='app_submitted')::int AS applications
         FROM activities a JOIN dispositions d ON d.id=a.disposition_id
         WHERE a.type='call' AND a.completed AND a.created_at >= now() - ($1 || ' days')::interval ${scope}`, params);
    }
    case 'who_to_call_today': {
      const w = [leadScope(u, params), `dnc = false`, `phone_invalid = false`, `status NOT IN ('Converted','DNC','Unqualified')`];
      const rows = await q(
        `SELECT ${COLS_LEAD}, score_reason FROM leads WHERE ${w.join(' AND ')}
         ORDER BY (next_callback_at IS NOT NULL AND next_callback_at <= now() + interval '1 day') DESC, score DESC, attempts ASC LIMIT ${lim}`, params);
      return { rows, link_base: '/leads/' };
    }
    case 'get_policy_summary': {
      if (u.role === 'scheduler') return { error: 'Not available for schedulers' };
      const w = [ownerScope(u, 'agent_id', params)];
      if (args.status) { params.push(args.status); w.push(`status = $${params.length}`); }
      return {
        byCarrier: await q(`SELECT carrier, count(*)::int AS policies, COALESCE(sum(premium),0)::float AS monthly_premium FROM policies WHERE ${w.join(' AND ')} GROUP BY carrier ORDER BY policies DESC`, params),
        byType: await q(`SELECT plan_type, count(*)::int AS policies FROM policies WHERE ${w.join(' AND ')} GROUP BY plan_type ORDER BY policies DESC`, params),
        byStatus: await q(`SELECT status, count(*)::int AS policies FROM policies WHERE ${w.join(' AND ')} GROUP BY status`, params),
      };
    }
    case 'get_commission_summary': {
      if (u.role === 'scheduler') return { error: 'Not available for schedulers' };
      return { periods: await q(
        `SELECT period, COALESCE(sum(expected_amount),0)::float AS expected, COALESCE(sum(paid_amount),0)::float AS paid,
                count(*) FILTER (WHERE status='Chargeback')::int AS chargebacks
         FROM commissions WHERE ${ownerScope(u, 'agent_id', params)} GROUP BY period ORDER BY period DESC LIMIT 6`, params) };
    }
    case 'get_enrollment_calendar': {
      const w = leadScope(u, params);
      const t65 = await one(
        `SELECT count(*) FILTER (WHERE (dob::date + interval '65 years') BETWEEN current_date AND current_date + interval '90 days')::int AS next_90,
                count(*) FILTER (WHERE (dob::date + interval '65 years') BETWEEN current_date AND current_date + interval '30 days')::int AS next_30
         FROM leads WHERE dob IS NOT NULL AND ${w}`, params);
      return { current: currentPeriod(), next: nextPeriod(), turning65: t65 };
    }
    case 'create_task': {
      let related: any = null;
      if (args.contact_name) {
        const p2: any[] = [`%${args.contact_name}%`];
        related = await one(`SELECT id, 'lead' AS type FROM leads WHERE (first_name || ' ' || last_name) ILIKE $1 LIMIT 1`, p2)
          || await one(`SELECT id, 'client' AS type FROM clients WHERE (first_name || ' ' || last_name) ILIKE $1 LIMIT 1`, p2);
      }
      const due = args.due_at ? new Date(args.due_at) : new Date(Date.now() + 86400000);
      const task = await insert('activities', {
        type: 'task', subject: args.subject, user_id: u.id, assigned_to: u.id, due_at: isNaN(due.getTime()) ? new Date(Date.now() + 86400000) : due,
        status: 'Open', priority: 'Normal', related_type: related?.type || null, related_id: related?.id || null, meta: { source: 'copilot' },
      });
      return { created: true, task: { id: task.id, subject: task.subject, due_at: task.due_at, linked_to: related?.type || null } };
    }
  }
  return { error: `Unknown tool ${name}` };
}
