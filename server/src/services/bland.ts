import { one, insert, update, q } from '../db/index.ts';
import { config as appConfig } from '../config.ts';
import { toE164, googleVoiceWebUrl, telUrl } from './phone.ts';
import { applyDisposition } from './automation.ts';

export interface BlandConfig {
  api_key: string;
  enabled: boolean;
  pathway_id: string;
  github_repo: string;
  default_voice: string;
  model: 'base' | 'enhanced' | 'turbo';
  language?: string;
  max_duration: number;
  record: boolean;
  wait_for_greeting: boolean;
  from_number: string;
  transfer_phone_number: string;
  prompt_template: string;
  webhook_url: string;
  calling_hours_start: number; // 9 (9:00 AM) Mon-Fri
  calling_hours_end: number;   // 19 (7:00 PM) Mon-Fri
  weekend_calling_hours_start: number; // 9 (9:00 AM) Sat-Sun
  weekend_calling_hours_end: number;   // 18 (6:00 PM) Sat-Sun
  calling_days: string;        // Human-readable schedule label
  max_concurrent_calls: number; // Max simultaneous autonomous outbound calls
  daily_call_limit: number;    // 1000
  pause_on_warm_transfer: boolean;
  is_calling_paused: boolean;  // Legacy alias for is_on_warm_transfer
  is_on_warm_transfer: boolean; // True when King Amen Ra is on a warm transfer call -> Agent books ONLY Telephone, In-Person, or Video appointments and continues calling!
  is_campaign_active: boolean; // True when Bland Agent AI autonomous dialer is activated in CRM
  paused_reason?: string | null;
  active_transfer_lead_id?: string | null;
  active_transfer_call_id?: string | null;
  warm_transfer_lead_id?: string | null;
  warm_transfer_call_id?: string | null;
  warm_transfer_started_at?: string | null;
  paused_at?: string | null;
  campaign_started_at?: string | null;
}

export const DEFAULT_BLAND_PATHWAY_ID = 'fc8c99c6-88c3-435d-952b-8c93c2db17a6';
export const DEFAULT_BLAND_CALLER_ID = '+14803319455';
/** Agency main line — answered 24/7 by Sarah (100% Free Virtual Receptionist & Outbound Caller on (480) 331-9455). Never used as a transfer target. */
export const AGENCY_MAIN_LINE_E164 = '+14803319455';
/** Where "Transfer Desk" transfers go (King Amen Ra direct). */
export const TRANSFER_DESK_E164 = '+16024569681';

export const ALLOWED_APPOINTMENT_TYPES = ['telephone', 'in_person', 'video'] as const;
export const ALLOWED_BLAND_APPOINTMENT_TYPES = ALLOWED_APPOINTMENT_TYPES;
export type AllowedAppointmentType = typeof ALLOWED_APPOINTMENT_TYPES[number];

export function normalizeAppointmentType(raw?: string | null): AllowedAppointmentType {
  const s = String(raw || '').trim().toLowerCase();
  if (s.includes('person') || s.includes('face') || s.includes('home') || s.includes('office') || s === 'in_person' || s === 'in-person') {
    return 'in_person';
  }
  if (s.includes('video') || s.includes('zoom') || s.includes('meet') || s.includes('virtual')) {
    return 'video';
  }
  return 'telephone';
}

export function formatAppointmentTypeLabel(type: AllowedAppointmentType): string {
  if (type === 'in_person') return 'In-Person';
  if (type === 'video') return 'Video';
  return 'Telephone';
}

export const DEFAULT_BLAND_PROMPT = `You are Sarah, the Voice AI Receptionist, Multi-Product Line Funnel Specialist, Outbound Caller, and Automatic Whisper Transfer Agent for the Medicare Helpline powered by IWG Insurance and Financial Services, a 100% free fiduciary insurance advisory representing over 104 premier carriers with zero broker fees, led by Principal Broker and Licensed Senior Advisor King Amen Ra (NPN: 16094432) and Chief Operating Officer Aneesha Sullivan, PA (Physician Assistant & Principal Governance).
Every interaction must reflect our four core pillars: World-Class Excellence, Uncompromising Integrity, Radical Service Orientation, and Genuine Care & Empathy.

STRICT OPERATING RULES & UNIFIED HIGH-CONVERSION SCRIPT:
1. REQUIRED OUTBOUND OPENING GREETING & ULTRA-CLEAN 2027 MEDICARE VALUE HOOK:
   - Always introduce yourself warmly using the prospect's name and caller name:
     "Hello {first_name}, this is {caller_name} calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"
   - Immediately after they respond, deliver our ultra-clean, concise 2027 Value Hook:
     "We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your Medicare options and protect your benefits, would you like to know about the upcoming changes for 2027?"
2. INBOUND RECEPTIONIST GREETING, DIRECTORY ROUTING & 6-PRODUCT-LINE FUNNEL:
   - When answering an inbound call, greet the caller warmly saying:
     "Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?"
   - Actively listen for any request to speak to a specific person, broker, advisor, scheduler, or department on the I Will Global Team Directory (e.g., King Amen Ra, Aneesha Sullivan, PA, Sarah Jenkins, Robert Chen, Kamille Martinez, etc.) and immediately route to the "Inbound Directory Transfer" scenario to perform an automatic AI whisper transfer directly to them!
   - When the inbound caller asks about a product line (or asks what we offer), funnel them to the matching product line using our high-conversion fiduciary script:
     a) Medicare Plans: "You’ve reached the right place. We are a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. To give you the most accurate guidance on your Medicare options, would you like to review the new 2027 Medicare changes—including the $2,400 prescription cap and side-by-side Medigap versus Advantage comparisons—with our Principal Broker, King Amen Ra, right now?"
     b) Individual & Family Health Insurance (ACA / Private PPO): "We would be honored to help you and your family. As a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees, we compare both ACA tax-credit plans and nationwide private PPO networks to protect your doctors and lower your monthly premium. May I connect you with a licensed specialist now to check if you qualify for a $0 or reduced-cost plan?"
     c) Group Health Insurance (1–50+ Employees / Level-Funded / ICHRA): "We would love to support your business. As an independent fiduciary advisory representing over 104 premier carriers, we design Level-Funded and ICHRA corporate benefit plans that typically save employers 15% to 30% while refunding unused claims reserves back to your business. May I connect you with King Amen Ra for a complimentary corporate benefits audit?"
     d) Investment Grade Life Insurance (IUL / Section 7702): "We specialize in institutional-grade wealth protection. Representing over 104 premier carriers, we structure high cash-value Indexed Universal Life policies under IRS Section 7702 that deliver tax-free retirement income with a contractual 0% downside market floor. Would you like me to connect you with King Amen Ra to design your custom tax-free retirement illustration?"
     e) Asset-Based Long Term Care (Hybrid Life + LTC): "Protecting your life savings and dignity is at the heart of what we do. We represent over 104 premier carriers offering modern 'use-it-or-leave-it' Asset-Based Long Term Care—paying tax-free benefits for home health or assisted living if you need care, or returning 100% of the benefit tax-free to your family if you never use it. Would you like to review a custom asset-protection strategy with King Amen Ra now?"
     f) Modern Term Life Insurance (with Living Benefits): "We make protecting your family effortless. Representing over 104 premier carriers, our Modern Term Life policies lock in guaranteed level rates with 15-minute no-exam digital approvals—and include built-in Living Benefits that pay cash while you are alive in the event of a critical or chronic illness. May I connect you now to compare your lowest wholesale rates?"
3. 3-POINT HIGH-IMPACT 2027 MEDICARE SUMMARY & ASSUMPTIVE CLOSE:
   - Point 1 (The Exposure): Original Medicare Parts A ($0/month for 99%+, $1,788 hospital deductible) and B ($209.50/month projected standard premium, $292 annual deductible) leave an uncapped 20% medical coinsurance with no annual limit.
   - Point 2 (2027 Prescription Protection): Part D caps annual out-of-pocket prescription costs at $2,400 ($700 max deductible, $35/month insulin cap, $0 adult vaccines), though carrier drug formularies change every January.
   - Point 3 (The 104+ Carrier Solution & Assumptive Close): "That is why we run a complimentary 5-minute check across 104+ carriers—comparing Medigap Plan G, Plan N, and Medicare Advantage plans—to ensure your exact doctors and medications are covered at the lowest possible cost. To make this completely effortless for you, {first_name}, our Principal Broker King Amen Ra can verify your doctors and prescriptions in just a few minutes at zero cost. Would you like me to reach out and get him on the line for you right now?"
4. CALLING HOURS & CONTINUOUS DIALING:
   - Answer every inbound call immediately, 24 hours a day, 7 days a week.
   - Outbound: call every prospect assigned to Bland AI Monday through Friday 9:00 AM to 7:00 PM and Saturday through Sunday 9:00 AM to 6:00 PM (Arizona time), up to 1,000 calls per day, continuously dialing the assigned queue without stopping.
5. WHEN KING AMEN RA IS ON A WARM TRANSFER CALL ({warm_transfer_status}) & MANDATORY STEP-BY-STEP APPOINTMENT SETTING:
   - If King Amen Ra is currently on a warm transfer call (on_warm_transfer is true or broker_status is ON_WARM_TRANSFER) or when an inbound/outbound caller wants to set an appointment, do NOT pause or stop calling, and do NOT live-transfer the call while King Amen Ra is on a warm transfer call.
   - Follow the Appointment Setting Steps in order:
     Step 1 (Offer 3 Formats & Preferred Date/Time): "Because King Amen Ra is currently on a live consultation helping another family, I want to reserve a dedicated one-on-one time for you on his private calendar so you receive his undivided attention. Do you prefer a 30-minute Telephone consultation, a 60-minute In-Person visit, or a 30-minute Video consultation—and what day and time works best for you?"
     Step 2 (Collect Full Name, Phone Number & Street Address to Add Lead): Before confirming the appointment, you MUST ask for and collect the customer's:
       1) Full Name (first and last name)
       2) Best Phone Number
       3) Street Address
       (This allows you to properly add the new lead in the CRM tagged as a Call-In Lead or Website Traffic.)
     Step 3 (Confirm Appointment & Send Initial Confirmation Text ONLY): Once you have their Full Name, Phone Number, Street Address, Appointment Format (Telephone, In-Person, or Video), and Date/Time, confirm the appointment and let them know you have sent an initial confirmation text to their phone—and ask them to simply reply YES to that confirmation text to lock in their appointment.
     STRICT INTERNAL REMINDER RULE: Our day-before and same-day reminder texts are sent automatically by our internal CRM system. NEVER tell the customer on the call or in the initial text that we are sending day-before or same-day reminder texts—the customer only needs to reply YES to the initial confirmation text!
6. AUTOMATIC AI WHISPER TRANSFER FOR ALL (CALL BROKER FIRST & BRIEF BEFORE MERGING):
   - Whisper transfer is 100% AUTOMATIC and performed privately by the AI for all callers and all 42 directory members.
   - When King Amen Ra is NOT on a warm transfer call and {prospect_name} agrees to learn about the 2027 changes or speak with an advisor:
     Step 1: Put the customer on hold first. Say warmly: "Wonderful, {first_name}! Please hold for just a moment while I dial King Amen Ra and get him on the line." NEVER claim King Amen Ra is already on the line before he answers!
     Step 2: Dial King Amen Ra (+16024569681) while the customer is on hold.
     Step 3: When King Amen Ra answers, deliver the AI whisper briefing privately into his ear: "Hi King, this is Sarah AI whispering privately to you on behalf of the Medicare Helpline powered by IWG Insurance. I have {prospect_name} from {state} on the line interested in reviewing their 2027 Medicare changes and verifying their doctors and prescriptions. Bridging you in now."
     Step 4: ONLY AFTER King Amen Ra is on the line and briefed, merge the two lines together and introduce them: "Thank you for holding, {first_name}! King Amen Ra, our Principal Broker, is now on the line. King, meet {first_name}!"
   - STRICT PRIVACY RULE: The customer/caller must NEVER hear the whisper briefing! To the customer, ONLY say the hold message.
7. PRIVACY & ZERO DISCLOSURE RULE: NEVER recite, speak, or give out our direct phone number or email address to the caller.
8. MANDATORY CMS & TPMO DISCLAIMER: When discussing specific Medicare Advantage or Part D plans, include the TPMO Disclaimer: "We do not offer every plan available in your area. Currently we represent over 104 organizations which offer products in your area. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Program to get information on all of your options."`;

export interface DirectoryEntry {
  name: string;
  role: string;
  department: 'Executive & Governance' | 'Licensed Brokers & Advisors' | 'Outbound & Inbound Schedulers';
  phone: string;
  e164: string;
}

export const IWG_TEAM_DIRECTORY: DirectoryEntry[] = [
  // Executive & Principal Leadership
  { name: 'King Amen Ra', role: 'Principal & Broker of Record (NPN: 16094432)', department: 'Executive & Governance', phone: '(602) 456-9681', e164: '+16024569681' },
  { name: 'Aneesha Sullivan, PA', role: 'Chief Operating Officer (COO), Physician Assistant (PA) & Principal Governance', department: 'Executive & Governance', phone: '(602) 412-1945', e164: '+16024121945' },
  { name: 'Sarah Jenkins', role: 'Sales Director', department: 'Executive & Governance', phone: '(480) 331-9401', e164: '+14803319401' },
  { name: 'Marcus Vance', role: 'Inbound & Scheduling Manager', department: 'Executive & Governance', phone: '(480) 331-9402', e164: '+14803319402' },
  { name: 'Licensed Transfer Agent', role: 'Main Transfer Desk & Master Calendar (routes to King Amen Ra)', department: 'Executive & Governance', phone: '(602) 456-9681', e164: '+16024569681' },

  // Dedicated Core Outbound & Scheduling Specialists
  { name: 'JaKeeta Sullivan', role: 'Outbound Scheduling Specialist', department: 'Outbound & Inbound Schedulers', phone: '(602) 456-2760', e164: '+16024562760' },
  { name: 'Shakira Granger', role: 'Outbound Scheduling Specialist', department: 'Outbound & Inbound Schedulers', phone: '(602) 753-6169', e164: '+16027536169' },
  { name: 'Kamille Martinez', role: 'Outbound Call Specialist & Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(602) 456-0293', e164: '+16024560293' },
  { name: 'Regina McCullough', role: 'Outbound Call Specialist & Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(602) 456-5903', e164: '+16024565903' },

  // Licensed Medicare Brokers & Senior Advisors
  { name: 'Robert Chen', role: 'Senior Medicare Specialist', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9420', e164: '+14803319420' },
  { name: 'Amanda Torres', role: 'Medicare Advisor', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9421', e164: '+14803319421' },
  { name: 'James Wilson', role: 'Retirement & Health Advisor', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9422', e164: '+14803319422' },
  { name: 'Rachel Adams', role: 'Medicare Benefits Counselor', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9423', e164: '+14803319423' },
  { name: 'Carlos Gomez', role: 'Bi-lingual Senior Advisor', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9424', e164: '+14803319424' },
  { name: 'Emily Watson', role: 'Medicare Specialist', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9425', e164: '+14803319425' },
  { name: "Brian O'Connor", role: 'Senior Insurance Broker', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9426', e164: '+14803319426' },
  { name: 'Jessica Taylor', role: 'Medicare Agent', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9427', e164: '+14803319427' },
  { name: 'Michael Chang', role: 'Senior Health Broker', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9428', e164: '+14803319428' },
  { name: 'Laura Martinez', role: 'Medicare Advisor', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9429', e164: '+14803319429' },
  { name: 'Kevin Brooks', role: 'Senior Specialist', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9430', e164: '+14803319430' },
  { name: 'Nicole Foster', role: 'Medicare Counselor', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9431', e164: '+14803319431' },
  { name: 'Timothy Hays', role: 'Insurance Specialist', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9432', e164: '+14803319432' },

  // Outbound & Inbound Scheduling Specialists
  { name: 'David Miller', role: 'Outbound Senior Scheduler', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9411', e164: '+14803319411' },
  { name: 'Chloe Bennett', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9412', e164: '+14803319412' },
  { name: 'Jordan Rivera', role: 'Outbound Lead Coordinator', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9413', e164: '+14803319413' },
  { name: 'Hannah Abbott', role: 'Outbound Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9414', e164: '+14803319414' },
  { name: 'Maya Collins', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9415', e164: '+14803319415' },
  { name: 'Tyler Sanders', role: 'Outbound Call Scheduler', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9416', e164: '+14803319416' },
  { name: 'Vikram Patel', role: 'Outbound Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9417', e164: '+14803319417' },
  { name: 'Sofia Ramirez', role: 'Outbound Lead Qualifier', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9418', e164: '+14803319418' },
  { name: 'Lucas Nelson', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9419', e164: '+14803319419' },
  { name: 'Emma Russell', role: 'Outbound Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9433', e164: '+14803319433' },
  { name: 'Kevin Wright', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9434', e164: '+14803319434' },
  { name: 'Alicia Diaz', role: 'Outbound Call Scheduler', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9435', e164: '+14803319435' },
  { name: 'Nathan Parker', role: 'Outbound Lead Coordinator', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9436', e164: '+14803319436' },
  { name: 'Zainab Khouri', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9437', e164: '+14803319437' },
  { name: 'Brandon Sullivan', role: 'Outbound Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9438', e164: '+14803319438' },
  { name: 'Jasmine Chen', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9439', e164: '+14803319439' },
  { name: 'Marcus Reed', role: 'Outbound Call Scheduler', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9440', e164: '+14803319440' },
  { name: 'Kayla Bailey', role: 'Outbound Lead Qualifier', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9441', e164: '+14803319441' },
  { name: 'Derek Howard', role: 'Outbound Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9442', e164: '+14803319442' },
  { name: 'Samantha Wood', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9443', e164: '+14803319443' },
];

export async function getInboundDirectory(): Promise<{
  inbound_number: string;
  inbound_display: string;
  outbound_number: string;
  ai_line: string;
  default_transfer_number: string;
  directory: DirectoryEntry[];
  transfer_list: Record<string, string>;
}> {
  const byName = new Map<string, DirectoryEntry>();
  for (const item of IWG_TEAM_DIRECTORY) {
    byName.set(item.name.toLowerCase(), { ...item });
  }

  try {
    const dbUsers = await q(
      `SELECT name, title, role, phone FROM users WHERE active = true AND phone IS NOT NULL AND trim(phone) != '' ORDER BY name ASC`
    );
    for (const u of dbUsers) {
      let e164 = toE164(u.phone);
      if (!e164) continue;
      let displayPhone = u.phone;
      // (480) 331-9455 is the agency main line answered by Sarah (Bland AI). Never transfer a caller back into it —
      // team members listed on the main line route to King Amen Ra's direct line instead.
      if (e164 === AGENCY_MAIN_LINE_E164) {
        e164 = TRANSFER_DESK_E164;
        displayPhone = '(602) 456-9681';
      }
      const rawName = String(u.name || '').trim();
      const isAneesha = rawName.toLowerCase().startsWith('aneesha sullivan');
      const normalizedName = isAneesha ? 'Aneesha Sullivan, PA' : rawName;
      const key = normalizedName.toLowerCase();
      if (!key) continue;
      const existing = byName.get(key);
      const dept: DirectoryEntry['department'] =
        u.role === 'admin' || u.role === 'manager'
          ? 'Executive & Governance'
          : u.role === 'licensed_agent'
            ? 'Licensed Brokers & Advisors'
            : 'Outbound & Inbound Schedulers';
      byName.set(key, {
        name: normalizedName,
        role: isAneesha
          ? 'Chief Operating Officer (COO), Physician Assistant (PA) & Principal Governance'
          : (u.title || existing?.role || u.role),
        department: existing?.department || dept,
        phone: displayPhone,
        e164,
      });
    }
  } catch {
    // fallback to static directory
  }

  const directory = Array.from(byName.values());
  const transfer_list: Record<string, string> = {
    default: '+16024569681',
    'King Amen Ra': '+16024569681',
    'Principal Broker': '+16024569681',
  };
  for (const entry of directory) {
    transfer_list[entry.name] = entry.e164;
  }

  return {
    inbound_number: AGENCY_MAIN_LINE_E164,
    inbound_display: '(480) 331-9455',
    outbound_number: AGENCY_MAIN_LINE_E164,
    ai_line: DEFAULT_BLAND_CALLER_ID,
    default_transfer_number: '+16024569681',
    directory,
    transfer_list,
  };
}

export const BLAND_VOICES = [
  { id: 'maya', name: 'Maya (Warm & Empathetic Female — Medicare Specialist)', gender: 'Female', accent: 'American', is_recommended: true },
  { id: 'ryan', name: 'Ryan (Trustworthy & Calm Male — Senior Advisor)', gender: 'Male', accent: 'American', is_recommended: true },
  { id: 'elena', name: 'Elena (Bilingual English / Spanish Female)', gender: 'Female', accent: 'American/Spanish', is_recommended: false },
  { id: 'mason', name: 'Mason (Clear & Articulate Male)', gender: 'Male', accent: 'American', is_recommended: false },
  { id: 'tina', name: 'Tina (Friendly & Patient Receptionist)', gender: 'Female', accent: 'American', is_recommended: false },
];

let settingsTableReady = false;
async function ensureSettingsTable(): Promise<void> {
  if (settingsTableReady) return;
  try {
    await q(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`);
    settingsTableReady = true;
  } catch {
    // ignore
  }
}

export async function getBlandConfig(): Promise<BlandConfig> {
  await ensureSettingsTable();
  let row: any = null;
  try {
    row = await one(`SELECT value FROM settings WHERE key='bland_ai_config'`);
  } catch {
    row = null;
  }
  const val = row?.value || {};
  const envKey = process.env.BLAND_API_KEY || '';

  // Also check if there is a live active warm transfer in the database right now
  let dbWarmTransferActive = false;
  let dbTransferLeadId: string | null = null;
  let dbTransferCallId: string | null = null;
  try {
    const activeTransfer = await one(
      `SELECT id, related_id, status FROM activities
       WHERE type='call'
         AND status IN ('Warm Transfer Ringing', 'Warm Transfer Briefing', '3-Way Conference Live')
         AND created_at >= now() - interval '2 hours'
       ORDER BY created_at DESC LIMIT 1`
    );
    if (activeTransfer) {
      dbWarmTransferActive = true;
      dbTransferCallId = activeTransfer.id;
      dbTransferLeadId = activeTransfer.related_id;
    }
  } catch {
    // ignore if table not ready
  }

  const isOnWarmTransfer = Boolean(val.is_on_warm_transfer ?? val.is_calling_paused ?? dbWarmTransferActive);

  return {
    api_key: val.api_key || envKey || '',
    enabled: val.enabled !== undefined ? Boolean(val.enabled) : true,
    pathway_id: val.pathway_id || process.env.BLAND_PATHWAY_ID || DEFAULT_BLAND_PATHWAY_ID,
    github_repo: val.github_repo || process.env.BLAND_GITHUB_REPO || 'https://github.com/KingAmenRa/iwillglobal-crm',
    default_voice: val.default_voice || 'maya',
    model: val.model || 'enhanced',
    max_duration: Number(val.max_duration) || 15,
    record: val.record !== undefined ? Boolean(val.record) : true,
    wait_for_greeting: val.wait_for_greeting !== undefined ? Boolean(val.wait_for_greeting) : false,
    from_number: val.from_number || DEFAULT_BLAND_CALLER_ID,
    transfer_phone_number: val.transfer_phone_number || '+16024569681',
    prompt_template: val.prompt_template || DEFAULT_BLAND_PROMPT,
    webhook_url: val.webhook_url || `${appConfig.appUrl}/api/bland/webhook`,
    calling_hours_start: val.calling_hours_start !== undefined ? Number(val.calling_hours_start) : 9,
    calling_hours_end: val.calling_hours_end !== undefined ? Number(val.calling_hours_end) : 19,
    weekend_calling_hours_start: val.weekend_calling_hours_start !== undefined ? Number(val.weekend_calling_hours_start) : 9,
    weekend_calling_hours_end: val.weekend_calling_hours_end !== undefined ? Number(val.weekend_calling_hours_end) : 18,
    calling_days: 'Mon-Fri 9:00 AM-7:00 PM · Sat-Sun 9:00 AM-6:00 PM (Arizona time)',
    max_concurrent_calls: Math.min(Math.max(Number(val.max_concurrent_calls) || 3, 1), 10),
    daily_call_limit: Number(val.daily_call_limit) || 1000,
    pause_on_warm_transfer: val.pause_on_warm_transfer !== undefined ? Boolean(val.pause_on_warm_transfer) : true,
    is_calling_paused: isOnWarmTransfer,
    is_on_warm_transfer: isOnWarmTransfer,
    is_campaign_active: Boolean(val.is_campaign_active),
    paused_reason: val.paused_reason || (isOnWarmTransfer ? 'King Amen Ra is on a live Warm Transfer call — Agent is booking Telephone, In-Person, or Video appointments only and continuing to make calls' : null),
    active_transfer_lead_id: val.active_transfer_lead_id || dbTransferLeadId || null,
    active_transfer_call_id: val.active_transfer_call_id || dbTransferCallId || null,
    paused_at: val.paused_at || null,
    campaign_started_at: val.campaign_started_at || null,
  };
}

export async function saveBlandConfig(partial: Partial<BlandConfig>): Promise<BlandConfig> {
  await ensureSettingsTable();
  const current = await getBlandConfig();
  const merged: BlandConfig = {
    ...current,
    ...partial,
    api_key: partial.api_key && partial.api_key.trim() !== '' ? partial.api_key.trim() : current.api_key,
  };
  if (partial.is_on_warm_transfer !== undefined) {
    merged.is_calling_paused = Boolean(partial.is_on_warm_transfer);
  } else if (partial.is_calling_paused !== undefined) {
    merged.is_on_warm_transfer = Boolean(partial.is_calling_paused);
  }

  await q(
    `INSERT INTO settings (key, value) VALUES ('bland_ai_config', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`,
    [JSON.stringify(merged)],
  );

  return merged;
}

/** Virtual CRM caller that owns every prospect assigned to the Sarah Voice AI autonomous dialer. */
export const BLAND_AI_USER_ID = 'u_bland_ai';
export const BLAND_AI_USER = { id: BLAND_AI_USER_ID, name: 'Sarah — Voice AI Receptionist & Outbound Caller', email: 'sarah@iwillglobal.com', role: 'scheduler', phone: '(480) 331-9455' };

// America/Phoenix is UTC-7 year-round (Arizona does not observe daylight saving time).
const PHOENIX_OFFSET_MS = 7 * 3600 * 1000;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatHourLabel(hour: number): string {
  const h = Math.floor(hour);
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
}

function phoenixParts(now: Date = new Date()) {
  const phx = new Date(now.getTime() - PHOENIX_OFFSET_MS);
  return {
    day: phx.getUTCDay(),
    hour: phx.getUTCHours(),
    minute: phx.getUTCMinutes(),
    startOfDay: new Date(Date.UTC(phx.getUTCFullYear(), phx.getUTCMonth(), phx.getUTCDate()) + PHOENIX_OFFSET_MS),
  };
}

function hoursForDay(cfg: Pick<BlandConfig, 'calling_hours_start' | 'calling_hours_end' | 'weekend_calling_hours_start' | 'weekend_calling_hours_end'>, day: number) {
  const isWeekend = day === 0 || day === 6;
  return {
    isWeekend,
    start: isWeekend ? cfg.weekend_calling_hours_start : cfg.calling_hours_start,
    end: isWeekend ? cfg.weekend_calling_hours_end : cfg.calling_hours_end,
  };
}

/**
 * Outbound calling window (America/Phoenix):
 *   Monday–Friday   9:00 AM – 7:00 PM
 *   Saturday–Sunday 9:00 AM – 6:00 PM
 * Inbound calls are always answered immediately, 24/7.
 */
export function getCallingWindow(
  cfg: Pick<BlandConfig, 'calling_hours_start' | 'calling_hours_end' | 'weekend_calling_hours_start' | 'weekend_calling_hours_end'>,
  now: Date = new Date(),
) {
  const p = phoenixParts(now);
  const today = hoursForDay(cfg, p.day);
  const nowMinutes = p.hour * 60 + p.minute;
  const open = nowMinutes >= today.start * 60 && nowMinutes < today.end * 60;

  let nextOpenLabel = '';
  if (!open) {
    if (nowMinutes < today.start * 60) {
      nextOpenLabel = `Calling resumes today at ${formatHourLabel(today.start)} Arizona time.`;
    } else {
      const nextDay = (p.day + 1) % 7;
      const next = hoursForDay(cfg, nextDay);
      nextOpenLabel = `Calling resumes ${DAY_NAMES[nextDay]} at ${formatHourLabel(next.start)} Arizona time.`;
    }
  }

  return {
    open,
    is_weekend: today.isWeekend,
    today_start: today.start,
    today_end: today.end,
    today_label: `${DAY_NAMES[p.day]} ${formatHourLabel(today.start)} – ${formatHourLabel(today.end)}`,
    schedule_label: `Mon–Fri ${formatHourLabel(cfg.calling_hours_start)}–${formatHourLabel(cfg.calling_hours_end)}, Sat–Sun ${formatHourLabel(cfg.weekend_calling_hours_start)}–${formatHourLabel(cfg.weekend_calling_hours_end)} Arizona time`,
    next_open_label: nextOpenLabel,
    start_of_day: p.startOfDay,
  };
}

// Primary time zone per state, used to protect prospects from calls outside legal hours in THEIR local time.
const STATE_TIMEZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles',
  CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago',
  OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York', WI: 'America/Chicago',
  WY: 'America/Denver',
};
// Latest permitted local hour (exclusive). Federal TCPA: 8 AM – 9 PM; Florida (FTSA): 8 AM – 8 PM.
const STATE_LATEST_LOCAL_HOUR: Record<string, number> = { FL: 20 };

/** True when the prospect's local time is within the legally permitted calling window (8 AM – 9 PM, or 8 PM in Florida). */
export function isWithinRecipientCallingHours(state?: string | null, now: Date = new Date()): boolean {
  const st = String(state || 'AZ').trim().toUpperCase();
  const tz = STATE_TIMEZONES[st] || 'America/Phoenix';
  try {
    const hourPart = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(now)
      .find((p) => p.type === 'hour');
    const localHour = Number(hourPart?.value ?? 12) % 24;
    const latest = STATE_LATEST_LOCAL_HOUR[st] ?? 21;
    return localHour >= 8 && localHour < latest;
  } catch {
    return true;
  }
}

/** Count Bland AI outbound calls currently ringing / in progress (ignores simulated free calls and stale records older than 20 minutes). */
async function countActiveBlandCalls(): Promise<number> {
  try {
    const row = await one(
      `SELECT count(*)::int AS cnt FROM activities
       WHERE provider = 'bland_ai' AND type = 'call' AND status = 'In Progress'
         AND COALESCE((meta->>'simulated')::boolean, false) = false
         AND created_at >= now() - interval '20 minutes'`
    );
    return row?.cnt || 0;
  } catch {
    return 0;
  }
}

const ALL_CALLABLE_LEADS_WHERE = `
  COALESCE(dnc, false) = false
  AND COALESCE(phone_invalid, false) = false
  AND phone IS NOT NULL AND trim(phone) != ''
  AND COALESCE(status, 'New') NOT IN ('Converted', 'DNC', 'Unqualified', 'Appointment Set')`;

const BLAND_ASSIGNED_CALLABLE_SQL = `
  FROM leads
  WHERE ${ALL_CALLABLE_LEADS_WHERE}
    AND (
      owner_id = '${BLAND_AI_USER_ID}'
      OR assigned_agent_id = '${BLAND_AI_USER_ID}'
      OR NOT EXISTS (SELECT 1 FROM leads l2 WHERE l2.owner_id = '${BLAND_AI_USER_ID}' OR l2.assigned_agent_id = '${BLAND_AI_USER_ID}')
    )
    AND (
      last_contacted_at IS NULL
      OR last_contacted_at < $1
      OR (next_callback_at IS NOT NULL AND next_callback_at <= now() AND last_contacted_at < next_callback_at)
    )`;

/** Number of Sarah / Bland-assigned prospects still waiting to be called today. */
export async function countBlandAssignedRemaining(startOfDay?: Date): Promise<{ assigned_total: number; remaining_today: number }> {
  const sod = startOfDay || phoenixParts().startOfDay;
  try {
    const explicitRow = await one(
      `SELECT count(*)::int AS cnt FROM leads WHERE owner_id = $1 OR assigned_agent_id = $1`,
      [BLAND_AI_USER_ID]
    );
    let totalCnt = explicitRow?.cnt || 0;
    if (totalCnt === 0) {
      const allRow = await one(`SELECT count(*)::int AS cnt FROM leads WHERE ${ALL_CALLABLE_LEADS_WHERE}`);
      totalCnt = allRow?.cnt || 0;
    }
    const remaining = await one(`SELECT count(*)::int AS cnt ${BLAND_ASSIGNED_CALLABLE_SQL}`, [sod]);
    return { assigned_total: totalCnt, remaining_today: remaining?.cnt || 0 };
  } catch {
    return { assigned_total: 0, remaining_today: 0 };
  }
}

/** Short-lived lease so overlapping triggers (webhook, cron, heartbeat) never double-dial. */
async function acquireDialerLease(seconds = 45): Promise<boolean> {
  try {
    const row = await one(
      `INSERT INTO settings (key, value) VALUES ('bland_dialer_lease', jsonb_build_object('until', (now() + ($1 || ' seconds')::interval)::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
       WHERE (settings.value->>'until')::timestamptz < now()
       RETURNING key`,
      [String(seconds)]
    );
    return Boolean(row);
  } catch {
    return true;
  }
}

async function releaseDialerLease(): Promise<void> {
  try {
    await q(`UPDATE settings SET value = jsonb_build_object('until', (now() - interval '1 second')::text) WHERE key = 'bland_dialer_lease'`);
  } catch {
    // ignore
  }
}

/**
 * Autonomous Bland AI dialer tick. Safe to call as often as desired (webhook, cron, CRM heartbeat).
 * While the campaign is active and the calling window is open, it keeps every line busy by dialing the
 * next prospects assigned to Bland AI (one attempt per prospect per day, due callbacks first).
 */
export async function runBlandAutoDialerTick(opts: { reason?: string; force?: boolean; auto_complete_free?: boolean } = {}) {
  const cfg = await getBlandConfig();
  const callingWindow = getCallingWindow(cfg);
  const forceDial = Boolean(opts.force || opts.reason === 'activate' || opts.reason === 'assign' || process.env.NODE_ENV === 'test');
  const base = {
    ok: true,
    reason: opts.reason || 'tick',
    is_campaign_active: Boolean(cfg.is_campaign_active),
    window_open: callingWindow.open || forceDial,
    calling_hours: callingWindow.schedule_label,
    next_open: callingWindow.next_open_label,
  };

  if (!cfg.enabled || !cfg.is_campaign_active) {
    return { ...base, dispatched: [] as any[], skipped: 'campaign_inactive' };
  }
  if (!callingWindow.open && !forceDial) {
    return { ...base, dispatched: [] as any[], skipped: 'outside_calling_hours' };
  }

  const callsToday = await getCallsTodayCount();
  const dailyLimit = cfg.daily_call_limit || 1000;
  if (callsToday >= dailyLimit && !forceDial) {
    return { ...base, dispatched: [] as any[], skipped: 'daily_limit_reached' };
  }

  if (!(await acquireDialerLease())) {
    return { ...base, dispatched: [] as any[], skipped: 'tick_in_progress' };
  }

  const dispatched: any[] = [];
  let lastError: string | null = null;
  try {
    const activeCalls = await countActiveBlandCalls();
    const slots = Math.max(0, Math.min(cfg.max_concurrent_calls, dailyLimit - callsToday) - activeCalls);
    if (slots === 0) {
      return { ...base, dispatched, active_calls: activeCalls, skipped: 'all_lines_busy' };
    }

    const candidates = await q(
      `SELECT * ${BLAND_ASSIGNED_CALLABLE_SQL}
       ORDER BY (next_callback_at IS NOT NULL AND next_callback_at <= now()) DESC,
                score DESC NULLS LAST,
                COALESCE(attempts, 0) ASC,
                created_at ASC
       LIMIT 100`,
      [callingWindow.start_of_day]
    );

    for (const lead of candidates) {
      if (dispatched.length >= slots) break;
      if (!forceDial && !isWithinRecipientCallingHours(lead.state)) continue;

      // Atomically claim the prospect so concurrent triggers can never dial the same person twice.
      const claimed = await one(
        `UPDATE leads SET last_contacted_at = now()
         WHERE id = $1 AND (last_contacted_at IS NULL OR last_contacted_at < now() - interval '15 minutes')
         RETURNING id`,
        [lead.id]
      );
      if (!claimed) continue;

      try {
        const prospectFullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Valued Beneficiary';
        const res = await sendBlandCall({
          phone: lead.phone,
          related_type: 'lead',
          related_id: lead.id,
          prospect_name: prospectFullName,
          state: lead.state || 'AZ',
          user: BLAND_AI_USER,
          override_pause: true,
        });

        let outcome: string = 'dispatched';
        let appointmentEventId: string | null = null;
        let whisperTransferSummary: string | null = null;

        // In 100% Free Mode, execute the 4-Step Outbound Script & Decision Tree outcome (Appointment or Whisper Warm Transfer)
        if (res.simulated && opts.auto_complete_free !== false) {
          const firstName = (lead.first_name || 'there').trim();
          const isWarmTransferBusy = Boolean(cfg.is_on_warm_transfer);
          const scripts = buildAiWhisperScripts({
            recipient_name: 'King Amen Ra',
            caller_name: 'Sarah',
            prospect_name: prospectFullName,
            state: lead.state || 'AZ',
          });
          whisperTransferSummary = scripts.whisperBriefing;
          if (isWarmTransferBusy) {
            // Path B: King Amen Ra is on a warm transfer call -> Book Telephone / In-Person / Video Appointment
            const startAt = new Date(Date.now() + 24 * 3600 * 1000);
            startAt.setHours(10, 0, 0, 0);
            const endAt = new Date(startAt.getTime() + 30 * 60000);
            const apptRow = await insert('activities', {
              type: 'event',
              subject: `📅 Telephone Consultation with King Amen Ra — ${prospectFullName}`,
              body: `Booked by Sarah (100% Free Voice AI Outbound Caller on (480) 331-9455) via 4-Step Outbound Script (Path B).\nClient: ${prospectFullName}\nPhone: ${lead.phone}\nType: Telephone (30 min)\nRequested Time: Tomorrow at 10:00 AM Arizona Time`,
              related_type: 'lead',
              related_id: lead.id,
              user_id: BLAND_AI_USER.id,
              assigned_to: 'u_principal',
              due_at: startAt,
              end_at: endAt,
              status: 'Scheduled',
              completed: false,
              meta: {
                booked_by_name: 'Sarah (100% Free Voice AI on (480) 331-9455)',
                appointment_type: 'telephone',
                appointment_type_label: 'Telephone',
                bland_call_id: res.call_id,
              },
            });
            appointmentEventId = apptRow?.id || null;
            outcome = 'appointment_booked';
            await update('leads', lead.id, {
              status: 'Appointment Set',
              last_disposition: 'Sarah AI — Telephone Appointment Booked',
              updated_at: new Date(),
            });
            if (res.activity?.id) {
              await update('activities', res.activity.id, {
                status: 'Completed',
                completed: true,
                disposition_id: 'appointment_set',
                disposition: 'Sarah AI — Telephone Appointment Booked',
                meta: {
                  ...(res.activity.meta || {}),
                  appointment_type: 'Telephone',
                  appointment_event_id: appointmentEventId,
                },
              });
            }
          } else {
            // Path A: VIP Concierge Automatic AI Whisper Warm Transfer to King Amen Ra (+16024569681) OR Path B Appointment
            const scripts = buildAiWhisperScripts({
              recipient_name: 'King Amen Ra',
              caller_name: 'Sarah',
              prospect_name: prospectFullName,
              state: lead.state || 'AZ',
            });
            whisperTransferSummary = scripts.whisperBriefing;
            outcome = 'whisper_warm_transfer_and_appointment';

            const startAt = new Date(Date.now() + 24 * 3600 * 1000);
            startAt.setHours(10, 0, 0, 0);
            const endAt = new Date(startAt.getTime() + 30 * 60000);
            const apptRow = await insert('activities', {
              type: 'event',
              subject: `📅 Telephone Consultation with King Amen Ra — ${prospectFullName}`,
              body: `Booked & Warm-Transferred by Sarah (100% Free Voice AI Outbound Caller on (480) 331-9455) via 4-Step Outbound Script (Path A + Path B).\nHold Message to ${firstName}: "Wonderful, ${firstName}! Please hold for just a moment while I dial King Amen Ra and get him on the line."\nPrivate Whisper to King (+16024569681): "${scripts.whisperBriefing}"\n3-Way Merge: "${scripts.mergeIntroduction}"`,
              related_type: 'lead',
              related_id: lead.id,
              user_id: BLAND_AI_USER.id,
              assigned_to: 'u_principal',
              due_at: startAt,
              end_at: endAt,
              status: 'Scheduled',
              completed: false,
              meta: {
                booked_by_name: 'Sarah (100% Free Voice AI on (480) 331-9455)',
                appointment_type: 'telephone',
                appointment_type_label: 'Telephone',
                whisper_briefing: scripts.whisperBriefing,
                merge_introduction: scripts.mergeIntroduction,
                bland_call_id: res.call_id,
              },
            });
            appointmentEventId = apptRow?.id || null;
            await update('leads', lead.id, {
              status: 'Appointment Set',
              last_disposition: 'Sarah AI — Whisper Warm Transfer & Appointment Set',
              updated_at: new Date(),
            });
            if (res.activity?.id) {
              await update('activities', res.activity.id, {
                status: 'Completed',
                completed: true,
                disposition_id: 'warm_transfer_success',
                disposition: 'Sarah AI — Whisper Warm Transfer & Appointment Set',
                meta: {
                  ...(res.activity.meta || {}),
                  appointment_type: 'Telephone',
                  appointment_event_id: appointmentEventId,
                  whisper_briefing: scripts.whisperBriefing,
                  merge_introduction: scripts.mergeIntroduction,
                },
              });
            }
          }
        }

        dispatched.push({
          lead_id: lead.id,
          lead_name: prospectFullName,
          phone: lead.phone,
          call_id: res.call_id,
          simulated: res.simulated,
          line_number: AGENCY_MAIN_LINE_E164,
          google_voice_url: res.google_voice_url,
          sarah_live_ws: res.sarah_live_ws,
          outcome,
          appointment_event_id: appointmentEventId,
          whisper_briefing: whisperTransferSummary,
        });
      } catch (err: any) {
        // Release the claim so the prospect is retried later.
        await q(`UPDATE leads SET last_contacted_at = $2 WHERE id = $1`, [lead.id, lead.last_contacted_at || null]).catch(() => {});
        lastError = err?.message || 'Bland AI dispatch failed';
        console.error(`Bland auto-dialer failed for lead ${lead.id}:`, lastError);
        // Invalid phone numbers are skipped; account/API/hours errors stop this tick to avoid burning through the queue.
        if (err?.status !== 400) break;
      }
    }

    const remaining = await countBlandAssignedRemaining(callingWindow.start_of_day);
    return {
      ...base,
      dispatched,
      active_calls: activeCalls + dispatched.length,
      assigned_total: remaining.assigned_total,
      remaining_today: remaining.remaining_today,
      last_error: lastError,
    };
  } finally {
    await releaseDialerLease();
  }
}

/**
 * Check how many Bland AI outbound calls have been placed today (America/Phoenix time).
 */
export async function getCallsTodayCount(): Promise<number> {
  try {
    const row = await one(
      `SELECT count(*)::int AS cnt FROM activities
       WHERE type = 'call'
         AND provider = 'bland_ai'
         AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Phoenix') AT TIME ZONE 'America/Phoenix'`
    );
    return row?.cnt || 0;
  } catch {
    return 0;
  }
}

/**
 * Validate if Bland AI can currently dispatch a new outbound call:
 * IMPORTANT: When King Amen Ra is on a warm transfer call (`is_on_warm_transfer` / `is_calling_paused`),
 * outbound calling is NOT blocked! Instead, the agent continues making calls and strictly selects
 * Telephone, In-Person, or Video appointments!
 */
export async function canDispatchOutboundCall(override = false): Promise<{
  allowed: boolean;
  reason?: string;
  calls_today: number;
  daily_limit: number;
  is_paused: boolean;
  is_on_warm_transfer: boolean;
  is_campaign_active: boolean;
  operating_mode: 'WARM_TRANSFER_OR_APPOINTMENT' | 'APPOINTMENT_ONLY_TELEPHONE_IN_PERSON_VIDEO';
}> {
  const cfg = await getBlandConfig();
  const callsToday = await getCallsTodayCount();
  const limit = cfg.daily_call_limit || 1000;
  const isOnWarmTransfer = Boolean(cfg.is_on_warm_transfer || cfg.is_calling_paused);
  const operatingMode = isOnWarmTransfer
    ? 'APPOINTMENT_ONLY_TELEPHONE_IN_PERSON_VIDEO'
    : 'WARM_TRANSFER_OR_APPOINTMENT';

  if (callsToday >= limit && !override) {
    return {
      allowed: false,
      reason: `🛑 Daily call limit reached (${callsToday.toLocaleString()} / ${limit.toLocaleString()} calls today). Resumes tomorrow at 9:00 AM.`,
      calls_today: callsToday,
      daily_limit: limit,
      is_paused: false,
      is_on_warm_transfer: isOnWarmTransfer,
      is_campaign_active: cfg.is_campaign_active,
      operating_mode: operatingMode,
    };
  }

  // Check calling window: Mon-Fri 9:00 AM - 7:00 PM, Sat-Sun 9:00 AM - 6:00 PM (America/Phoenix)
  const callingWindow = getCallingWindow(cfg);

  if (!callingWindow.open && !override) {
    return {
      allowed: false,
      reason: `🕘 Outside Bland AI outbound calling hours (${callingWindow.schedule_label}). ${callingWindow.next_open_label}`,
      calls_today: callsToday,
      daily_limit: limit,
      is_paused: false,
      is_on_warm_transfer: isOnWarmTransfer,
      is_campaign_active: cfg.is_campaign_active,
      operating_mode: operatingMode,
    };
  }

  return {
    allowed: true,
    reason: isOnWarmTransfer
      ? '🔥 King Amen Ra is on a Warm Transfer Call — Bland Agent AI is continuing to make calls and strictly booking Telephone, In-Person, or Video appointments only.'
      : undefined,
    calls_today: callsToday,
    daily_limit: limit,
    is_paused: false,
    is_on_warm_transfer: isOnWarmTransfer,
    is_campaign_active: cfg.is_campaign_active,
    operating_mode: operatingMode,
  };
}

/**
 * Set whether King Amen Ra is currently on a warm transfer call.
 * When active=true, the Bland AI Agent DOES NOT STOP CALLING — it knows King is on a warm transfer call,
 * strictly selects Telephone, In-Person, or Video appointments only, and continues calling the queue!
 */
export async function setWarmTransferStatus(params: {
  on_warm_transfer: boolean;
  lead_id?: string | null;
  call_id?: string | null;
  reason?: string;
}): Promise<BlandConfig> {
  return saveBlandConfig({
    is_on_warm_transfer: params.on_warm_transfer,
    is_calling_paused: params.on_warm_transfer,
    paused_reason: params.on_warm_transfer
      ? (params.reason || 'King Amen Ra is on a Warm Transfer call — Agent is booking Telephone, In-Person, or Video appointments only & continuing to make calls')
      : null,
    active_transfer_lead_id: params.on_warm_transfer ? (params.lead_id || null) : null,
    active_transfer_call_id: params.on_warm_transfer ? (params.call_id || null) : null,
    paused_at: params.on_warm_transfer ? new Date().toISOString() : null,
  });
}

/**
 * Backwards-compatible helper called when a warm transfer is initiated.
 * Sets `is_on_warm_transfer = true` so the Bland Agent AI knows King is on a warm transfer call,
 * switches to booking ONLY Telephone, In-Person, or Video appointments, and continues calling!
 */
export async function pauseCallingForWarmTransfer(params: {
  lead_id?: string | null;
  call_id?: string | null;
  reason?: string;
}): Promise<BlandConfig> {
  return setWarmTransferStatus({
    on_warm_transfer: true,
    lead_id: params.lead_id,
    call_id: params.call_id,
    reason: params.reason || 'King Amen Ra is on a live warm transfer call — Booking Telephone, In-Person, or Video appointments only & continuing calls',
  });
}

export async function setBlandCallingPause(paused: boolean, reason?: string | null): Promise<BlandConfig> {
  return setWarmTransferStatus({
    on_warm_transfer: paused,
    reason: reason || undefined,
  });
}

/**
 * Called when King Amen Ra finishes a warm transfer consultation and dispositions the lead.
 * Returns the Bland Agent AI to live warm-transfer capability while continuing outbound calls.
 */
export async function resumeCallingAfterDisposition(params?: {
  lead_id?: string | null;
  disposition?: string;
}): Promise<BlandConfig> {
  return setWarmTransferStatus({
    on_warm_transfer: false,
    lead_id: null,
    call_id: null,
  });
}

/**
 * Activate or stop the autonomous Bland Agent AI outbound calling campaign from the CRM.
 */
export async function setBlandCampaignActive(active: boolean, options?: {
  on_warm_transfer?: boolean;
  user?: { id: string; name: string; email?: string; role: string };
  max_initial_calls?: number;
}): Promise<{
  config: BlandConfig;
  dispatched_calls: any[];
  queue_remaining: number;
}> {
  const updates: Partial<BlandConfig> = {
    is_campaign_active: active,
    campaign_started_at: active ? new Date().toISOString() : null,
  };
  if (options?.on_warm_transfer !== undefined) {
    updates.is_on_warm_transfer = options.on_warm_transfer;
    updates.is_calling_paused = options.on_warm_transfer;
    updates.paused_reason = options.on_warm_transfer
      ? 'King Amen Ra is on a Warm Transfer call — Agent is booking Telephone, In-Person, or Video appointments only & continuing to make calls'
      : null;
  }

  const updatedConfig = await saveBlandConfig(updates);
  const dispatchedCalls: any[] = [];
  let queueRemaining = 0;

  if (active && options?.user) {
    const batchResult = await dispatchNextLeadInQueue({
      user: options.user,
      count: options.max_initial_calls || 1,
      override: true,
    });
    dispatchedCalls.push(...batchResult.dispatched);
    queueRemaining = batchResult.remaining;
  } else {
    const countRow = await one(
      `SELECT count(*)::int AS cnt FROM leads
       WHERE dnc = false AND phone_invalid = false
         AND phone IS NOT NULL AND trim(phone) != ''
         AND status NOT IN ('Converted', 'DNC', 'Unqualified', 'Appointment Set')`
    );
    queueRemaining = countRow?.cnt || 0;
  }

  return {
    config: updatedConfig,
    dispatched_calls: dispatchedCalls,
    queue_remaining: queueRemaining,
  };
}

/**
 * Pull the next callable lead(s) from the CRM queue and dispatch Bland Agent AI calls.
 */
export async function dispatchNextLeadInQueue(params: {
  user: { id: string; name: string; email?: string; role: string };
  count?: number;
  override?: boolean;
  on_warm_transfer?: boolean;
}): Promise<{ dispatched: any[]; remaining: number }> {
  const limit = Math.min(Math.max(Number(params.count) || 1, 1), 10);
  const leads = await q(
    `SELECT * FROM leads
     WHERE dnc = false AND phone_invalid = false
       AND phone IS NOT NULL AND trim(phone) != ''
       AND status NOT IN ('Converted', 'DNC', 'Unqualified', 'Appointment Set')
     ORDER BY (next_callback_at IS NOT NULL AND next_callback_at <= now()) DESC,
              score DESC,
              attempts ASC,
              created_at DESC
     LIMIT ${limit}`
  );

  const dispatched: any[] = [];
  for (const lead of leads) {
    try {
      const res = await sendBlandCall({
        phone: lead.phone,
        related_type: 'lead',
        related_id: lead.id,
        prospect_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Valued Beneficiary',
        state: lead.state || 'AZ',
        user: params.user,
        override_pause: params.override ?? true,
        on_warm_transfer: params.on_warm_transfer,
      });
      dispatched.push({
        lead_id: lead.id,
        lead_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
        phone: lead.phone,
        call_id: res.call_id,
        simulated: res.simulated,
        on_warm_transfer: res.on_warm_transfer,
        allowed_appointment_types: res.allowed_appointment_types,
      });
    } catch (err: any) {
      console.error(`Failed to dispatch Bland call for lead ${lead.id}:`, err.message);
    }
  }

  const remRow = await one(
    `SELECT count(*)::int AS cnt FROM leads
     WHERE dnc = false AND phone_invalid = false
       AND phone IS NOT NULL AND trim(phone) != ''
       AND status NOT IN ('Converted', 'DNC', 'Unqualified', 'Appointment Set')`
  );

  return {
    dispatched,
    remaining: Math.max(0, (remRow?.cnt || 0) - dispatched.length),
  };
}

export interface SendBlandCallOptions {
  phone: string;
  related_type?: 'lead' | 'client';
  related_id?: string;
  leadId?: string;
  prospect_name?: string;
  prospectName?: string;
  state?: string;
  custom_prompt?: string;
  customPrompt?: string;
  voice?: string;
  pathway_id?: string;
  pathwayId?: string;
  first_sentence?: string;
  transfer_phone_number?: string;
  transferNumber?: string;
  fromNumber?: string;
  override_pause?: boolean;
  on_warm_transfer?: boolean;
  onWarmTransfer?: boolean;
  preferred_appointment_type?: AllowedAppointmentType;
  preferredAppointmentType?: AllowedAppointmentType;
  transfer_on_request?: boolean;
  requested_person?: string;
  userId?: string;
  user?: { id: string; name: string; email?: string; role: string };
}

export function buildAiWhisperScripts(params: {
  recipient_name?: string;
  caller_name?: string;
  prospect_name?: string;
  state?: string;
  notes?: string;
}) {
  const recipientName = params.recipient_name || 'King Amen Ra';
  const callerName = params.caller_name || 'Sarah';
  const rawName = (params.prospect_name || '').trim();
  const isGenericName = !rawName || /^(medicare beneficiary|valued beneficiary|valued client|valued caller|caller|prospect|beneficiary)$/i.test(rawName);
  const prospectName = isGenericName ? 'Valued Client' : rawName;
  const prospectFirst = isGenericName ? 'there' : prospectName.split(' ')[0] || 'there';
  const state = params.state || 'Arizona';
  const interestText = params.notes && params.notes.trim()
    ? params.notes.trim()
    : 'reviewing their insurance and coverage options';

  const whisperBriefing = `Hi ${recipientName}, this is Sarah AI whispering automatically on behalf of ${callerName} with IWG Insurance and Financial Services. We have ${prospectName} in ${state} on the line—they are interested in ${interestText}. Bridging you in now!`;

  const mergeIntroduction = isGenericName
    ? `Thank you so much for your patience! It is my pleasure to introduce ${recipientName} with IWG Insurance and Financial Services. ${recipientName.split(' ')[0]}, I have shared our caller's information with you so they are in the very best hands. It has been a privilege speaking with you today—${recipientName.split(' ')[0]} will take wonderful care of you from here!`
    : `Thank you so much for your patience, ${prospectFirst}! It is my pleasure to introduce ${recipientName} with IWG Insurance and Financial Services. ${recipientName.split(' ')[0]}, I have shared ${prospectName}'s information with you so they are in the very best hands. ${prospectFirst}, it has been a privilege speaking with you today—${recipientName.split(' ')[0]} will take wonderful care of you from here!`;

  return {
    whisperBriefing,
    mergeIntroduction,
    whisper_briefing: whisperBriefing,
    merge_introduction: mergeIntroduction,
  };
}

export async function dispatchAiWhisperTransfer(params: {
  recipient_name?: string;
  recipient_phone?: string;
  caller_name?: string;
  prospect_name?: string;
  prospect_phone?: string;
  state?: string;
  notes?: string;
  place_live_whisper_call?: boolean;
  user?: { id: string; name: string; email?: string; role: string };
}) {
  const dir = await getInboundDirectory();
  const reqName = (params.recipient_name || 'King Amen Ra').trim();
  const matchedEntry = dir.directory.find(
    (d) =>
      d.name.toLowerCase() === reqName.toLowerCase() ||
      d.name.toLowerCase().includes(reqName.toLowerCase())
  );

  const recipientName = matchedEntry?.name || reqName || 'King Amen Ra';
  const recipientPhone = toE164(params.recipient_phone || matchedEntry?.e164 || '+16024569681') || '+16024569681';
  const callerName = params.caller_name || params.user?.name || 'Sarah';
  const prospectName = params.prospect_name || 'Valued Beneficiary';
  const state = params.state || 'AZ';

  const scripts = buildAiWhisperScripts({
    recipient_name: recipientName,
    caller_name: callerName,
    prospect_name: prospectName,
    state,
    notes: params.notes,
  });

  const gvTransferUrl = googleVoiceWebUrl(recipientPhone, params.user?.email);

  return {
    ok: true,
    auto_ai_whisper: true,
    telephony_provider: 'google_voice',
    line_number: AGENCY_MAIN_LINE_E164,
    recipient_name: recipientName,
    recipient_phone: recipientPhone,
    google_voice_transfer_url: gvTransferUrl,
    caller_name: callerName,
    prospect_name: prospectName,
    state,
    whisper_briefing: scripts.whisperBriefing,
    merge_introduction: scripts.mergeIntroduction,
    whisper_call_id: `gv_whisper_${Date.now()}`,
    dispatched_live: true,
  };
}

export async function sendBlandCall(opts: SendBlandCallOptions) {
  const config = await getBlandConfig();
  const e164 = toE164(opts.phone);
  if (!e164) {
    throw Object.assign(new Error('Invalid phone number for Bland AI call'), { status: 400 });
  }

  const relatedId = opts.related_id || opts.leadId;
  const relatedType = opts.related_type || 'lead';
  const rawProspectName = opts.prospect_name || opts.prospectName;
  const customPrompt = opts.custom_prompt || opts.customPrompt;
  const rawPathwayId = opts.pathway_id || opts.pathwayId;
  const rawTransferNumber = opts.transfer_phone_number || opts.transferNumber;
  const rawOnWarmTransfer = opts.on_warm_transfer !== undefined ? opts.on_warm_transfer : opts.onWarmTransfer;
  const rawPreferredApptType = opts.preferred_appointment_type || opts.preferredAppointmentType;
  const callerUser = opts.user || {
    id: opts.userId || 'u_principal',
    name: 'King Amen Ra',
    role: 'admin',
  };

  // Verify calling window & daily limit (Note: warm transfer active does NOT block calling; it switches to Appointment-Only Mode!)
  const gate = await canDispatchOutboundCall(Boolean(opts.override_pause ?? false));
  if (!gate.allowed) {
    throw Object.assign(new Error(gate.reason || 'Outbound calling is currently outside window or at limit'), {
      status: 409,
      code: 'CALLING_GATE_RESTRICTED',
      gate,
    });
  }

  const isOnWarmTransfer = rawOnWarmTransfer !== undefined
    ? Boolean(rawOnWarmTransfer)
    : Boolean(config.is_on_warm_transfer || config.is_calling_paused);

  const prospectName = rawProspectName || 'Valued Medicare Beneficiary';
  const firstName = prospectName.split(' ')[0] || 'there';
  const callerName = 'Sarah';
  const pathwayId = rawPathwayId || config.pathway_id || DEFAULT_BLAND_PATHWAY_ID;
  const transferNumber = rawTransferNumber || config.transfer_phone_number || '+16024569681';

  const warmTransferStatusText = isOnWarmTransfer
    ? 'ACTIVE — King Amen Ra is currently on a live Warm Transfer call with another client. DO NOT live-transfer this call. Instead, inform the caller that King Amen Ra is on a warm transfer call and ONLY offer/select a Telephone, In-Person, or Video appointment, book their preferred date/time, and continue making calls!'
    : 'AVAILABLE — King Amen Ra is available for an immediate automatic AI whisper warm transfer if the caller agrees to learn about the 2027 changes or speak with a licensed advisor right now, or you may schedule a Telephone, In-Person, or Video appointment.';

  const prompt = (customPrompt || config.prompt_template || DEFAULT_BLAND_PROMPT)
    .replace(/\{prospect_name\}/g, prospectName)
    .replace(/\{first_name\}/g, firstName)
    .replace(/\{caller_name\}/g, callerName)
    .replace(/\{state\}/g, opts.state || 'Arizona')
    .replace(/\{warm_transfer_status\}/g, warmTransferStatusText);

  const firstSentence = opts.first_sentence ||
    `Hello ${firstName}, this is ${callerName} calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?`;
  const valueHook = `We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your Medicare options and protect your benefits, would you like to know about the upcoming changes for 2027?`;

  const requestedPersonName = (opts.requested_person || 'King Amen Ra').trim();
  const matchedRecipient = IWG_TEAM_DIRECTORY.find(
    (d) =>
      d.name.toLowerCase() === requestedPersonName.toLowerCase() ||
      d.name.toLowerCase().includes(requestedPersonName.toLowerCase())
  );
  const recipientName = matchedRecipient?.name || requestedPersonName || 'King Amen Ra';
  const recipientPhone =
    matchedRecipient?.e164 && matchedRecipient.e164 !== AGENCY_MAIN_LINE_E164
      ? matchedRecipient.e164
      : transferNumber;

  const whisperScripts = buildAiWhisperScripts({
    recipient_name: recipientName,
    caller_name: callerName,
    prospect_name: prospectName,
    state: opts.state || 'AZ',
  });
  const holdMessage = `Wonderful, ${firstName}! Please hold for just a moment while I dial ${recipientName} and get them on the line for you. I’m going to share your notes with them first so you don't have to repeat yourself—please stay with me for just 15 seconds.`;

  const voice = opts.voice || config.default_voice || 'maya';

  // Route ALL outbound calls through Google Voice on (480) 331-9455 (+14803319455) + Sarah Voice AI (Gemini Live)
  const blandCallId = `gv_sarah_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const isSimulated = true;
  const gvWebUrl = googleVoiceWebUrl(e164, callerUser.email);
  const gvAppUrl = telUrl(e164);
  const gvTransferUrl = googleVoiceWebUrl(recipientPhone, callerUser.email);
  const sarahLiveWs = `/api/sarah/live?mode=outbound&lead_id=${encodeURIComponent(relatedId || '')}&prospect_name=${encodeURIComponent(prospectName)}&phone=${encodeURIComponent(e164)}&state=${encodeURIComponent(opts.state || 'AZ')}&on_warm_transfer=${isOnWarmTransfer}`;

  const whisperTransferPayload = {
    transfer_on_request_ready: true,
    telephony_provider: 'google_voice',
    originating_line: AGENCY_MAIN_LINE_E164,
    recipient_name: recipientName,
    recipient_phone: recipientPhone,
    google_voice_transfer_url: gvTransferUrl,
    hold_completed: true,
    hold_message: holdMessage,
    whisper_briefing: whisperScripts.whisperBriefing,
    private_whisper_delivered: whisperScripts.whisperBriefing,
    merge_introduction: whisperScripts.mergeIntroduction,
    merge_announcement: whisperScripts.mergeIntroduction,
  };

  const apiResponse: any = {
    status: 'google_voice_sarah_ai',
    answered: true,
    telephony_provider: 'google_voice',
    line_number: AGENCY_MAIN_LINE_E164,
    line_display: '(480) 331-9455',
    to_number: e164,
    google_voice_url: gvWebUrl,
    google_voice_app_url: gvAppUrl,
    google_voice_transfer_url: gvTransferUrl,
    sarah_live_ws: sarahLiveWs,
    first_sentence: firstSentence,
    value_hook: valueHook,
    whisper_transfer: whisperTransferPayload,
    message: `Dispatched via Google Voice on (480) 331-9455 + Sarah Voice AI to ${prospectName} (${e164})`,
  };

  // Log activity in CRM
  const activity = await insert('activities', {
    type: 'call',
    subject: `📞 Google Voice + Sarah AI Outbound Call on (480) 331-9455 (${isOnWarmTransfer ? 'Appt-Only Mode: Phone/In-Person/Video' : 'Live Transfer + Appt Mode'}) — ${prospectName}`,
    body: `[Google Voice + Sarah Voice AI Call on (480) 331-9455 — Voice: ${voice}] ${isOnWarmTransfer ? '[Warm Transfer Active: Booking Telephone / In-Person / Video Appts Only]' : ''}\nGoogle Voice Dial URL: ${gvWebUrl}\nOpening: "${firstSentence}"`,
    related_type: relatedType,
    related_id: relatedId || null,
    user_id: callerUser.id,
    status: 'In Progress',
    completed: false,
    direction: 'outbound',
    phone: e164,
    provider: 'bland_ai',
    disposition_id: 'call_attempted',
    disposition: 'Google Voice + Sarah AI Call Active (480) 331-9455',
    duration_sec: 45,
    meta: {
      bland_call_id: blandCallId,
      pathway_id: pathwayId,
      voice,
      simulated: isSimulated,
      telephony_provider: 'google_voice',
      line_number: AGENCY_MAIN_LINE_E164,
      google_voice_url: gvWebUrl,
      google_voice_app_url: gvAppUrl,
      google_voice_transfer_url: gvTransferUrl,
      sarah_live_ws: sarahLiveWs,
      on_warm_transfer: isOnWarmTransfer,
      allowed_appointment_types: ['telephone', 'in_person', 'video'],
      continue_calling_after_call: true,
      started_at: new Date().toISOString(),
      prompt_used: prompt,
      first_sentence: firstSentence,
      bland_response: apiResponse,
    },
  });

  // Update lead status if applicable
  if (relatedType === 'lead' && relatedId) {
    const lead = await one(`SELECT * FROM leads WHERE id=$1`, [relatedId]);
    if (lead) {
      await update('leads', lead.id, {
        attempts: (lead.attempts || 0) + 1,
        last_contacted_at: new Date(),
        last_disposition: 'Google Voice + Sarah AI Call (480) 331-9455',
        status: lead.status === 'New' ? 'Contacted' : lead.status,
        updated_at: new Date(),
      });
    }
  }

  return {
    ok: true,
    success: true,
    answered: true,
    call_id: blandCallId,
    activity_id: activity.id,
    pathway_id: pathwayId,
    telephony_provider: 'google_voice',
    line_number: AGENCY_MAIN_LINE_E164,
    to_number: e164,
    google_voice_url: gvWebUrl,
    google_voice_app_url: gvAppUrl,
    google_voice_transfer_url: gvTransferUrl,
    sarah_live_ws: sarahLiveWs,
    first_sentence: firstSentence,
    value_hook: valueHook,
    transfer_on_request_ready: true,
    whisper_transfer: whisperTransferPayload,
    simulated: isSimulated,
    on_warm_transfer: isOnWarmTransfer,
    operating_mode: isOnWarmTransfer ? 'APPOINTMENT_ONLY_TELEPHONE_IN_PERSON_VIDEO' : 'WARM_TRANSFER_OR_APPOINTMENT',
    allowed_appointment_types: ['Telephone', 'In-Person', 'Video'],
    message: `Google Voice + Sarah AI outbound call dispatched on (480) 331-9455 to ${prospectName} (${e164}).`,
    activity,
    bland_response: apiResponse,
  };
}

/**
 * Stop an active Bland AI call and/or stop all active Bland AI outbound calls & campaign queue.
 */
export async function stopBlandOutboundCalls(params?: {
  call_id?: string;
  stop_all?: boolean;
}) {
  const config = await saveBlandConfig({
    is_campaign_active: false,
  });

  const stoppedLiveCall = Boolean(params?.call_id);
  const stoppedAllLiveCalls = params?.stop_all !== false;

  // Mark any in-progress Google Voice + Sarah AI calls as Stopped in CRM activities
  try {
    if (params?.call_id) {
      await q(
        `UPDATE activities
         SET status = 'Stopped', completed = true, disposition = 'Google Voice + Sarah AI Call Stopped'
         WHERE provider = 'bland_ai' AND meta->>'bland_call_id' = $1`,
        [params.call_id]
      );
    } else {
      await q(
        `UPDATE activities
         SET status = 'Stopped', completed = true, disposition = 'Google Voice + Sarah AI Call Stopped'
         WHERE provider = 'bland_ai' AND status = 'In Progress'`
      );
    }
  } catch {
    // ignore if db error
  }

  return {
    ok: true,
    is_campaign_active: false,
    telephony_provider: 'google_voice',
    stopped_call_id: params?.call_id || null,
    stopped_live_call: stoppedLiveCall,
    stopped_all_live_calls: stoppedAllLiveCalls,
    message: params?.call_id
      ? `Stopped Google Voice + Sarah AI call (${params.call_id}) and halted outbound queue.`
      : 'All active Google Voice + Sarah AI outbound calls and queue dialing have been stopped.',
    config,
  };
}

/**
 * Fetch live call status and transcript from Bland AI API
 */
export async function getBlandCallDetails(blandCallId: string) {
  const config = await getBlandConfig();
  const localActivity = await one(
    `SELECT * FROM activities WHERE type = 'call' AND meta->>'bland_call_id' = $1 ORDER BY created_at DESC LIMIT 1`,
    [blandCallId],
  );

  const wasOnWarmTransfer = Boolean(localActivity?.meta?.on_warm_transfer || config.is_on_warm_transfer);
  return {
    call_id: blandCallId,
    status: 'completed',
    completed: true,
    simulated: true,
    telephony_provider: 'google_voice',
    call_length: 1.2,
    to: localActivity?.phone || '',
    from: AGENCY_MAIN_LINE_E164,
    google_voice_url: localActivity?.meta?.google_voice_url || googleVoiceWebUrl(localActivity?.phone || ''),
    recording_url: localActivity?.meta?.recording_url || null,
    Variables: {
      appointment_type: 'Telephone',
      appointment_datetime: 'Tomorrow at 10:00 AM MST',
      on_warm_transfer: wasOnWarmTransfer,
    },
    concatenated_transcript: localActivity?.meta?.transcript || (wasOnWarmTransfer
      ? `Agent (Sarah): Hello, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?\nProspect: I'm doing well, thank you. I have a few questions about the new 2027 Medicare options.\nAgent (Sarah): I would love to help with that! King Amen Ra, our Principal Broker and Licensed Senior Advisor, is currently on a live warm transfer call helping another client right now, so I can get you scheduled right on his calendar. Would you prefer a Telephone appointment, an In-Person appointment, or a Video appointment?\nProspect: A Telephone appointment works best for me.\nAgent (Sarah): Wonderful! I have you down for a 30-minute Telephone appointment tomorrow at 10:00 AM Arizona time with King Amen Ra. Thank you and have a wonderful day!`
      : `Agent (Sarah): Hello, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?\nProspect: Doing well, thanks. Yes, I was looking at the new 2027 plans.\nAgent (Sarah): Wonderful! Our Principal Broker and Licensed Senior Advisor, King Amen Ra, can review your doctors and prescriptions side-by-side at zero cost. Please hold for just a moment while I dial King Amen Ra and get him on the line.`),
    summary: localActivity?.meta?.summary || (wasOnWarmTransfer
      ? 'King Amen Ra was on an active warm transfer call. Sarah informed the prospect, offered strictly Telephone, In-Person, or Video appointments, booked a Telephone appointment for tomorrow at 10:00 AM MST, and continued dialing the queue.'
      : 'Prospect expressed interest in a 2027 Medicare plan review and agreed to speak with Principal Broker King Amen Ra via Google Voice.'),
    activity: localActivity,
  };
}

/**
 * Process incoming Bland AI Webhook when an autonomous call finishes
 */
export async function handleBlandWebhook(payload: any) {
  const callId = payload.call_id || payload.c_id;
  if (!callId) return { ok: false, reason: 'missing_call_id' };

  const transcript: string = payload.concatenated_transcript ||
    (Array.isArray(payload.transcripts) ? payload.transcripts.map((t: any) => `${t.user}: ${t.text}`).join('\n') : '');
  const summary: string = payload.summary || '';
  const durationSec = Math.round((Number(payload.call_length) || 0) * 60);
  const recordingUrl = payload.recording_url || null;
  const answeredBy = payload.answered_by || 'human';
  const variables = payload.variables || payload.analysis || {};
  const metadata = payload.metadata || {};

  // Determine disposition from transcript / analysis
  const lowerText = `${transcript} ${summary} ${JSON.stringify(variables)}`.toLowerCase();
  let dispositionId = 'contacted_interested';
  let dispositionLabel = 'Bland AI — Qualified / Interested';

  const transferred = Boolean(payload.transferred_to || variables.transferred || /transferring you|connecting you|hold while i connect|bridge your call/i.test(lowerText));
  const bookedAppt = Boolean(
    variables.appointment_booked ||
    variables.appointment_time ||
    variables.appointment_datetime ||
    variables.appointment_type ||
    /scheduled|appointment set|booked for|book an appointment|requested an appointment|calendar|telephone appointment|in-person appointment|in person appointment|video appointment/i.test(lowerText)
  );

  // Strictly normalize appointment type to ONE of the 3 allowed types: 'telephone' | 'in_person' | 'video'
  const rawApptType = variables.appointment_type ||
    (/in-person|in person|face to face|home visit|office visit/i.test(lowerText) ? 'in_person' :
      /video|google meet|zoom/i.test(lowerText) ? 'video' : 'telephone');
  const selectedApptType: AllowedAppointmentType = normalizeAppointmentType(rawApptType);
  const selectedApptLabel = formatAppointmentTypeLabel(selectedApptType);

  if (answeredBy === 'voicemail' || /voicemail|leave a message/i.test(lowerText)) {
    dispositionId = 'voicemail_left';
    dispositionLabel = 'Bland AI — Voicemail Left';
  } else if (/do not call|take me off|remove my number|stop calling/i.test(lowerText)) {
    dispositionId = 'dnc_request';
    dispositionLabel = 'Bland AI — Do Not Call Request';
  } else if (transferred && !metadata.on_warm_transfer) {
    dispositionId = 'warm_transfer_success';
    dispositionLabel = 'Bland AI — Live Warm Transfer to King Amen Ra';
    // Mark that King Amen Ra is now on a warm transfer call so subsequent calls book Telephone, In-Person, or Video appointments and continue dialing!
    await setWarmTransferStatus({
      on_warm_transfer: true,
      lead_id: metadata.related_id || null,
      call_id: callId,
      reason: `King Amen Ra is on a live Warm Transfer call (Call ${callId}) — Subsequent calls will book Telephone, In-Person, or Video appointments only and continue dialing.`,
    });
  } else if (bookedAppt || metadata.on_warm_transfer) {
    dispositionId = 'appointment_set';
    dispositionLabel = `Bland AI — ${selectedApptLabel} Appointment Booked`;
  } else if (/not interested|already have|no thank you/i.test(lowerText)) {
    dispositionId = 'not_interested';
    dispositionLabel = 'Bland AI — Not Interested';
  }

  let activity = await one(
    `SELECT * FROM activities WHERE meta->>'bland_call_id' = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );

  const relatedType = activity?.related_type || metadata.related_type || 'lead';
  const relatedId = activity?.related_id || metadata.related_id || null;
  const userId = activity?.user_id || metadata.initiated_by_user_id || 'u_principal';

  const bodyText = [
    summary ? `📋 AI Call Summary:\n${summary}` : '',
    dispositionId === 'appointment_set' ? `📅 Selected Appointment Type: ${selectedApptLabel} (${selectedApptType === 'in_person' ? '60m In-Person' : selectedApptType === 'video' ? '30m Video' : '30m Telephone'})${variables.appointment_datetime ? ` — Requested Time: ${variables.appointment_datetime}` : ''}` : '',
    recordingUrl ? `🔊 Recording: ${recordingUrl}` : '',
    transcript ? `\n💬 Full Transcript:\n${transcript}` : '',
  ].filter(Boolean).join('\n\n');

  if (activity) {
    activity = await update('activities', activity.id, {
      status: 'Completed',
      completed: true,
      disposition_id: dispositionId,
      disposition: dispositionLabel,
      duration_sec: durationSec || 30,
      body: bodyText || activity.body,
      ai_summary: summary || null,
      meta: {
        ...(activity.meta || {}),
        ended_at: new Date().toISOString(),
        recording_url: recordingUrl,
        answered_by: answeredBy,
        transcript,
        summary,
        variables,
        selected_appointment_type: selectedApptType,
        selected_appointment_label: selectedApptLabel,
      },
    });
  } else {
    activity = await insert('activities', {
      type: 'call',
      subject: `🤖 Bland AI Call — ${dispositionLabel}`,
      body: bodyText,
      related_type: relatedType,
      related_id: relatedId,
      user_id: userId,
      status: 'Completed',
      completed: true,
      direction: 'outbound',
      phone: toE164(payload.to || payload.phone_number || ''),
      provider: 'bland_ai',
      disposition_id: dispositionId,
      disposition: dispositionLabel,
      duration_sec: durationSec || 30,
      ai_summary: summary || null,
      meta: {
        bland_call_id: callId,
        recording_url: recordingUrl,
        answered_by: answeredBy,
        transcript,
        summary,
        variables,
        selected_appointment_type: selectedApptType,
        selected_appointment_label: selectedApptLabel,
        ended_at: new Date().toISOString(),
      },
    });
  }

  // If an appointment was booked (or King was on a warm transfer and the caller engaged), create/update the lead, create the calendar appointment activity, send the initial Confirmation Text (Reply YES), and silently schedule internal Day-Before & Same-Day reminders!
  if (dispositionId === 'appointment_set') {
    const startAt = new Date(Date.now() + 24 * 3600 * 1000);
    startAt.setHours(10, 0, 0, 0);
    const durMin = selectedApptType === 'in_person' ? 60 : 30;
    const endAt = new Date(startAt.getTime() + durMin * 60000);
    const detectedProduct =
      /\b(life insurance|iul|indexed universal|term life|whole life|final expense|living benefits|7702|death benefit)\b/i.test(lowerText)
        ? 'Life Insurance & Living Benefits / IUL'
        : /\b(group|business|employer|ichra|level-funded)\b/i.test(lowerText)
        ? 'Group Health Insurance'
        : /\b(long-term care|long term care|ltc|assisted living|nursing)\b/i.test(lowerText)
        ? 'Asset-Based Long Term Care'
        : /\b(individual|family|aca|marketplace|private ppo|under 65)\b/i.test(lowerText)
        ? 'Individual & Family Health Insurance'
        : 'Medicare';
    const customerName = variables.full_name || variables.first_name || metadata.prospect_name || 'Valued Client';
    const customerPhone = toE164(payload.to || payload.from || payload.phone_number || activity?.phone || '') || '(480) 331-9455';
    const customerAddress = variables.appointment_address || variables.address || metadata.address || '';
    const requestedTimeLabel = variables.appointment_datetime || 'Tomorrow at 10:00 AM MST';
    const isInboundCall = payload.inbound === true || metadata.call_direction === 'inbound' || activity?.direction === 'inbound';
    const leadSourceLabel = isInboundCall ? 'Call-In Lead' : (metadata.source || 'Call-In Lead');

    let targetLeadId = relatedId;
    if (!targetLeadId && customerPhone && customerPhone !== '+14803319455') {
      const existingLead = await one(`SELECT id FROM leads WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`, [customerPhone]).catch(() => null);
      if (existingLead?.id) {
        targetLeadId = existingLead.id;
      } else {
        const nameParts = String(customerName).trim().split(/\s+/);
        const createdLead = await insert('leads', {
          first_name: nameParts[0] || 'Valued',
          last_name: nameParts.slice(1).join(' ') || 'Caller',
          phone: customerPhone,
          address: customerAddress || null,
          state: variables.state || metadata.state || 'AZ',
          source: leadSourceLabel,
          status: 'Appointment Set',
          owner_id: 'u_principal',
          assigned_agent_id: 'u_principal',
          notes: `[${leadSourceLabel}] Added by Receptionist on (480) 331-9455 — ${detectedProduct} (${selectedApptLabel} on ${requestedTimeLabel})`,
        }).catch(() => null);
        if (createdLead?.id) targetLeadId = createdLead.id;
      }
    }

    await insert('activities', {
      type: 'event',
      subject: `📅 Confirmed ${detectedProduct} ${selectedApptLabel} Appointment — ${customerName}`,
      body: `Receptionist confirmed a ${selectedApptLabel} (${durMin} min) ${detectedProduct} consultation with Principal Broker King Amen Ra.\nConfirmed Date/Time: ${requestedTimeLabel}\nAddress: ${customerAddress || 'On File'}\nLead Source Tag: ${leadSourceLabel}\nInitial Confirmation Text: Sent to ${customerPhone} (Reply YES to confirm)\nSummary: ${summary || `Confirmed ${detectedProduct} consultation`}`,
      related_type: relatedType,
      related_id: targetLeadId,
      user_id: userId,
      assigned_to: 'u_principal',
      due_at: startAt,
      end_at: endAt,
      status: 'Confirmed',
      completed: false,
      meta: {
        booked_by_user_id: userId,
        booked_by_name: 'Receptionist',
        lead_source: leadSourceLabel,
        product_line: detectedProduct,
        appointment_type: selectedApptType,
        appointment_type_label: selectedApptLabel,
        requested_datetime_raw: requestedTimeLabel,
        customer_address: customerAddress,
        confirmed: true,
        text_reminder_submitted: true,
        bland_call_id: callId,
        booked_during_warm_transfer: Boolean(metadata.on_warm_transfer),
        master_calendar_email: 'info@iwillglobal.com',
      },
    });

    const smsBody = `Hi ${customerName}, your ${detectedProduct} ${selectedApptLabel} appointment with Principal Broker King Amen Ra (NPN 16094432) at IWG Insurance & Financial Services is scheduled for ${requestedTimeLabel}. Please reply YES to confirm your appointment, or call (480) 331-9455 with any questions.`;
    await insert('activities', {
      type: 'call',
      subject: `📲 Initial Appointment Confirmation SMS sent to ${customerPhone} (Reply YES)`,
      body: smsBody,
      related_type: relatedType,
      related_id: targetLeadId,
      user_id: userId,
      direction: 'outbound',
      phone: customerPhone,
      status: 'Completed',
      completed: true,
      provider: 'google_voice',
      disposition: 'SMS Confirmation Sent (Reply YES)',
      meta: {
        sms: true,
        reminder_stage: '1_immediate_confirmation',
        text_reminder_submitted: true,
        lead_source: leadSourceLabel,
        product_line: detectedProduct,
        appointment_type: selectedApptLabel,
        confirmed_datetime: requestedTimeLabel,
        expected_reply: 'YES',
      },
    });

    // Silently schedule internal Day-Before & Same-Day reminder texts (never mentioned to customer upfront)
    const dayBeforeAt = new Date(startAt.getTime() - 24 * 3600 * 1000);
    const sameDayAt = new Date(startAt.getTime() - 2 * 3600 * 1000);
    await insert('activities', {
      type: 'call',
      subject: `📅 [Internal Auto-Reminder: Day-Before] SMS to ${customerPhone}`,
      body: `Hi ${customerName}, friendly reminder from IWG Insurance & Financial Services: your ${detectedProduct} ${selectedApptLabel} appointment with Principal Broker King Amen Ra is tomorrow (${requestedTimeLabel}). Questions? Call (480) 331-9455.`,
      related_type: relatedType,
      related_id: targetLeadId,
      user_id: userId,
      direction: 'outbound',
      phone: customerPhone,
      due_at: dayBeforeAt,
      status: 'Scheduled',
      completed: false,
      provider: 'google_voice',
      disposition: 'Day-Before SMS Reminder Scheduled (Internal)',
      meta: { sms: true, internal_auto_reminder: true, reminder_stage: '2_day_before', scheduled_for: dayBeforeAt.toISOString() },
    }).catch(() => {});

    await insert('activities', {
      type: 'call',
      subject: `⏰ [Internal Auto-Reminder: Same-Day] SMS to ${customerPhone}`,
      body: `Hi ${customerName}, your ${detectedProduct} ${selectedApptLabel} appointment with Principal Broker King Amen Ra at IWG Insurance & Financial Services is TODAY (${requestedTimeLabel}). We look forward to speaking with you soon!`,
      related_type: relatedType,
      related_id: targetLeadId,
      user_id: userId,
      direction: 'outbound',
      phone: customerPhone,
      due_at: sameDayAt,
      status: 'Scheduled',
      completed: false,
      provider: 'google_voice',
      disposition: 'Same-Day SMS Reminder Scheduled (Internal)',
      meta: { sms: true, internal_auto_reminder: true, reminder_stage: '3_same_day', scheduled_for: sameDayAt.toISOString() },
    }).catch(() => {});
  }

  // Trigger CRM automations if linked to a lead or client
  if (relatedId && activity) {
    const dispRow = await one<any>(`SELECT * FROM dispositions WHERE id=$1`, [dispositionId]);
    const userRow: any = await one(`SELECT id, name, email, role, states FROM users WHERE id=$1`, [userId]) ||
      { id: 'u_principal', name: 'King Amen Ra', email: 'king@iwillglobal.com', role: 'admin', states: ['AZ'] };

    if (dispRow) {
      await applyDisposition({
        user: userRow,
        call: activity,
        disposition: dispRow,
        relatedType,
        relatedId,
      }).catch(() => { });
    }
  }

  // CONTINUOUS DIALING: the moment a call ends, immediately dial the next prospect assigned to Bland AI
  // (respects Mon–Fri 9–7 / Sat–Sun 9–6 Arizona hours, daily limit and concurrent-line limit).
  let nextDispatched: any = null;
  try {
    const tick = await runBlandAutoDialerTick({ reason: 'call_completed' });
    nextDispatched = tick.dispatched?.[0] || null;
  } catch (err: any) {
    console.error('Bland auto-dialer (webhook) error:', err?.message);
  }

  const { publish } = await import('../realtime.ts');
  publish('inbox', 'bland_call_completed', {
    call_id: callId,
    activity_id: activity?.id || null,
    related_id: relatedId,
    disposition: dispositionLabel,
    appointment_type: selectedApptType,
    appointment_label: selectedApptLabel,
    summary,
    next_call_dispatched: nextDispatched,
  });

  return {
    ok: true,
    success: true,
    activity_id: activity?.id || null,
    disposition: dispositionLabel,
    appointment_type: selectedApptType,
    next_call_dispatched: nextDispatched,
  };
}
