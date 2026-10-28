-- IWG CRM schema (PostgreSQL). Date-only fields are ISO 'YYYY-MM-DD' text to avoid timezone drift.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','licensed_agent','scheduler')),
  title TEXT,
  phone TEXT,
  npn TEXT,
  states JSONB NOT NULL DEFAULT '[]',
  avatar_color TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  google_email TEXT,
  google_tokens JSONB,
  google_meet_url TEXT,
  daily_call_goal INT NOT NULL DEFAULT 80,
  caller_id_name TEXT DEFAULT 'Medicare Helpline by IWG',
  cnam TEXT DEFAULT 'MEDICARE BY IWG',
  spam_status TEXT DEFAULT 'Whitelisted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('license','appointment','certification')),
  name TEXT NOT NULL,            -- state code, carrier name, or 'AHIP'
  number TEXT,
  plan_year INT,
  status TEXT NOT NULL DEFAULT 'Active',
  ready_to_sell BOOLEAN NOT NULL DEFAULT FALSE,
  expires_on TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carriers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lines JSONB NOT NULL DEFAULT '[]',
  portal_url TEXT,
  agent_phone TEXT,
  color TEXT
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  start_date TEXT,
  end_date TEXT,
  budget DOUBLE PRECISION DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  dob TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'AZ',
  zip TEXT,
  county TEXT,
  source TEXT,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'New',
  medicare_status TEXT,
  current_coverage TEXT,
  interest TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,          -- scheduler or agent working the lead
  assigned_agent_id TEXT REFERENCES users(id) ON DELETE SET NULL, -- licensed agent for appointments
  score INT DEFAULT 0,
  score_reason TEXT,
  tcpa_consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at TIMESTAMPTZ,
  dnc BOOLEAN NOT NULL DEFAULT FALSE,
  phone_invalid BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INT NOT NULL DEFAULT 0,
  last_disposition TEXT,
  last_contacted_at TIMESTAMPTZ,
  next_callback_at TIMESTAMPTZ,
  converted_client_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  dob TEXT,
  gender TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'AZ',
  zip TEXT,
  county TEXT,
  household TEXT,
  mbi_last4 TEXT,
  part_a_date TEXT,
  part_b_date TEXT,
  medicaid_level TEXT,
  lis BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'Active',
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  lead_id TEXT,
  source TEXT,
  dnc BOOLEAN NOT NULL DEFAULT FALSE,
  tcpa_consent BOOLEAN NOT NULL DEFAULT FALSE,
  last_review_date TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_items (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('medication','doctor','pharmacy')),
  name TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  lead_id TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'New Lead',
  plan_type TEXT,
  carrier TEXT,
  expected_commission DOUBLE PRECISION DEFAULT 0,
  probability INT DEFAULT 10,
  enrollment_period TEXT,
  sep_reason TEXT,
  effective_date TEXT,
  close_date TEXT,
  lost_reason TEXT,
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  opportunity_id TEXT,
  agent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  carrier TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  plan_id TEXT,
  policy_number TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  effective_date TEXT,
  term_date TEXT,
  premium DOUBLE PRECISION DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commissions (
  id TEXT PRIMARY KEY,
  policy_id TEXT REFERENCES policies(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  carrier TEXT,
  type TEXT NOT NULL DEFAULT 'Initial',
  period TEXT,
  expected_amount DOUBLE PRECISION DEFAULT 0,
  paid_amount DOUBLE PRECISION DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Expected',
  paid_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soas (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  lead_id TEXT,
  client_id TEXT,
  agent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  beneficiary_name TEXT,
  products JSONB NOT NULL DEFAULT '[]',
  method TEXT NOT NULL DEFAULT 'E-sign',
  status TEXT NOT NULL DEFAULT 'Sent',
  appointment_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ DEFAULT now(),
  signed_at TIMESTAMPTZ,
  signer_name TEXT,
  signer_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispositions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  automation JSONB NOT NULL DEFAULT '{}',
  licensed_only BOOLEAN NOT NULL DEFAULT FALSE,
  sort INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Unified timeline: calls, emails, tasks, events (appointments), notes, chats, system events
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  related_type TEXT,
  related_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT,
  priority TEXT,
  due_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  direction TEXT,
  phone TEXT,
  duration_sec INT,
  disposition_id TEXT,
  disposition TEXT,
  provider TEXT,
  ai_summary TEXT,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  visitor_token TEXT NOT NULL,
  visitor_name TEXT,
  visitor_email TEXT,
  visitor_phone TEXT,
  visitor_zip TEXT,
  channel TEXT NOT NULL DEFAULT 'web',
  status TEXT NOT NULL DEFAULT 'ai',
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  lead_id TEXT,
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  intake JSONB NOT NULL DEFAULT '{}',
  summary TEXT,
  unread INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('visitor','ai','agent','system')),
  user_id TEXT,
  body TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_posts (
  id TEXT PRIMARY KEY,
  related_type TEXT,
  related_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  mentions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS caller_id_registry (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_name TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Medicare Helpline by IWG',
  cnam TEXT NOT NULL DEFAULT 'MEDICARE BY IWG',
  carrier TEXT NOT NULL DEFAULT 'Google Voice / Bandwidth.com',
  free_caller_registry_status TEXT NOT NULL DEFAULT 'Whitelisted',
  hiya_status TEXT NOT NULL DEFAULT 'Clean (0% Spam Risk)',
  first_orion_status TEXT NOT NULL DEFAULT 'Verified Business',
  tns_status TEXT NOT NULL DEFAULT 'Approved Caller',
  stir_shaken_status TEXT NOT NULL DEFAULT 'A-Attestation (Verified)',
  call_reason TEXT NOT NULL DEFAULT 'Medicare Consultations & Annual Plan Reviews',
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telephony_config (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'twilio',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  account_sid TEXT,
  auth_token TEXT,
  caller_id TEXT DEFAULT '+16024569681',
  caller_name TEXT DEFAULT 'Medicare Helpline by IWG',
  cnam TEXT DEFAULT 'MEDICARE BY IWG',
  stir_shaken_level TEXT DEFAULT 'A',
  branded_calling_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  twiml_app_sid TEXT,
  connection_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bland_config (
  id TEXT PRIMARY KEY DEFAULT 'main',
  api_key TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  pathway_id TEXT DEFAULT '3b13b658-e85d-4d14-a24a-868b61040c42',
  github_repo TEXT,
  default_voice TEXT DEFAULT 'maya',
  model TEXT DEFAULT 'enhanced',
  language TEXT DEFAULT 'en-US',
  from_number TEXT DEFAULT '+16024569681',
  transfer_phone_number TEXT DEFAULT '+16024569681',
  prompt_template TEXT,
  webhook_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(owner_id);
CREATE INDEX IF NOT EXISTS idx_opps_owner ON opportunities(owner_id);
CREATE INDEX IF NOT EXISTS idx_policies_client ON policies(client_id);
CREATE INDEX IF NOT EXISTS idx_acts_related ON activities(related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_acts_user ON activities(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_acts_type ON activities(type, created_at);
CREATE INDEX IF NOT EXISTS idx_msgs_conv ON messages(conversation_id, created_at);
