import type { AuthUser, Role } from '../auth.ts';
import { isManager, isAdminUser } from '../auth.ts';

/** Metadata for generic CRUD objects (Salesforce-style "Object Manager"). */
export interface ObjectDef {
  table: string;
  label: string;
  fields: string[];            // writable fields
  search: string[];            // columns used by ?q=
  defaultSort: string;
  roles: Role[];               // roles allowed to access at all
  /** SQL WHERE fragment restricting rows for non-managers. $U = current user id param. */
  scope?: (u: AuthUser) => string | null;
  readOnlyFor?: Role[];
}

const ALL: Role[] = ['admin', 'manager', 'licensed_agent', 'scheduler'];
const LICENSED: Role[] = ['admin', 'manager', 'licensed_agent'];

export const OBJECTS: Record<string, ObjectDef> = {
  leads: {
    table: 'leads', label: 'Leads', roles: ALL, defaultSort: 'created_at DESC',
    fields: ['first_name', 'last_name', 'phone', 'email', 'dob', 'address', 'city', 'state', 'zip', 'county', 'source', 'campaign_id',
      'status', 'medicare_status', 'current_coverage', 'interest', 'owner_id', 'assigned_agent_id', 'tcpa_consent', 'consent_at', 'dnc',
      'phone_invalid', 'next_callback_at', 'notes', 'score', 'score_reason'],
    search: ['first_name', 'last_name', 'phone', 'email', 'zip', 'city', 'county'],
    scope: (u) => isAdminUser(u)
      ? null
      : u.role === 'scheduler'
      ? `(t.owner_id = $U OR EXISTS (SELECT 1 FROM activities a WHERE a.related_id=t.id AND (a.user_id=$U OR a.meta->>'booked_by_user_id'=$U)))`
      : `(t.owner_id = $U OR t.assigned_agent_id = $U)`,
  },
  clients: {
    table: 'clients', label: 'Clients', roles: ALL, defaultSort: 'last_name ASC', readOnlyFor: ['scheduler'],
    fields: ['first_name', 'last_name', 'phone', 'email', 'dob', 'gender', 'address', 'city', 'state', 'zip', 'county', 'household',
      'mbi_last4', 'part_a_date', 'part_b_date', 'medicaid_level', 'lis', 'status', 'owner_id', 'source', 'dnc', 'tcpa_consent',
      'last_review_date', 'notes'],
    search: ['first_name', 'last_name', 'phone', 'email', 'zip', 'city'],
    scope: (u) => u.role === 'licensed_agent' ? `t.owner_id = $U` : null,
  },
  opportunities: {
    table: 'opportunities', label: 'Opportunities', roles: LICENSED, defaultSort: 'updated_at DESC',
    fields: ['name', 'client_id', 'lead_id', 'owner_id', 'stage', 'plan_type', 'carrier', 'expected_commission', 'probability',
      'enrollment_period', 'sep_reason', 'effective_date', 'close_date', 'lost_reason'],
    search: ['name', 'carrier', 'plan_type'],
    scope: (u) => u.role === 'licensed_agent' ? `t.owner_id = $U` : null,
  },
  policies: {
    table: 'policies', label: 'Policies', roles: LICENSED, defaultSort: 'effective_date DESC',
    fields: ['client_id', 'opportunity_id', 'agent_id', 'carrier', 'plan_name', 'plan_type', 'plan_id', 'policy_number', 'status',
      'effective_date', 'term_date', 'premium', 'submitted_at'],
    search: ['carrier', 'plan_name', 'plan_id', 'policy_number'],
    scope: (u) => isAdminUser(u) ? null : `t.agent_id = $U`,
  },
  commissions: {
    table: 'commissions', label: 'Commissions', roles: ALL, defaultSort: 'period DESC',
    fields: ['policy_id', 'agent_id', 'carrier', 'type', 'period', 'expected_amount', 'paid_amount', 'status', 'paid_date'],
    search: ['carrier', 'type', 'status', 'period'],
    scope: (u) => isAdminUser(u) ? null : `t.agent_id = $U`,
  },
  activities: {
    table: 'activities', label: 'Activities', roles: ALL, defaultSort: 'created_at DESC',
    fields: ['type', 'subject', 'body', 'related_type', 'related_id', 'user_id', 'assigned_to', 'status', 'priority', 'due_at', 'end_at',
      'completed', 'direction', 'phone', 'duration_sec', 'disposition', 'meta'],
    search: ['subject', 'body'],
    scope: (u) => isManager(u) ? null : `(t.user_id = $U OR t.assigned_to = $U)`,
  },
  health_items: {
    table: 'health_items', label: 'Medications & Doctors', roles: LICENSED, defaultSort: 'created_at ASC',
    fields: ['client_id', 'kind', 'name', 'detail'], search: ['name', 'detail'],
  },
  carriers: {
    table: 'carriers', label: 'Carriers', roles: ALL, defaultSort: 'name ASC', readOnlyFor: ['scheduler', 'licensed_agent'],
    fields: ['name', 'lines', 'portal_url', 'agent_phone', 'color'], search: ['name'],
  },
  campaigns: {
    table: 'campaigns', label: 'Campaigns', roles: ALL, defaultSort: 'start_date DESC', readOnlyFor: ['scheduler', 'licensed_agent'],
    fields: ['name', 'type', 'status', 'start_date', 'end_date', 'budget', 'description'], search: ['name', 'type'],
  },
  email_templates: {
    table: 'email_templates', label: 'Email Templates', roles: ALL, defaultSort: 'name ASC', readOnlyFor: ['scheduler'],
    fields: ['name', 'category', 'subject', 'body'], search: ['name', 'subject'],
  },
  dispositions: {
    table: 'dispositions', label: 'Dispositions', roles: ALL, defaultSort: 'sort ASC', readOnlyFor: ['scheduler', 'licensed_agent'],
    fields: ['label', 'category', 'color', 'icon', 'automation', 'licensed_only', 'sort', 'active'], search: ['label'],
  },
  soas: {
    table: 'soas', label: 'Scope of Appointments', roles: ALL, defaultSort: 'created_at DESC',
    fields: ['lead_id', 'client_id', 'agent_id', 'beneficiary_name', 'products', 'method', 'status', 'appointment_at'],
    search: ['beneficiary_name', 'status'],
    scope: (u) => isManager(u) ? null : `t.agent_id = $U`,
  },
  agent_credentials: {
    table: 'agent_credentials', label: 'Licenses & Appointments', roles: ALL, defaultSort: 'kind ASC, name ASC',
    readOnlyFor: ['scheduler', 'licensed_agent'],
    fields: ['user_id', 'kind', 'name', 'number', 'plan_year', 'status', 'ready_to_sell', 'expires_on'], search: ['name', 'number'],
  },
};

/** Columns that can be used in ?filter[col]=value (must be in fields or common). */
export function filterableColumns(def: ObjectDef) {
  return new Set([...def.fields, 'id', 'user_id', 'created_at', 'updated_at']);
}
