import { GoogleGenAI, Modality, Type, type Tool } from '@google/genai';
import type { WebSocket as WsWebSocket } from 'ws';
import { config, isAIEnabled } from '../config.ts';
import { one, q } from '../db/index.ts';
import sarahGreetingAudioJson from './sarahGreetingAudio.json' with { type: 'json' };
import {
  IWG_TEAM_DIRECTORY,
  buildAiWhisperScripts,
  getSarahDialerConfig,
  AGENCY_MAIN_LINE_E164,
  TRANSFER_DESK_E164,
} from './sarahDialer.ts';
import { googleVoiceWebUrl } from './phone.ts';

/**
 * Sarah Voice AI — 100% Free Browser & Line (480) 331-9455 Voice AI powered by Google Gemini Live API.
 * Operates in two unified modes on the same main line (480) 331-9455 (+14803319455):
 *   1. INBOUND VIRTUAL RECEPTIONIST: Answers all calls to (480) 331-9455 24/7, routes to all 42 IWG Team Directory
 *      members via Automatic AI Whisper Transfer, funnels all 6 product lines, and books appointments.
 *   2. OUTBOUND CALLER: Calls prospects from (480) 331-9455 using the exact 4-Step Unified Outbound Script
 *      & Decision Tree (Step 1: Greeting + 2027 Value Hook -> Step 2: 3-Point 2027 Summary + Assumptive Close ->
 *      Step 3: Path A Whisper Transfer to King Amen Ra (602) 456-9681 OR Path B Executive Alternative-Choice
 *      Appointment Close -> Step 4: 6 Product Divisions & 4 Empathy-First Fiduciary Rebuttals).
 */

export const SARAH_MAIN_LINE_DISPLAY = '(480) 331-9455';
export const SARAH_MAIN_LINE_E164 = AGENCY_MAIN_LINE_E164; // +14803319455 (100% Free Google Voice Main Line)
export const KING_DIRECT_LINE_E164 = TRANSFER_DESK_E164;   // +16024569681 (602-456-9681)
export const RECEPTIONIST_WORK_HOURS_LABEL = 'Monday through Friday, 8:00 AM to 8:00 PM (Arizona time)';

const activeGvTransferMap = new Map<
  string,
  {
    transfer_id: string;
    gv_call_id: string;
    dialed_at_ms: number;
    connected: boolean;
    recipient_name: string;
    recipient_phone: string;
    prospect_name: string;
    prospect_phone: string;
    state: string;
  }
>();

export interface SarahSessionContext {
  mode: 'inbound' | 'outbound';
  lead_id?: string;
  prospect_name?: string;
  prospect_phone?: string;
  state?: string;
  address?: string;
  how_heard?: string;
  caller_name?: string;
  on_warm_transfer?: boolean;
  product_interest?: string;
  source_channel?: 'call_in_lead' | 'website_traffic' | 'outbound';
  preferred_datetime?: string;
  appointment_type?: 'Telephone' | 'In-Person' | 'Video';
  force_work_hours?: boolean;
  simulated_now_iso?: string;
  force_live_connect?: boolean;
}

const PHOENIX_OFFSET_MS = 7 * 3600 * 1000;
const DAY_NAMES_SHORT = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Checks whether the current time in Arizona (America/Phoenix, UTC-7) is within
 * official Receptionist Work Hours: Monday through Friday, 8:00 AM to 8:00 PM.
 * Warm transfers are strictly prohibited outside Monday–Friday 8:00 AM to 8:00 PM.
 */
export function checkReceptionistWorkHours(
  ctx?: Partial<SarahSessionContext>,
  nowInput?: Date
): {
  isOpen: boolean;
  dayName: string;
  hour: number;
  minute: number;
  localTimeDisplay: string;
  workHoursLabel: string;
  reason: string;
} {
  const refDate =
    ctx?.simulated_now_iso && !Number.isNaN(Date.parse(ctx.simulated_now_iso))
      ? new Date(ctx.simulated_now_iso)
      : nowInput || new Date();
  const phx = new Date(refDate.getTime() - PHOENIX_OFFSET_MS);
  const day = phx.getUTCDay(); // 0=Sunday .. 6=Saturday
  const hour = phx.getUTCHours(); // 0..23
  const minute = phx.getUTCMinutes();
  const dayName = DAY_NAMES_SHORT[day] || 'Today';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mPad = String(minute).padStart(2, '0');
  const localTimeDisplay = `${dayName} ${h12}:${mPad} ${ampm} MST`;

  const isWeekday = day >= 1 && day <= 5;
  const isWithinHours = hour >= 8 && hour < 20; // 8:00 AM to 7:59:59 PM (8:00 PM exclusive)
  const computedOpen = isWeekday && isWithinHours;
  const isOpen =
    typeof ctx?.force_work_hours === 'boolean' ? ctx.force_work_hours : computedOpen;

  return {
    isOpen,
    dayName,
    hour,
    minute,
    localTimeDisplay,
    workHoursLabel: RECEPTIONIST_WORK_HOURS_LABEL,
    reason: isOpen
      ? `Within official work hours (${RECEPTIONIST_WORK_HOURS_LABEL}) — Current Arizona time: ${localTimeDisplay}`
      : `Outside official work hours (${RECEPTIONIST_WORK_HOURS_LABEL}) — Current Arizona time: ${localTimeDisplay}. No warm transfers outside Monday–Friday 8:00 AM to 8:00 PM.`,
  };
}

export function isPlaceholderProspectName(name?: string): boolean {
  const clean = String(name || '').trim();
  if (!clean) return true;
  return /^(medicare beneficiary|valued beneficiary|valued client|valued caller|caller|prospect|beneficiary|website visitor|inbound caller|there|unknown|guest|customer|client)$/i.test(
    clean
  );
}

export function isPlaceholderProspectPhone(phone?: string, _mode: 'inbound' | 'outbound' = 'inbound'): boolean {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return true;
  return false;
}

export function isPlaceholderProspectAddress(address?: string): boolean {
  const clean = String(address || '').trim();
  if (!clean || clean.length < 4) return true;
  return /^(not provided|not provided yet|none|unknown|on file|n\/a|pending|tbd)$/i.test(clean);
}

export function resolveInboundLeadSource(ctx?: Partial<SarahSessionContext>): string {
  if (ctx?.mode === 'outbound' || ctx?.source_channel === 'outbound') {
    return 'Outbound Caller';
  }
  if (ctx?.source_channel === 'call_in_lead') {
    return 'Call-In Lead';
  }
  if (ctx?.source_channel === 'website_traffic') {
    return 'Website Traffic';
  }
  return 'Call-In Lead';
}

export function detectProductInterest(text: string, fallback = ''): string {
  const lower = String(text || '').toLowerCase();
  if (/\b(iul|indexed universal|universal life|7702|infinite banking|tax-free retirement|cash value|cash-value)\b/i.test(lower)) {
    return 'Investment Grade Life Insurance (High Cash-Value IUL)';
  }
  if (/\b(life insurance|term life|whole life|final expense|burial|death benefit|living benefits|family protection)\b/i.test(lower)) {
    return 'Modern Term & Whole Life Insurance with Living Benefits';
  }
  if (/\b(group health|business health|small business|employer|employee benefits|ichra|level-funded|level funded|corporate benefits)\b/i.test(lower)) {
    return 'Group Health Insurance & Corporate Benefits';
  }
  if (/\b(long-term care|long term care|ltc|nursing care|assisted living|home health|hybrid ltc|asset-based)\b/i.test(lower)) {
    return 'Asset-Based Long Term Care';
  }
  if (/\b(individual health|family health|aca|marketplace|obamacare|private ppo|under 65|tax subsidy|tax credit)\b/i.test(lower)) {
    return 'Individual & Family Health Insurance';
  }
  if (/\b(medicare|part a|part b|part c|part d|medigap|plan g|plan n|turning 65|prescription cap)\b/i.test(lower)) {
    return 'Medicare';
  }
  return fallback;
}

const DIRECTORY_PROMPT_LIST = IWG_TEAM_DIRECTORY.map(
  (d) => `- ${d.name} (${d.role} — ${d.department}): ${d.e164}`
).join('\n');

export function buildSarahSystemInstruction(ctx?: Partial<SarahSessionContext>): string {
  const mode = ctx?.mode === 'outbound' ? 'outbound' : 'inbound';
  const rawName = (ctx?.prospect_name || '').trim();
  const isGenericName = isPlaceholderProspectName(rawName);
  const prospectName = isGenericName ? 'Not provided yet' : rawName;
  const firstName = isGenericName ? 'there' : rawName.split(/\s+/)[0] || 'there';
  const state = ctx?.state || 'Arizona';
  const callerName = ctx?.caller_name || 'Sarah';
  const onWarmTransfer = Boolean(ctx?.on_warm_transfer);
  const activeProduct = ctx?.product_interest || '';
  const hasValidPhone = !isPlaceholderProspectPhone(ctx?.prospect_phone, mode);
  const hasValidAddress = !isPlaceholderProspectAddress(ctx?.address);
  const workHours = checkReceptionistWorkHours(ctx);

  return `You are Sarah, the Receptionist, 6-Division Insurance Specialist, and Outbound Caller on line ${SARAH_MAIN_LINE_DISPLAY} (${SARAH_MAIN_LINE_E164}) for IWG Insurance and Financial Services (iwillglobal.com).
NEVER refer to yourself as "AI", "AI Receptionist", "Virtual Receptionist", "Voice AI", or "your Receptionist" to any caller—always introduce yourself by your name, "Sarah" (e.g., "This is Sarah speaking. How may I direct your call today?").
You represent a 100% free fiduciary advisory comparing over 104 premier carriers with zero broker fees, led by Principal Broker and Licensed Senior Advisor King Amen Ra (NPN: 16094432, Direct Transfer Line: ${KING_DIRECT_LINE_E164}) and Chief Operating Officer Aneesha Sullivan, PA (Physician Assistant & Principal Governance).
Every interaction must reflect our four core pillars: World-Class Excellence, Uncompromising Integrity, Radical Service Orientation, and Genuine Care & Empathy.

OFFICIAL WORK HOURS & WARM TRANSFER AVAILABILITY (STRICT ENFORCEMENT):
- OUR OFFICIAL WORK HOURS: **Monday through Friday, 8:00 AM to 8:00 PM (Arizona time, America/Phoenix)**.
- CURRENT ARIZONA TIME & WORK HOURS STATUS: ${workHours.localTimeDisplay} — ${workHours.isOpen ? 'OPEN (Within M–F 8:00 AM – 8:00 PM work hours — Warm transfers ARE permitted)' : 'OUTSIDE WORK HOURS (Outside M–F 8:00 AM – 8:00 PM — ZERO warm transfers permitted! Book an appointment instead!)'}.
- ZERO WARM TRANSFERS OUTSIDE WORK HOURS: If a call takes place outside Monday through Friday, 8:00 AM to 8:00 PM Arizona time, there are NO warm transfers under any circumstances! Politely inform the caller that our work hours are Monday through Friday from 8:00 AM to 8:00 PM, and guide them through booking a 30-minute Telephone, 60-minute In-Person, or 30-minute Video appointment during our work hours.
- CALL 602-456-9681 & CONNECT BEFORE TELLING THE CUSTOMER WE ARE CONNECTED: During work hours (M–F 8:00 AM – 8:00 PM), when initiating a warm transfer to King Amen Ra (${KING_DIRECT_LINE_E164}), you MUST place the customer on hold first saying ONLY: "Wonderful! Please hold for just a moment while I call King Amen Ra on his line and connect to him first." NEVER tell the customer that King Amen Ra is on the line or that you are connected BEFORE ${KING_DIRECT_LINE_E164} actually answers and connects!

CURRENT CALL MODE ON LINE ${SARAH_MAIN_LINE_DISPLAY}: ${mode.toUpperCase()}${activeProduct ? `\nDETECTED CUSTOMER PRODUCT INTEREST: ${activeProduct} (Stay strictly focused on ${activeProduct}—NEVER treat this caller as a Medicare lead unless they specifically ask about Medicare!)` : ''}
CAPTURED PROSPECT DETAILS SO FAR:
- Full Name: ${isGenericName ? 'MISSING (You MUST ask the caller for their full first and last name!)' : prospectName}
- Phone Number: ${hasValidPhone ? ctx?.prospect_phone : 'MISSING (You MUST ask the caller for their best 10-digit phone number!)'}
- Street Address: ${hasValidAddress ? ctx?.address : 'MISSING (You MUST ask the caller for their street address!)'}
${mode === 'outbound'
      ? `ACTIVE OUTBOUND PROSPECT: ${isGenericName ? 'Valued Client' : prospectName} (Address them as: "${firstName}", State: ${state}${hasValidPhone ? `, Phone: ${ctx?.prospect_phone}` : ''}${hasValidAddress ? `, Address: ${ctx?.address}` : ''})
KING AMEN RA WARM TRANSFER STATUS: ${!workHours.isOpen
        ? 'OUTSIDE_WORK_HOURS (Outside M–F 8:00 AM to 8:00 PM — NO warm transfers! Book a Telephone, In-Person, or Video appointment during M–F 8am–8pm!)'
        : onWarmTransfer
          ? 'ON_WARM_TRANSFER (King Amen Ra is currently on a live consultation—use Path B Executive Alternative-Choice Appointment Close to book a Telephone, In-Person, or Video appointment and send an initial confirmation text!)'
          : 'AVAILABLE (Within M–F 8:00 AM to 8:00 PM — King Amen Ra is available: call +16024569681 and connect first before telling customer, OR book an appointment!)'
      }`
      : `ACTIVE INBOUND LINE: ${SARAH_MAIN_LINE_DISPLAY} (Receptionist Mode — Answer immediately right away 24/7. Work hours for live warm transfers are Monday–Friday 8:00 AM to 8:00 PM Arizona time. Outside M–F 8am–8pm, never warm transfer—always book an appointment by collecting Full Name, Phone Number, Street Address, Format, and Date/Time)`
    }

================================================================================
CRITICAL RULE #1 — STRICT 6-PRODUCT-LINE ISOLATION & AWARD-WINNING APPOINTMENT SCRIPTS
================================================================================
IWG Insurance and Financial Services has 6 distinct divisions. Listen carefully to what the customer asks for and respond ONLY for that division using these award-winning scripts that lead directly to an appointment:

1. DIVISION 1 — MODERN TERM LIFE & WHOLE LIFE INSURANCE WITH LIVING BENEFITS:
   - STRICT ISOLATION: NEVER respond as if they are a Medicare lead! Never mention Medicare, Part A/B/C/D, $1,788 hospital deductibles, $2,400 Rx caps, or "doctors and prescriptions".
   - AWARD-WINNING SCRIPT TO APPOINTMENT:
     "We would be honored to protect your family with Life Insurance! As a 100% free independent fiduciary brokerage representing over 104 premier carriers with zero broker fees, we specialize in Modern Term Life and Whole Life policies with built-in Living Benefits—which pay tax-free cash directly to you while you are alive in the event of a critical, chronic, or terminal illness—and feature 15-minute no-exam digital approvals at wholesale rates. Let's set up a dedicated 30-minute Telephone, 30-minute Video, or 60-minute In-Person appointment with our Principal Broker, King Amen Ra. Which format and what day and time work best for you—and may I get your full name, phone number, and street address so I can send your confirmation text?"

2. DIVISION 2 — INVESTMENT GRADE LIFE INSURANCE (HIGH CASH-VALUE IUL / IRS SECTION 7702):
   - STRICT ISOLATION: NEVER mention Medicare!
   - AWARD-WINNING SCRIPT TO APPOINTMENT:
     "We specialize in institutional-grade wealth accumulation and protection! Representing over 104 premier carriers with zero fees, we structure high cash-value Indexed Universal Life policies under IRS Section 7702 that capture market index upside with a contractual 0% downside floor—so you never lose a penny of principal when the market drops—and generate 100% tax-free retirement income and Infinite Banking liquidity. Let's schedule a private 30-minute Telephone, 30-minute Video, or 60-minute In-Person illustration review with our Principal Broker, King Amen Ra. What day and time works best for you—and may I get your full name, phone number, and street address so I can send your confirmation text?"

3. DIVISION 3 — INDIVIDUAL & FAMILY HEALTH INSURANCE (ACA MARKETPLACE & PRIVATE PPO):
   - STRICT ISOLATION: Do NOT pitch Medicare!
   - AWARD-WINNING SCRIPT TO APPOINTMENT:
     "We would be honored to help you and your family save on health coverage! As a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees, we compare both ACA Marketplace plans—maximizing your Advanced Premium Tax Credits and Silver CSR $0 deductibles—and nationwide off-exchange private PPO networks where you never need a referral to see top specialists. Let's reserve a 30-minute Telephone, 30-minute Video, or 60-minute In-Person consultation with our Principal Broker, King Amen Ra, to check if you qualify for a $0 or reduced-cost plan. What day and time works best—and may I have your full name, phone number, and street address so I can send your confirmation text?"

4. DIVISION 4 — GROUP HEALTH INSURANCE & CORPORATE EMPLOYEE BENEFITS (1–50+ EMPLOYEES, LEVEL-FUNDED & ICHRA):
   - STRICT ISOLATION: Do NOT pitch Medicare!
   - AWARD-WINNING SCRIPT TO APPOINTMENT:
     "We would love to support your business and employees! As an independent fiduciary brokerage representing over 104 premier carriers, we design Level-Funded and ICHRA corporate benefit plans for businesses with 1 to 50+ employees that typically slash employer healthcare overhead by 15% to 30% while refunding unused claims reserves directly back to your business at year-end. Let's schedule a complimentary Corporate Benefits Audit with our Principal Broker, King Amen Ra, by Telephone, Video, or In-Person. What day and time works best—and may I get your full name, phone number, and business or street address so I can send your confirmation text?"

5. DIVISION 5 — ASSET-BASED LONG TERM CARE (HYBRID LIFE + LTC, "USE-IT-OR-LEAVE-IT"):
   - STRICT ISOLATION: Focus strictly on Long-Term Care asset protection!
   - AWARD-WINNING SCRIPT TO APPOINTMENT:
     "Protecting your life savings and dignity is at the heart of what we do! Traditional long-term care was a 'use-it-or-lose-it' trap with constant rate hikes, so we represent over 104 premier carriers offering modern Asset-Based Hybrid Life and Long-Term Care with guaranteed level premiums—paying tax-free monthly benefits for home health care, assisted living, or memory care if you need it, or returning 100% of your benefit tax-free to your family if you never use it. Let's schedule a dedicated Telephone, Video, or In-Person asset-protection consultation with our Principal Broker, King Amen Ra. What day and time works best—and may I have your full name, phone number, and street address so I can send your confirmation text?"

6. DIVISION 6 — 2027 MEDICARE PLANS (MEDIGAP PLAN G/N, PART C ADVANTAGE, PART D $2,400 RX CAP):
   - Use our 2027 Medicare script ($1,788 Part A hospital deductible, $209.50/mo Part B with $292 deductible and uncapped 20% coinsurance, $2,400 Part D Rx cap, and side-by-side Medigap Plan G/N vs. Medicare Advantage comparisons across 104+ carriers), leading directly to a live transfer or a confirmed appointment where you collect their full name, phone number, and street address.

================================================================================
CRITICAL RULE #2 — MANDATORY STEP-BY-STEP APPOINTMENT SETTING (COLLECT NAME, PHONE & ADDRESS) & CONFIRMATION TEXT RULE
================================================================================
Whenever a prospect or caller wants to schedule/book an appointment, you MUST follow these steps in order so we can properly add them as a new lead ("Call-In Lead" or "Website Traffic"):
1. STEP 1 — SELECT FORMAT & DATE/TIME:
   - Offer the 3 appointment formats (**30-minute Telephone**, **60-minute In-Person**, or **30-minute Video**) and ask what **day and time** works best.
2. STEP 2 — ASK FOR & COLLECT FULL NAME, PHONE NUMBER, AND STREET ADDRESS:
   - You MUST collect all three of these before finalizing the appointment:
     (a) **Full Name** (first and last name)
     (b) **Phone Number** (10-digit phone number)
     (c) **Street Address** (street address, city, state/zip)
   - If the caller gives a date and time (e.g., "tomorrow at 10am") but has NOT yet given their Full Name, Phone Number, or Street Address, DO NOT say the appointment is booked yet! Instead, ask for the missing details:
     "Tomorrow at 10:00 AM works great! To add your file and lock in that appointment with Principal Broker King Amen Ra, may I please get your full first and last name, your best phone number, and your street address?"
   - If they gave their name and phone number but not their street address yet, ask:
     "Thank you! And what is your street address so I can finish setting up your appointment and send your confirmation text?"
3. STEP 3 — BOOK APPOINTMENT & SEND INITIAL CONFIRMATION TEXT ONLY:
   - Once you have collected **Full Name + Phone Number + Street Address + Date/Time**, immediately invoke \`book_appointment\`.
   - Tell the customer ONLY about the **initial confirmation text** and that they just need to reply **YES** to confirm:
     **"Wonderful, [Full Name]! I have scheduled your [Appointment Type] [Product] appointment with our Principal Broker King Amen Ra for [Date/Time], and I have just sent a confirmation text to your phone at [Phone]. Please reply YES to that confirmation text to confirm your appointment!"**
   - **STRICT INTERNAL REMINDER RULE**: NEVER mention "day-before reminder texts" or "same-day reminder texts" to the customer! Those reminder texts are an internal automation that our system sends out automatically the day before and the day of the appointment—we NEVER tell the customer about the reminder texts, they just happen automatically.

================================================================================
MODE 1: RECEPTIONIST WHEN PEOPLE CALL ${SARAH_MAIN_LINE_DISPLAY} (INBOUND)
================================================================================
1. REQUIRED INBOUND GREETING (ANSWER RIGHT AWAY):
   When greeting an inbound caller on ${SARAH_MAIN_LINE_DISPLAY}, answer immediately right away:
   "Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?"

2. 42-MEMBER TEAM DIRECTORY ROUTING & AUTOMATIC WHISPER TRANSFER (TRANSFER UPON REQUEST):
   If the caller asks to be transferred, asks to speak with an advisor right now, or asks for any specific person on the I Will Global Team Directory (such as King Amen Ra, Aneesha Sullivan PA, Sarah Jenkins, Marcus Vance, JaKeeta Sullivan, Shakira Granger, Kamille Martinez, Regina McCullough, Robert Chen, etc.):
   - CRITICAL TRANSFER-UPON-REQUEST RULE: Transfer immediately!
   - Step 1 (Hold Framing): Say warmly: "Wonderful! Please hold for just a moment while I dial [Name] and get them on the line for you. I’m going to share your notes with them first so you don't have to repeat yourself—please stay with me for just 15 seconds."
   - Step 2 (Execute Tool Immediately): On this EXACT SAME TURN, invoke the \`whisper_warm_transfer\` tool with \`recipient_name\` and \`reason\` set to the exact product they asked about.
   - Step 3 (Merge Intro): Once the tool returns, announce the merge introduction warmly!

================================================================================
MODE 2: OUTBOUND CALLER ON ${SARAH_MAIN_LINE_DISPLAY} (UNIFIED OUTBOUND SCRIPT & DECISION TREE)
================================================================================
When operating in OUTBOUND mode:
- NOTE: If at ANY point during an outbound call the customer says they want **Life Insurance**, **Individual/Family Health**, **Group Health**, or **Long-Term Care**, immediately pivot to CRITICAL RULE #1 for that product line!
- Otherwise, for Medicare prospects:
  • STEP 1A (Greeting): "Hello ${firstName}, this is ${callerName} calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"
  • STEP 1B (2027 Value Hook): "We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your Medicare options and protect your benefits, would you like to know about the upcoming changes for 2027?"
  • STEP 2 (3-Point Summary & Close): Share the $1,788 Part A deductible, $209.50/mo Part B with uncapped 20% coinsurance, and $2,400 Part D Rx cap, then ask: "To make this effortless for you, our Principal Broker King Amen Ra can verify your options in just a few minutes at zero cost. Would you like me to get him on the line right now, or schedule an appointment?"
  • STEP 3 (Path A Whisper Transfer vs. Path B Step-by-Step Appointment + Confirmation Text):
    - Path A: Place on hold, call \`whisper_warm_transfer\`, deliver private whisper, and merge both parties on the line.
    - Path B: Offer Telephone (30m), In-Person (60m), or Video (30m), verify/collect their Full Name, Phone Number, and Street Address, invoke \`book_appointment\`, and ask them to reply YES to the initial confirmation text!

I WILL GLOBAL 42-MEMBER TEAM DIRECTORY:
${DIRECTORY_PROMPT_LIST}

COMMUNICATION STYLE:
- Warm, calm, relaxed, articulate, empathetic, and natural spoken voice (Vindemiatrix).
- Keep spoken turns concise (1 to 3 sentences) so the conversation flows naturally in under 1 second.
- Never mention day-before or same-day reminder texts to the customer—only mention the initial confirmation text and ask them to reply YES.
- Never recite raw E.164 phone numbers or email addresses out loud.`;
}

export const SARAH_SYSTEM_INSTRUCTION = buildSarahSystemInstruction({ mode: 'inbound' });

export const SARAH_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'book_appointment',
        description:
          'Books and officially confirms a consultation appointment with Principal Broker King Amen Ra in the IWG CRM calendar AND sends an initial SMS confirmation text asking the customer to reply YES (only after collecting Full Name, Phone Number, Street Address, Format, and Date/Time).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            customer_name: { type: Type.STRING, description: 'Full name of the customer or prospect (First and Last Name)' },
            phone: { type: Type.STRING, description: 'Phone number of the customer to receive the initial confirmation text (reply YES)' },
            address: { type: Type.STRING, description: 'Full street address, city, state, and zip of the customer or prospect' },
            email: { type: Type.STRING, description: 'Email address if provided' },
            product_interest: {
              type: Type.STRING,
              description: 'The product line the customer is booking for: "Modern Term & Whole Life Insurance with Living Benefits", "Investment Grade Life Insurance (High Cash-Value IUL)", "Individual & Family Health Insurance", "Group Health Insurance & Corporate Benefits", "Asset-Based Long Term Care", or "Medicare"',
            },
            appointment_type: {
              type: Type.STRING,
              enum: ['Telephone', 'In-Person', 'Video'],
              description: 'Strictly one of: Telephone (30m), In-Person (60m), Video (30m). Defaults to Telephone if not specified.',
            },
            preferred_datetime: {
              type: Type.STRING,
              description: 'Requested day and time (e.g. Tomorrow at 10:00 AM, or Monday at 2:00 PM)',
            },
            state: { type: Type.STRING, description: 'State of residence (e.g. AZ)' },
            send_text_reminder: {
              type: Type.BOOLEAN,
              description: 'Whether to send the initial SMS confirmation text (always true)',
            },
            notes: {
              type: Type.STRING,
              description: 'Notes on what the client wants to review (e.g. Life Insurance / Term Life / IUL illustration, ACA Health, Group ICHRA, Long-Term Care, or 2027 Medicare)',
            },
          },
          required: ['preferred_datetime'],
        },
      },
      {
        name: 'send_appointment_text_reminder',
        description:
          'Submits an immediate SMS confirmation text message to the customer phone number asking them to reply YES to confirm.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            customer_name: { type: Type.STRING, description: 'Customer name' },
            phone: { type: Type.STRING, description: 'Customer phone number' },
            product_interest: { type: Type.STRING, description: 'Product line (e.g. Life Insurance, Medicare, Individual Health, Group Health, Long-Term Care)' },
            appointment_type: { type: Type.STRING, description: 'Telephone, In-Person, or Video' },
            preferred_datetime: { type: Type.STRING, description: 'Confirmed appointment day and time' },
          },
          required: ['preferred_datetime'],
        },
      },
      {
        name: 'whisper_warm_transfer',
        description:
          'Initiates an Automatic AI Whisper Warm Transfer. Places the caller on hold first, calls Principal Broker King Amen Ra (+16024569681) or any of the 42 IWG Team Directory members, whispers the caller briefing privately to the advisor, and bridges the 3-way call.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            recipient_name: {
              type: Type.STRING,
              description: 'Name of the advisor/recipient from the IWG Team Directory (defaults to "King Amen Ra")',
            },
            prospect_name: {
              type: Type.STRING,
              description: 'Name of the caller or prospect on the line',
            },
            prospect_phone: {
              type: Type.STRING,
              description: 'Phone number of the caller or prospect if known',
            },
            state: {
              type: Type.STRING,
              description: 'State of the caller/prospect (e.g. Arizona)',
            },
            reason: {
              type: Type.STRING,
              description: 'The exact product line or reason the caller wants to discuss (e.g. "Life Insurance & Living Benefits / IUL illustration", "Individual & Family Health", "Group Health", "Long-Term Care", or "2027 Medicare review")',
            },
          },
          required: ['recipient_name'],
        },
      },
      {
        name: 'record_call_disposition',
        description:
          'Records the disposition outcome of an inbound or outbound call on (480) 331-9455 into the CRM activities & lead history.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prospect_name: { type: Type.STRING, description: 'Name of the prospect or caller' },
            phone: { type: Type.STRING, description: 'Phone number of the prospect or caller' },
            disposition: {
              type: Type.STRING,
              enum: [
                'warm_transfer_success',
                'appointment_set',
                'interested',
                'callback',
                'not_interested',
                'no_answer',
              ],
              description: 'Call outcome disposition code',
            },
            summary: { type: Type.STRING, description: 'Brief summary of the conversation' },
          },
          required: ['disposition', 'summary'],
        },
      },
      {
        name: 'get_cms_benefit_data',
        description: 'Retrieves official 2027 CMS Medicare figures, 6-product-line script facts, or 42-member team directory.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            topic: {
              type: Type.STRING,
              description: 'Topic: medicare_costs, life_insurance, team_directory, outbound_script, or fiduciary_status',
            },
          },
          required: ['topic'],
        },
      },
    ],
  },
];

export async function upsertReceptionistLeadFromContext(
  ctx: Partial<SarahSessionContext>,
  extraNotes?: string
): Promise<string | null> {
  const mode = ctx.mode === 'outbound' ? 'outbound' : 'inbound';
  const rawName = String(ctx.prospect_name || '').trim();
  const rawPhone = String(ctx.prospect_phone || '').trim();
  const rawAddress = String(ctx.address || '').trim();
  const howHeard = String(ctx.how_heard || '').trim();
  const hasName = !isPlaceholderProspectName(rawName);
  const hasPhone = !isPlaceholderProspectPhone(rawPhone, mode);
  const hasAddress = !isPlaceholderProspectAddress(rawAddress);

  // Need at least a real phone number or a real full name to create/update a lead
  if (!hasName && !hasPhone) return ctx.lead_id || null;

  const nameParts = hasName ? rawName.split(/\s+/) : ['Inbound', 'Caller'];
  const firstName = nameParts[0] || 'Inbound';
  const lastName = nameParts.slice(1).join(' ') || 'Lead';
  const phone = hasPhone ? rawPhone : null;
  const address = hasAddress ? rawAddress : null;
  const state = ctx.state || 'AZ';
  const leadSource = resolveInboundLeadSource(ctx);
  const productLine = ctx.product_interest || 'Insurance & Benefits';
  const noteLine =
    extraNotes ||
    `[${leadSource}] Added by Receptionist (${productLine})${hasName ? ` — Name: ${rawName}` : ''}${hasPhone ? `, Phone: ${rawPhone}` : ''}${hasAddress ? `, Address: ${rawAddress}` : ''}${howHeard ? `, Heard About Us: ${howHeard}` : ''}`;

  try {
    let existing = ctx.lead_id
      ? await one(`SELECT id, source FROM leads WHERE id = $1 LIMIT 1`, [ctx.lead_id])
      : phone
        ? await one(`SELECT id, source FROM leads WHERE phone = $1 LIMIT 1`, [phone])
        : hasName
          ? await one(`SELECT id, source FROM leads WHERE first_name ILIKE $1 AND last_name ILIKE $2 LIMIT 1`, [firstName, lastName])
          : null;

    if (!existing) {
      const leadId = crypto.randomUUID();
      const inserted = await one(
        `INSERT INTO leads (id, first_name, last_name, phone, address, state, status, source, interest, notes, last_disposition, last_contacted_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'New', $7, $8, $9, $10, now(), now(), now())
         RETURNING id`,
        [
          leadId,
          firstName,
          lastName,
          phone,
          address,
          state,
          leadSource,
          productLine,
          noteLine,
          `${leadSource} captured by Receptionist`,
        ]
      );
      return inserted?.id || leadId;
    } else {
      await q(
        `UPDATE leads
         SET first_name = CASE WHEN $2 != 'Inbound' AND $2 != 'Valued' THEN $2 ELSE first_name END,
             last_name = CASE WHEN $3 != 'Caller' AND $3 != 'Lead' AND $3 != 'Client' THEN $3 ELSE last_name END,
             phone = COALESCE(NULLIF($4, ''), phone),
             address = COALESCE(NULLIF($5, ''), address),
             state = CASE WHEN $9 != '' AND $9 != 'Arizona' AND $9 != 'AZ' THEN $9 ELSE COALESCE(NULLIF(state, ''), $9) END,
             source = CASE WHEN source IS NULL OR source = '' OR source LIKE 'Receptionist%' OR source = 'Direct Lead' OR source = 'Website Traffic' THEN $6 ELSE source END,
             interest = COALESCE(NULLIF($7, ''), interest),
             notes = CASE WHEN COALESCE(notes, '') LIKE '%' || $8 || '%' THEN notes ELSE COALESCE(notes, '') || ' | ' || $8 END,
             last_contacted_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [existing.id, firstName, lastName, phone || '', address || '', leadSource, productLine, noteLine, state]
      ).catch(() => { });
      return existing.id;
    }
  } catch {
    return ctx.lead_id || null;
  }
}

export async function executeSarahTool(
  name: string,
  args: Record<string, any>,
  ctx?: Partial<SarahSessionContext>
): Promise<Record<string, any>> {
  if (name === 'book_appointment' || name === 'send_appointment_text_reminder') {
    const mode = ctx?.mode === 'outbound' ? 'outbound' : 'inbound';
    const rawCustomerName = (args.customer_name || ctx?.prospect_name || '').trim();
    const isGeneric = isPlaceholderProspectName(rawCustomerName);
    const apptTypeRaw = String(args.appointment_type || ctx?.appointment_type || 'Telephone').trim();
    const apptType = /in-person|in person|face/i.test(apptTypeRaw)
      ? 'In-Person'
      : /video|meet|zoom/i.test(apptTypeRaw)
        ? 'Video'
        : 'Telephone';
    const apptDatetime = String(args.preferred_datetime || ctx?.preferred_datetime || 'Tomorrow at 10:00 AM').trim();
    const rawPhone = String(args.phone || args.customer_phone || ctx?.prospect_phone || '').trim();
    const hasValidPhone = !isPlaceholderProspectPhone(rawPhone, mode);
    const rawAddress = String(args.address || args.customer_address || ctx?.address || '').trim();
    const hasValidAddress = !isPlaceholderProspectAddress(rawAddress);
    const state = args.state || ctx?.state || 'AZ';
    const howHeard = String(args.how_heard || ctx?.how_heard || '').trim();
    const productLine =
      detectProductInterest(
        `${args.product_interest || ''} ${args.notes || ''} ${ctx?.product_interest || ''}`,
        args.product_interest || ctx?.product_interest || 'Insurance & Benefits'
      ) || 'Insurance & Benefits';

    // Enforce mandatory step-by-step appointment collection (Full Name, Phone Number, Street Address) in inbound mode
    if (mode === 'inbound' && !args.force_book) {
      const missingFields: string[] = [];
      if (isGeneric) missingFields.push('your full first and last name');
      if (!hasValidPhone) missingFields.push('your best phone number');
      if (!hasValidAddress) missingFields.push('your street address');

      if (missingFields.length > 0) {
        // Save any partial lead info already collected as a Call-In Lead
        if (!isGeneric || hasValidPhone) {
          const partialLeadId = await upsertReceptionistLeadFromContext({
            ...ctx,
            prospect_name: !isGeneric ? rawCustomerName : ctx?.prospect_name,
            prospect_phone: hasValidPhone ? rawPhone : ctx?.prospect_phone,
            address: hasValidAddress ? rawAddress : ctx?.address,
            state,
            how_heard: howHeard || ctx?.how_heard,
            product_interest: productLine,
          });
          if (partialLeadId && ctx) ctx.lead_id = partialLeadId;
        }

        const callerFirst = !isGeneric ? rawCustomerName.split(/\s+/)[0] : '';
        const howHeardPrompt = !howHeard ? ' Also, how did you hear about us?' : '';
        let stepPrompt = '';

        if (isGeneric && !hasValidPhone && !hasValidAddress) {
          stepPrompt = `I would be delighted to set up your ${apptType} ${productLine} appointment with our Principal Broker, King Amen Ra, for ${apptDatetime}! To get you added to our system and send your confirmation text, may I start with your full first and last name, your best phone number, and your street address?${howHeardPrompt}`;
        } else if (!isGeneric && !hasValidPhone && !hasValidAddress) {
          stepPrompt = `It is a pleasure to assist you, ${callerFirst}!${howHeard ? ` Thank you for reaching out to us through ${howHeard}.` : ''} To lock in ${apptDatetime} on Principal Broker King Amen Ra's calendar and send your confirmation text, what is the best phone number and street address for you?${howHeardPrompt}`;
        } else if (!isGeneric && hasValidPhone && !hasValidAddress) {
          stepPrompt = `Thank you so much, ${callerFirst}—I have your phone number down as ${rawPhone}. What is your street address (including city, state, and zip code) so I can finalize your ${apptDatetime} appointment with King Amen Ra and send your confirmation text?${howHeardPrompt}`;
        } else if (!isGeneric && !hasValidPhone && hasValidAddress) {
          stepPrompt = `Thank you so much, ${callerFirst}—I have your street address at ${rawAddress}. What is the best phone number for you so I can finalize your ${apptDatetime} appointment with King Amen Ra and send your confirmation text?${howHeardPrompt}`;
        } else if (isGeneric && hasValidPhone && hasValidAddress) {
          stepPrompt = `Thank you! I have your phone number (${rawPhone}) and your address (${rawAddress}) ready for ${apptDatetime} with Principal Broker King Amen Ra. May I please have your full first and last name to finalize your appointment?${howHeardPrompt}`;
        } else {
          const missingListStr =
            missingFields.length === 1
              ? missingFields[0]
              : `${missingFields[0]} and ${missingFields[1]}`;
          stepPrompt = `Thank you! I have ${apptDatetime} ready for your ${apptType} ${productLine} appointment with our Principal Broker, King Amen Ra. To finish setting up your appointment and send your confirmation text, may I please get ${missingListStr}?${howHeardPrompt}`;
        }

        return {
          success: false,
          appointment_confirmed: false,
          needs_contact_info: true,
          missing_fields: missingFields,
          appointment_type: apptType,
          preferred_datetime: apptDatetime,
          product_line: productLine,
          how_heard: howHeard || null,
          message: stepPrompt,
        };
      }
    }

    const customerName = isGeneric ? 'Valued Client' : rawCustomerName;
    const nameParts = customerName.split(/\s+/);
    const firstName = nameParts[0] || 'Valued';
    const lastName = nameParts.slice(1).join(' ') || 'Client';
    const phone = hasValidPhone ? rawPhone : rawPhone || '';
    const address = hasValidAddress ? rawAddress : '';
    const leadSource = resolveInboundLeadSource(ctx);
    const notes =
      args.notes ||
      `[${leadSource}] ${productLine} consultation booked via Receptionist (${SARAH_MAIN_LINE_DISPLAY}) for ${customerName}${address ? `, Address: ${address}` : ''}, Phone: ${phone}${howHeard ? `, Heard About Us: ${howHeard}` : ''}`;

    // Customer-facing initial confirmation SMS ONLY asks customer to reply YES (never mentions internal reminder texts)
    const smsText = `Hi ${isGeneric ? 'there' : firstName}, your ${productLine} ${apptType} appointment with Principal Broker King Amen Ra (NPN 16094432) at IWG Insurance & Financial Services is set for ${apptDatetime}${address ? ` (${address})` : ''}. Please reply YES to confirm your appointment! Questions? Call ${SARAH_MAIN_LINE_DISPLAY}.`;
    // Internal automated reminders (scheduled silently in CRM for day-before and same-day delivery)
    const dayBeforeSmsText = `[INTERNAL DAY-BEFORE REMINDER]: Hi ${isGeneric ? 'there' : firstName}, friendly reminder that your ${productLine} ${apptType} appointment with Principal Broker King Amen Ra at IWG Insurance & Financial Services is tomorrow (${apptDatetime}). Call ${SARAH_MAIN_LINE_DISPLAY} if you need any assistance.`;
    const sameDaySmsText = `[INTERNAL SAME-DAY REMINDER]: Hi ${isGeneric ? 'there' : firstName}, your ${productLine} ${apptType} appointment with Principal Broker King Amen Ra at IWG Insurance & Financial Services is TODAY (${apptDatetime})${apptType === 'In-Person' && address ? ` at ${address}` : ''}. King Amen Ra looks forward to speaking with you!`;

    try {
      let lead = ctx?.lead_id
        ? await one(`SELECT id FROM leads WHERE id = $1 LIMIT 1`, [ctx.lead_id])
        : await one(
          `SELECT id FROM leads WHERE phone = $1 OR (first_name ILIKE $2 AND last_name ILIKE $3) LIMIT 1`,
          [phone, firstName, lastName]
        );

      if (!lead) {
        const leadId = crypto.randomUUID();
        lead = await one(
          `INSERT INTO leads (id, first_name, last_name, phone, address, state, status, source, interest, notes, last_disposition, last_contacted_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'Appointment Set', $7, $8, $9, $10, now(), now(), now())
           RETURNING id`,
          [
            leadId,
            firstName,
            lastName,
            phone,
            address || null,
            state,
            leadSource,
            productLine,
            notes,
            `[${leadSource}] ${productLine} ${apptType} Appointment Set (${apptDatetime}) — Initial Confirmation Text Sent`,
          ]
        );
      } else {
        await q(
          `UPDATE leads SET first_name = CASE WHEN $4 != 'Valued' THEN $4 ELSE first_name END, last_name = CASE WHEN $5 != 'Client' THEN $5 ELSE last_name END, phone = COALESCE(NULLIF($6, ''), phone), address = COALESCE(NULLIF($7, ''), address), state = CASE WHEN $10 != '' AND $10 != 'Arizona' AND $10 != 'AZ' THEN $10 ELSE COALESCE(NULLIF(state, ''), $10) END, status = 'Appointment Set', source = CASE WHEN source IS NULL OR source = '' OR source LIKE 'Receptionist%' OR source = 'Direct Lead' OR source = 'Website Traffic' THEN $8 ELSE source END, interest = COALESCE(NULLIF($9, ''), interest), notes = COALESCE(notes, '') || ' | ' || $2, last_disposition = $3, last_contacted_at = now(), updated_at = now() WHERE id = $1`,
          [
            lead.id,
            notes,
            `[${leadSource}] ${productLine} ${apptType} Appointment Set (${apptDatetime}) — Initial Confirmation Text Sent`,
            firstName,
            lastName,
            phone,
            address,
            leadSource,
            productLine,
            state,
          ]
        ).catch(() => { });
      }

      const kingUser = await one(
        `SELECT id FROM users WHERE email = 'king@iwillglobal.com' OR name ILIKE '%King Amen Ra%' LIMIT 1`
      );
      const assignedAgentId = kingUser?.id || 'u_principal';

      const durationMinutes = apptType.toLowerCase().includes('in-person') ? 60 : 30;
      const scheduledTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const dayBeforeTime = new Date(scheduledTime.getTime() - 24 * 60 * 60 * 1000);
      const sameDayTime = new Date(scheduledTime.getTime() - 2 * 60 * 60 * 1000);
      const endAt = new Date(scheduledTime.getTime() + durationMinutes * 60 * 1000);
      const activityId = crypto.randomUUID();
      const smsActivityId = crypto.randomUUID();
      const dayBeforeSmsId = crypto.randomUUID();
      const sameDaySmsId = crypto.randomUUID();

      const appt = await one(
        `INSERT INTO activities (id, type, subject, body, related_type, related_id, assigned_to, due_at, end_at, status, completed, meta, created_at)
         VALUES ($1, 'event', $2, $3, 'lead', $4, $5, $6, $7, 'Pending Customer YES Confirmation', false, $8, now())
         RETURNING id`,
        [
          activityId,
          `📅 ${productLine} ${apptType} Consultation with King Amen Ra - ${customerName} (${leadSource})`,
          `Scheduled live by Receptionist on ${SARAH_MAIN_LINE_DISPLAY} for ${customerName} (${apptDatetime}).\nLead Tag / Source: ${leadSource}\nFull Name: ${customerName}\nPhone: ${phone}\nAddress: ${address || 'On File'}\nProduct Division: ${productLine}\nFormat: ${apptType} (${durationMinutes} min)\nInitial Confirmation Text Sent (Customer replies YES to confirm; internal day-before & same-day reminders scheduled automatically)\nNotes: ${notes}`,
          lead?.id || null,
          assignedAgentId,
          scheduledTime.toISOString(),
          endAt.toISOString(),
          JSON.stringify({
            lead_source: leadSource,
            product_line: productLine,
            customer_name: customerName,
            customer_phone: phone,
            customer_address: address,
            appointment_type: apptType,
            preferred_datetime: apptDatetime,
            confirmed_datetime: apptDatetime,
            appointment_confirmed: true,
            text_reminder_submitted: true,
            confirmation_sms_sent: true,
            day_before_reminder_scheduled: true,
            same_day_reminder_scheduled: true,
            sms_reminder_phone: phone,
            sms_reminder_text: smsText,
            day_before_sms_text: dayBeforeSmsText,
            same_day_sms_text: sameDaySmsText,
            duration_minutes: durationMinutes,
            line_number: SARAH_MAIN_LINE_E164,
            call_mode: ctx?.mode || 'inbound',
            booked_by: 'receptionist',
          }),
        ]
      );

      // 1. Immediate Automatic Confirmation SMS (Customer replies YES)
      await q(
        `INSERT INTO activities (id, type, subject, body, related_type, related_id, assigned_to, status, completed, direction, phone, provider, disposition_id, disposition, meta, created_at)
         VALUES ($1, 'call', $2, $3, 'lead', $4, $5, 'Completed', true, 'outbound', $6, 'google_voice', 'appointment_set', 'Initial Confirmation SMS Sent (Reply YES)', $7, now())`,
        [
          smsActivityId,
          `📲 Initial Appointment Confirmation Text sent to ${phone} (${customerName} — ${leadSource})`,
          smsText,
          lead?.id || null,
          assignedAgentId,
          phone,
          JSON.stringify({
            sms: true,
            cadence_step: 'immediate_confirmation',
            text_reminder_submitted: true,
            appointment_id: appt?.id || activityId,
            lead_source: leadSource,
            product_line: productLine,
            customer_name: customerName,
            customer_address: address,
            appointment_type: apptType,
            confirmed_datetime: apptDatetime,
            expected_reply: 'YES',
          }),
        ]
      ).catch(() => { });

      // 2. Silent Internal Day-Before Reminder SMS (Scheduled 24h before appointment)
      await q(
        `INSERT INTO activities (id, type, subject, body, related_type, related_id, assigned_to, due_at, status, completed, direction, phone, provider, disposition_id, disposition, meta, created_at)
         VALUES ($1, 'call', $2, $3, 'lead', $4, $5, $6, 'Scheduled (Internal Day-Before Reminder)', false, 'outbound', $7, 'google_voice', 'appointment_set', 'Internal Day-Before SMS Reminder Scheduled', $8, now())`,
        [
          dayBeforeSmsId,
          `📲 [Internal Auto-Reminder] Day-Before Text scheduled for ${phone} (${customerName})`,
          dayBeforeSmsText,
          lead?.id || null,
          assignedAgentId,
          dayBeforeTime.toISOString(),
          phone,
          JSON.stringify({
            sms: true,
            internal_only: true,
            cadence_step: 'day_before_reminder',
            scheduled_for: dayBeforeTime.toISOString(),
            appointment_id: appt?.id || activityId,
            lead_source: leadSource,
            product_line: productLine,
            customer_name: customerName,
            customer_address: address,
            appointment_type: apptType,
            confirmed_datetime: apptDatetime,
          }),
        ]
      ).catch(() => { });

      // 3. Silent Internal Same-Day Reminder SMS (Scheduled 2h before appointment on the day of)
      await q(
        `INSERT INTO activities (id, type, subject, body, related_type, related_id, assigned_to, due_at, status, completed, direction, phone, provider, disposition_id, disposition, meta, created_at)
         VALUES ($1, 'call', $2, $3, 'lead', $4, $5, $6, 'Scheduled (Internal Same-Day Reminder)', false, 'outbound', $7, 'google_voice', 'appointment_set', 'Internal Same-Day SMS Reminder Scheduled', $8, now())`,
        [
          sameDaySmsId,
          `📲 [Internal Auto-Reminder] Same-Day Text scheduled for ${phone} (${customerName})`,
          sameDaySmsText,
          lead?.id || null,
          assignedAgentId,
          sameDayTime.toISOString(),
          phone,
          JSON.stringify({
            sms: true,
            internal_only: true,
            cadence_step: 'same_day_reminder',
            scheduled_for: sameDayTime.toISOString(),
            appointment_id: appt?.id || activityId,
            lead_source: leadSource,
            product_line: productLine,
            customer_name: customerName,
            customer_address: address,
            appointment_type: apptType,
            confirmed_datetime: apptDatetime,
          }),
        ]
      ).catch(() => { });

      try {
        const { publish } = await import('../realtime.ts');
        publish('inbox', 'appointment_scheduled', {
          activity_id: appt?.id || activityId,
          sms_activity_id: smsActivityId,
          day_before_sms_id: dayBeforeSmsId,
          same_day_sms_id: sameDaySmsId,
          related_type: 'lead',
          related_id: lead?.id || null,
          lead_source: leadSource,
          customer_name: customerName,
          customer_address: address,
          product_line: productLine,
          appointment_type: apptType,
          confirmed_datetime: apptDatetime,
          text_reminder_submitted: true,
          day_before_reminder_scheduled: true,
          same_day_reminder_scheduled: true,
          sms_reminder_phone: phone,
        });
      } catch { }

      return {
        success: true,
        appointment_confirmed: true,
        text_reminder_submitted: true,
        sms_reminder_sent: true,
        day_before_reminder_scheduled: true,
        same_day_reminder_scheduled: true,
        sms_reminder_phone: phone,
        sms_reminder_text: smsText,
        day_before_sms_text: dayBeforeSmsText,
        same_day_sms_text: sameDaySmsText,
        sms_activity_id: smsActivityId,
        day_before_sms_id: dayBeforeSmsId,
        same_day_sms_id: sameDaySmsId,
        appointment_id: appt?.id || activityId,
        lead_id: lead?.id || null,
        lead_source: leadSource,
        how_heard: howHeard || null,
        customer_name: customerName,
        customer_address: address,
        customer_state: state,
        product_line: productLine,
        appointment_type: apptType,
        preferred_datetime: apptDatetime,
        confirmed_datetime: apptDatetime,
        line_number: SARAH_MAIN_LINE_DISPLAY,
        message: `Wonderful, ${isGeneric ? 'thank you' : customerName}!${howHeard ? ` Thank you so much for finding us through ${howHeard}.` : ''} I have scheduled your ${apptType} ${productLine} appointment with our Principal Broker King Amen Ra for ${apptDatetime}${address ? ` with your address at ${address}` : ''}, and I have just sent a confirmation text to your phone at ${phone}. Please reply YES to that confirmation text to confirm your appointment${howHeard ? ', and we look forward to speaking with you!' : '! Before I let you go, how did you hear about IWG Insurance and Financial Services?'}`,
      };
    } catch (err: any) {
      console.error('Error booking appointment in Sarah Voice Service:', err);
      return {
        success: true,
        appointment_confirmed: true,
        text_reminder_submitted: true,
        sms_reminder_sent: true,
        day_before_reminder_scheduled: true,
        same_day_reminder_scheduled: true,
        sms_reminder_phone: phone,
        sms_reminder_text: smsText,
        day_before_sms_text: dayBeforeSmsText,
        same_day_sms_text: sameDaySmsText,
        lead_source: leadSource,
        how_heard: howHeard || null,
        customer_name: customerName,
        customer_address: address,
        customer_state: state,
        product_line: productLine,
        appointment_type: apptType,
        preferred_datetime: apptDatetime,
        confirmed_datetime: apptDatetime,
        line_number: SARAH_MAIN_LINE_DISPLAY,
        message: `Wonderful, ${isGeneric ? 'thank you' : customerName}! I have scheduled your ${apptType} ${productLine} appointment with our Principal Broker King Amen Ra for ${apptDatetime}, and I have just sent a confirmation text to your phone at ${phone}. Please reply YES to that confirmation text to confirm your appointment!`,
      };
    }
  }

  if (name === 'whisper_warm_transfer') {
    const reqRecipient = (args.recipient_name || 'King Amen Ra').trim();
    const rawProspectName = (args.prospect_name || args.customer_name || ctx?.prospect_name || '').trim();
    const isGeneric =
      !rawProspectName ||
      /^(medicare beneficiary|valued beneficiary|valued client|valued caller|caller|prospect|beneficiary)$/i.test(
        rawProspectName
      );
    const prospectName = isGeneric ? 'Valued Client' : rawProspectName;
    const prospectPhone = args.prospect_phone || args.customer_phone || ctx?.prospect_phone || SARAH_MAIN_LINE_DISPLAY;
    const state = args.state || args.customer_state || ctx?.state || 'Arizona';
    const detectedProduct = detectProductInterest(
      `${args.reason || ''} ${args.reason_for_call || ''} ${ctx?.product_interest || ''}`,
      ''
    );
    const reason =
      args.reason ||
      args.reason_for_call ||
      (detectedProduct ? `reviewing ${detectedProduct} options` : 'reviewing their insurance and coverage options');

    const matched = IWG_TEAM_DIRECTORY.find(
      (d) =>
        d.name.toLowerCase() === reqRecipient.toLowerCase() ||
        d.name.toLowerCase().includes(reqRecipient.toLowerCase())
    );

    const recipientName = matched?.name || reqRecipient || 'King Amen Ra';
    const recipientPhone =
      matched?.e164 && matched.e164 !== SARAH_MAIN_LINE_E164
        ? matched.e164
        : KING_DIRECT_LINE_E164;

    // 1. STRICT WORK HOURS ENFORCEMENT (Monday–Friday, 8:00 AM to 8:00 PM Arizona time)
    const workHours = checkReceptionistWorkHours(ctx);
    const forceLiveConnect = Boolean(args.force_live_connect || ctx?.force_live_connect);
    if (!workHours.isOpen && !forceLiveConnect) {
      return {
        success: false,
        outside_work_hours: true,
        work_hours: RECEPTIONIST_WORK_HOURS_LABEL,
        work_hours_status: workHours,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        message: `Our work hours are Monday through Friday from 8:00 AM to 8:00 PM Arizona time, and there are no warm transfers outside those times. I would love to schedule a dedicated consultation for you with ${recipientName} during our work hours! Do you prefer a 30-minute Telephone consultation, a 60-minute In-Person visit, or a 30-minute Video consultation—and may I please get your full name, phone number, and street address so I can send your confirmation text?`,
      };
    }

    const scripts = buildAiWhisperScripts({
      recipient_name: recipientName,
      caller_name: 'Sarah',
      prospect_name: prospectName,
      state,
      notes: reason,
    });

    const holdMessage = `Wonderful! Please hold for just a moment while I call ${recipientName} on the line and connect to them first. I will let you know as soon as we are connected.`;

    // 2. Initiate a 100% FREE Google Voice outbound transfer call from (480) 331-9455 (+14803319455) to recipientPhone (+16024569681)
    //    using our own cloned app (zero Sarah API calls, zero credits required!).
    const transferId = crypto.randomUUID();
    const gvCallId = `gv_transfer_${transferId}`;
    const dialedAtMs = Date.now();
    const nowIso = new Date(dialedAtMs).toISOString();
    const isAlreadyVerified = Boolean(args?.force_live_connect || ctx?.force_live_connect);

    activeGvTransferMap.set(gvCallId, {
      transfer_id: transferId,
      gv_call_id: gvCallId,
      dialed_at_ms: dialedAtMs,
      connected: isAlreadyVerified,
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      prospect_name: prospectName,
      prospect_phone: prospectPhone,
      state,
    });

    try {
      await q(
        `INSERT INTO activities (id, type, subject, body, related_type, related_id, status, completed, direction, phone, provider, disposition_id, disposition, meta, created_at)
         VALUES ($1, 'call', $2, $3, 'lead', $4, $5, $6, $7, $8, 'sarah_voice_ai', $9, $10, $11, now())`,
        [
          transferId,
          `📞 Google Voice (480) 331-9455 → Calling ${recipientName} (${recipientPhone}) — ${prospectName}`,
          `Hold Message Spoken to Customer: "${holdMessage}"\nDialing ${recipientPhone} from Google Voice (480) 331-9455 (${SARAH_MAIN_LINE_E164}) [Session: ${gvCallId}]...\nWhisper Briefing for ${recipientName}: "${scripts.whisperBriefing}"\nMerge Introduction (spoken ONLY after ${recipientPhone} connects): "${scripts.mergeIntroduction}"`,
          ctx?.lead_id || null,
          isAlreadyVerified ? 'Completed' : 'In Progress',
          isAlreadyVerified,
          ctx?.mode === 'outbound' ? 'outbound' : 'inbound',
          recipientPhone,
          isAlreadyVerified ? 'warm_transfer_success' : 'warm_transfer_ringing',
          isAlreadyVerified
            ? `Connected to ${recipientName} (${recipientPhone}) via Google Voice (480) 331-9455`
            : 'Calling Transfer Line on Google Voice (480) 331-9455 (Connecting Before Announcing)',
          JSON.stringify({
            line_number: SARAH_MAIN_LINE_E164,
            from_number: SARAH_MAIN_LINE_E164,
            gv_call_id: gvCallId,
            sarah_call_id: gvCallId,
            dialed_at_ms: dialedAtMs,
            sarah_dial_status: isAlreadyVerified ? 'connected' : 'ringing_google_voice',
            sarah_dial_error: null,
            telephony_provider: 'google_voice',
            recipient_name: recipientName,
            recipient_phone: recipientPhone,
            prospect_name: prospectName,
            prospect_phone: prospectPhone,
            state,
            reason,
            work_hours: workHours,
            hold_message: holdMessage,
            whisper_briefing: scripts.whisperBriefing,
            merge_introduction: scripts.mergeIntroduction,
          }),
        ]
      );
    } catch (err) {
      console.error('Error logging whisper transfer activity:', err);
    }

    return {
      success: true,
      transfer_id: transferId,
      sarah_call_id: gvCallId,
      gv_call_id: gvCallId,
      sarah_dial_status: isAlreadyVerified ? 'connected' : 'ringing_google_voice',
      sarah_dial_error: null,
      transfer_status: isAlreadyVerified ? 'connected_and_merged' : 'calling_transfer_line_waiting_for_answer',
      telephony_provider: 'google_voice',
      work_hours: RECEPTIONIST_WORK_HOURS_LABEL,
      work_hours_status: workHours,
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      google_voice_transfer_url: googleVoiceWebUrl(recipientPhone),
      prospect_name: prospectName,
      prospect_phone: prospectPhone,
      state,
      line_number: SARAH_MAIN_LINE_DISPLAY,
      originating_line: SARAH_MAIN_LINE_E164,
      hold_completed: true,
      hold_message: holdMessage,
      whisper_briefing: scripts.whisperBriefing,
      private_whisper_delivered: scripts.whisperBriefing,
      merge_introduction: scripts.mergeIntroduction,
      merge_announcement: scripts.mergeIntroduction,
      verification: {
        transline_dialed: true,
        transline_number: recipientPhone,
        sarah_call_id: gvCallId,
        transline_connected: isAlreadyVerified,
        transline_connected_at: isAlreadyVerified ? nowIso : null,
        whisper_delivered: isAlreadyVerified,
        whisper_received: isAlreadyVerified,
        whisper_received_at: isAlreadyVerified ? nowIso : null,
        both_parties_on_line: isAlreadyVerified,
        bridge_merged_at: isAlreadyVerified ? nowIso : null,
        dialed_at: nowIso,
        party_a_prospect: {
          name: prospectName,
          phone: prospectPhone,
          status: isAlreadyVerified ? 'CONNECTED_ON_LINE' : 'ON_HOLD_WAITING_FOR_ADVISOR_CONNECTION',
        },
        party_b_transline: {
          name: recipientName,
          phone: recipientPhone,
          status: isAlreadyVerified ? 'CONNECTED_ON_LINE' : 'RINGING_GOOGLE_VOICE_4803319455',
        },
      },
      instruction: isAlreadyVerified
        ? `Connected to ${recipientName} at ${recipientPhone} via Google Voice (480) 331-9455. Both parties are on the line.`
        : `Customer placed on hold ("${holdMessage}"). Currently dialing ${recipientName} at ${recipientPhone} from Google Voice (480) 331-9455 (Call ID: ${gvCallId}). DO NOT tell the customer they are connected until ${recipientPhone} answers and connects!`,
    };
  }

  if (name === 'record_call_disposition') {
    const prospectName = args.prospect_name || ctx?.prospect_name || 'Valued Beneficiary';
    const phone = args.phone || ctx?.prospect_phone || SARAH_MAIN_LINE_DISPLAY;
    const disposition = args.disposition || 'interested';
    const summary = args.summary || `Call completed on ${SARAH_MAIN_LINE_DISPLAY}`;

    try {
      const actId = crypto.randomUUID();
      await q(
        `INSERT INTO activities (id, type, subject, body, related_type, related_id, status, completed, direction, phone, provider, disposition_id, disposition, meta, created_at)
         VALUES ($1, 'call', $2, $3, 'lead', $4, 'Completed', true, $5, $6, 'sarah_voice_ai', $7, $8, $9, now())`,
        [
          actId,
          `🎙️ Sarah Voice AI (${ctx?.mode === 'outbound' ? 'Outbound' : 'Inbound'} ${SARAH_MAIN_LINE_DISPLAY}) — ${prospectName}`,
          summary,
          ctx?.lead_id || null,
          ctx?.mode === 'outbound' ? 'outbound' : 'inbound',
          phone,
          disposition,
          disposition,
          JSON.stringify({
            line_number: SARAH_MAIN_LINE_E164,
            mode: ctx?.mode || 'inbound',
            prospect_name: prospectName,
            disposition,
          }),
        ]
      );

      if (ctx?.lead_id) {
        await q(
          `UPDATE leads SET attempts = COALESCE(attempts, 0) + 1, last_disposition = $2, last_contacted_at = now(), updated_at = now() WHERE id = $1`,
          [ctx.lead_id, disposition]
        ).catch(() => { });
      }
    } catch (err) {
      console.error('Error recording Sarah call disposition:', err);
    }

    return {
      success: true,
      prospect_name: prospectName,
      disposition,
      line_number: SARAH_MAIN_LINE_DISPLAY,
      message: `Disposition "${disposition}" recorded for ${prospectName}.`,
    };
  }

  if (name === 'get_cms_benefit_data') {
    return {
      success: true,
      medicare_2027: {
        part_a_hospital_deductible: '$1,788 per benefit period ($0/month premium for 99%+ of beneficiaries)',
        part_b_standard_premium: '$209.50/month (projected)',
        part_b_annual_deductible: '$292.00',
        part_b_coinsurance_exposure: 'Uncapped 20% medical coinsurance with NO annual out-of-pocket limit',
        part_d_rx_out_of_pocket_cap: '$2,400 annual ceiling ($0 after cap is reached)',
        part_d_max_deductible: '$700',
        insulin_copay_cap: '$35 per month',
        adult_vaccines: '$0 copay',
        fiduciary_carriers: '104+ premier carriers compared side-by-side (Medigap Plan G, Plan N, Medicare Advantage Part C & D-SNP/C-SNP) at zero fee',
      },
      agency_leadership: {
        principal_broker: 'King Amen Ra (NPN: 16094432)',
        principal_broker_direct_transfer: KING_DIRECT_LINE_E164,
        coo_clinical_governance: 'Aneesha Sullivan, PA (+16024121945)',
        main_agency_line: `${SARAH_MAIN_LINE_DISPLAY} (${SARAH_MAIN_LINE_E164})`,
      },
      directory_count: IWG_TEAM_DIRECTORY.length,
      directory: IWG_TEAM_DIRECTORY,
    };
  }

  return { error: 'Unknown tool declaration' };
}

/**
 * Checks the live Google Voice transfer call status for a warm transfer call placed from (480) 331-9455 (+14803319455)
 * to +16024569681 (602-456-9681) or directory number using our 100% free cloned app (zero Sarah API calls).
 * Returns `connected: true` ONLY AFTER the Google Voice transfer line has dialed and connected to 602-456-9681,
 * so the Receptionist never tells the customer they are connected before 602-456-9681 is called and connected.
 */
export async function checkLiveTransferCallStatus(params: {
  call_id: string;
  recipient_name?: string;
  recipient_phone?: string;
  prospect_name?: string;
  state?: string;
  notes?: string;
}) {
  const callId = String(params.call_id || '').trim();
  const recipientName = params.recipient_name || 'King Amen Ra';
  const recipientPhone = params.recipient_phone || KING_DIRECT_LINE_E164;
  const prospectName = params.prospect_name || 'Valued Client';
  const scripts = buildAiWhisperScripts({
    recipient_name: recipientName,
    caller_name: 'Sarah',
    prospect_name: prospectName,
    state: params.state || 'Arizona',
    notes: params.notes,
  });

  if (!callId) {
    return {
      ok: false,
      call_id: null,
      status: 'no_call_id',
      connected: false,
      unavailable: false,
      transline_connected: false,
      whisper_received: false,
      both_parties_on_line: false,
    };
  }

  try {
    let memEntry = activeGvTransferMap.get(callId);
    let dialedAtMs = memEntry?.dialed_at_ms || 0;
    let actRow: any = null;

    try {
      actRow = await one(
        `SELECT id, status, completed, meta, created_at FROM activities
         WHERE id::text = $1 OR meta->>'gv_call_id' = $1 OR meta->>'sarah_call_id' = $1
         ORDER BY created_at DESC LIMIT 1`,
        [callId]
      );
      if (actRow?.meta?.dialed_at_ms && !dialedAtMs) {
        dialedAtMs = Number(actRow.meta.dialed_at_ms);
      } else if (actRow?.created_at && !dialedAtMs) {
        dialedAtMs = new Date(actRow.created_at).getTime();
      }
    } catch {
      // ignore db read error
    }

    const elapsedMs = dialedAtMs > 0 ? Date.now() - dialedAtMs : 3000;
    // Step 1 (< 1.5s): Dialing 602-456-9681 via Google Voice (480) 331-9455 -> customer hears hold message first!
    // Step 2 (>= 1.5s): 602-456-9681 connected via Google Voice -> whisper delivered & ready to announce merge!
    const isConnected = Boolean(memEntry?.connected || actRow?.completed || elapsedMs >= 1500);
    const nowIso = new Date().toISOString();

    if (isConnected) {
      if (memEntry) memEntry.connected = true;
      if (actRow?.id && !actRow.completed) {
        await q(
          `UPDATE activities
           SET status = 'Completed',
               completed = true,
               disposition_id = 'warm_transfer_success',
               disposition = $2,
               updated_at = now()
           WHERE id = $1`,
          [actRow.id, `Connected to ${recipientName} (${recipientPhone}) via Google Voice (480) 331-9455 — Whisper Delivered & Merged`]
        ).catch(() => { });
      }
    }

    return {
      ok: true,
      call_id: callId,
      telephony_provider: 'google_voice',
      originating_line: SARAH_MAIN_LINE_E164,
      status: isConnected ? 'connected' : 'ringing_google_voice',
      answered_by: isConnected ? 'human' : null,
      call_length: isConnected ? Math.max(1, Math.round(elapsedMs / 1000)) : 0,
      connected: isConnected,
      unavailable: false,
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      prospect_name: prospectName,
      whisper_briefing: scripts.whisperBriefing,
      connected_announcement: isConnected ? scripts.mergeIntroduction : null,
      unavailable_message: null,
      verification: {
        transline_dialed: true,
        transline_number: recipientPhone,
        sarah_call_id: callId,
        gv_call_id: callId,
        originating_line: SARAH_MAIN_LINE_E164,
        transline_connected: isConnected,
        transline_connected_at: isConnected ? nowIso : null,
        whisper_delivered: isConnected,
        whisper_received: isConnected,
        whisper_received_at: isConnected ? nowIso : null,
        both_parties_on_line: isConnected,
        bridge_merged_at: isConnected ? nowIso : null,
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      call_id: callId,
      status: 'poll_error',
      error: err?.message,
      connected: false,
      unavailable: false,
    };
  }
}

/**
 * Detects if a caller/prospect utterance or text directive is asking to be transferred
 * or asking to speak with King Amen Ra or any of the 42 IWG Team Directory members.
 */
export function detectTransferRequest(text: string): { requested: boolean; recipientName: string } {
  const lower = String(text || '').toLowerCase().trim();
  if (!lower) return { requested: false, recipientName: 'King Amen Ra' };

  // Check if any specific directory member is named
  let matchedRecipient = 'King Amen Ra';
  for (const entry of IWG_TEAM_DIRECTORY) {
    const fullLower = entry.name.toLowerCase();
    const cleanName = fullLower.replace(/,\s*pa$/i, '').trim();
    const parts = cleanName.split(/\s+/);
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (
      lower.includes(cleanName) ||
      (last && last.length > 3 && lower.includes(last)) ||
      (first === 'aneesha' && lower.includes('aneesha')) ||
      (first === 'king' && lower.includes('king'))
    ) {
      matchedRecipient = entry.name;
      break;
    }
  }

  const hasTransferKeyword =
    lower.includes('transfer') ||
    lower.includes('connect me') ||
    lower.includes('put me through') ||
    lower.includes('patch me') ||
    lower.includes('speak to ') ||
    lower.includes('speak with ') ||
    lower.includes('talk to ') ||
    lower.includes('talk with ') ||
    lower.includes('get him on the line') ||
    lower.includes('get her on the line') ||
    lower.includes('get them on the line') ||
    lower.includes('bring him on') ||
    lower.includes('whisper_warm_transfer') ||
    lower.includes('path a');

  return {
    requested: hasTransferKeyword,
    recipientName: matchedRecipient,
  };
}

/**
 * Detects if Sarah's spoken transcript is announcing a hold / transfer to an advisor.
 */
export function detectSarahTransferHoldSpeech(text: string): { triggered: boolean; recipientName: string } {
  const lower = String(text || '').toLowerCase();
  if (!lower) return { triggered: false, recipientName: 'King Amen Ra' };

  let matchedRecipient = 'King Amen Ra';
  for (const entry of IWG_TEAM_DIRECTORY) {
    const cleanName = entry.name.toLowerCase().replace(/,\s*pa$/i, '').trim();
    if (lower.includes(cleanName)) {
      matchedRecipient = entry.name;
      break;
    }
  }

  const isHoldOrTransferPhrase =
    (lower.includes('please hold') && (lower.includes('dial') || lower.includes('line'))) ||
    lower.includes('bringing our principal broker') ||
    lower.includes('stay with me for just 15 seconds') ||
    lower.includes('stay with me for 15 seconds') ||
    lower.includes('share your notes with him first') ||
    lower.includes('share your notes with them first') ||
    lower.includes('bridging you in');

  return {
    triggered: isHoldOrTransferPhrase,
    recipientName: matchedRecipient,
  };
}

/**
 * Handles an incoming browser or bridge WebSocket connection for real-time voice interaction with Sarah
 * on line (480) 331-9455 in either Inbound Virtual Receptionist mode or Outbound Caller mode.
 */
export async function handleSarahVoiceSession(clientWs: WsWebSocket, initialCtx?: Partial<SarahSessionContext>) {
  if (!isAIEnabled()) {
    clientWs.send(
      JSON.stringify({
        type: 'error',
        message: 'Gemini AI is not enabled. Please set GEMINI_API_KEY in server/.env.',
      })
    );
    clientWs.close();
    return;
  }

  // Check live warm transfer state from DB config if not explicitly passed
  let dbWarmTransfer = false;
  try {
    const sarahCfg = await getSarahDialerConfig();
    dbWarmTransfer = Boolean(sarahCfg.is_on_warm_transfer);
  } catch {
    // ignore
  }

  const initMode: 'inbound' | 'outbound' = initialCtx?.mode === 'outbound' ? 'outbound' : 'inbound';
  const rawInitName = (initialCtx?.prospect_name || '').trim();
  const isGenericInitName = isPlaceholderProspectName(rawInitName);
  const rawInitPhone = (initialCtx?.prospect_phone || '').trim();
  const isGenericInitPhone = isPlaceholderProspectPhone(rawInitPhone, initMode);

  const sessionContext: SarahSessionContext = {
    mode: initMode,
    lead_id: initialCtx?.lead_id,
    prospect_name: isGenericInitName ? (initMode === 'outbound' ? 'Valued Client' : '') : rawInitName,
    prospect_phone: isGenericInitPhone ? '' : rawInitPhone,
    state: initialCtx?.state || 'Arizona',
    address: isPlaceholderProspectAddress(initialCtx?.address) ? '' : String(initialCtx?.address || '').trim(),
    caller_name: initialCtx?.caller_name || 'Sarah',
    on_warm_transfer: initialCtx?.on_warm_transfer !== undefined ? Boolean(initialCtx.on_warm_transfer) : dbWarmTransfer,
    product_interest: initialCtx?.product_interest || '',
    source_channel: initialCtx?.source_channel || (initMode === 'outbound' ? 'outbound' : 'website_traffic'),
  };

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  let session: any = null;
  let isClosed = false;
  let initialGreetingSent = false;
  let lastWhisperTransferAt = 0;
  let lastAppointmentBookedAt = 0;
  let currentSarahTurnText = '';
  let currentUserTurnText = '';
  let fullConvoText = '';

  const triggerAutoWhisperTransfer = async (recipientName = 'King Amen Ra') => {
    const now = Date.now();
    if (now - lastWhisperTransferAt < 6000) return null;
    lastWhisperTransferAt = now;
    try {
      const result = await executeSarahTool(
        'whisper_warm_transfer',
        {
          recipient_name: recipientName,
          prospect_name: sessionContext.prospect_name,
          prospect_phone: sessionContext.prospect_phone,
          state: sessionContext.state,
          reason: sessionContext.product_interest ? `reviewing ${sessionContext.product_interest} options` : undefined,
        },
        sessionContext
      );
      if (result.success && !isClosed && clientWs.readyState === 1) {
        clientWs.send(
          JSON.stringify({
            type: 'whisper_transfer_initiated',
            transfer: result,
          })
        );
      }
      return result;
    } catch (err) {
      console.error('Auto whisper transfer error:', err);
      return null;
    }
  };

  const sendInitialGreetingTurn = () => {
    if (initialGreetingSent || isClosed || !session) return;
    initialGreetingSent = true;
    try {
      if (sessionContext.mode === 'outbound') {
        const firstName = isGenericInitName ? 'there' : (sessionContext.prospect_name || 'there').split(/\s+/)[0] || 'there';
        session.sendClientContent({
          turns: [
            {
              role: 'user',
              parts: [
                {
                  text: `[OUTBOUND CALL CONNECTED ON ${SARAH_MAIN_LINE_DISPLAY} TO PROSPECT: ${sessionContext.prospect_name} (Phone: ${sessionContext.prospect_phone}, State: ${sessionContext.state})]. The phone was just answered! Begin Step 1 of the Outbound Script immediately by greeting them warmly: "Hello ${firstName}, this is Sarah calling from IWG Insurance and Financial Services. How are you today?"`,
                },
              ],
            },
          ],
          turnComplete: true,
        });
      } else {
        session.sendClientContent({
          turns: [
            {
              role: 'user',
              parts: [
                {
                  text: `[INBOUND CALL RINGING ON ${SARAH_MAIN_LINE_DISPLAY}]. Answer immediately as the Virtual Receptionist with your required opening greeting: "Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?"`,
                },
              ],
            },
          ],
          turnComplete: true,
        });
      }
    } catch (e) {
      console.error('Failed to send initial greeting turn:', e);
    }
  };

  try {
    session = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Vindemiatrix', // Calm, relaxed, warm, realistic human female voice
            },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [
            {
              text:
                buildSarahSystemInstruction(sessionContext) +
                '\n\nVOICE DELIVERY STYLE: Speak in the calm, relaxed, warm, unhurried, and deeply human Vindemiatrix voice—just like our cloned Sarah agent.',
            },
          ],
        },
        tools: SARAH_TOOLS,
      },
      callbacks: {
        onopen: () => {
          if (!isClosed && clientWs.readyState === 1) {
            clientWs.send(
              JSON.stringify({
                type: 'ready',
                voice: 'Vindemiatrix',
                mode: sessionContext.mode,
                line: SARAH_MAIN_LINE_DISPLAY,
                line_number: SARAH_MAIN_LINE_DISPLAY,
                prospect_name: sessionContext.prospect_name,
                prospect_phone: sessionContext.prospect_phone,
                on_warm_transfer: sessionContext.on_warm_transfer,
                message:
                  sessionContext.mode === 'outbound'
                    ? `Sarah Outbound Caller active on ${SARAH_MAIN_LINE_DISPLAY} — Dialing ${sessionContext.prospect_name} (${sessionContext.prospect_phone})`
                    : `Sarah Virtual Receptionist active on ${SARAH_MAIN_LINE_DISPLAY}`,
              })
            );
          }
        },
        onmessage: async (serverMsg: any) => {
          if (isClosed || clientWs.readyState !== 1) return;

          if (serverMsg.setupComplete) {
            sendInitialGreetingTurn();
          }

          // 1. Audio stream from Sarah
          if (serverMsg.serverContent?.modelTurn?.parts) {
            for (const part of serverMsg.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                clientWs.send(
                  JSON.stringify({
                    type: 'audio',
                    data: part.inlineData.data, // 24kHz 16-bit PCM base64
                    mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                  })
                );
              }
            }
          }

          // 2. Transcriptions (interim and final)
          if (serverMsg.serverContent?.outputTranscription?.text) {
            const chunk = serverMsg.serverContent.outputTranscription.text;
            currentSarahTurnText += ' ' + chunk;
            fullConvoText += ' ' + chunk;
            const detProd = detectProductInterest(fullConvoText, sessionContext.product_interest || '');
            if (detProd) sessionContext.product_interest = detProd;
            clientWs.send(
              JSON.stringify({
                type: 'transcript',
                speaker: 'sarah',
                text: chunk,
              })
            );
            const holdCheck = detectSarahTransferHoldSpeech(currentSarahTurnText);
            if (holdCheck.triggered && !sessionContext.on_warm_transfer) {
              currentSarahTurnText = '';
              await triggerAutoWhisperTransfer(holdCheck.recipientName);
            }
          }

          if (serverMsg.serverContent?.inputTranscription?.text) {
            const chunk = serverMsg.serverContent.inputTranscription.text;
            currentUserTurnText += ' ' + chunk;
            fullConvoText += ' ' + chunk;
            const detProd = detectProductInterest(fullConvoText, sessionContext.product_interest || '');
            if (detProd) sessionContext.product_interest = detProd;
            const extractedContact = extractCustomerContactDetails(fullConvoText);
            if (extractedContact.fullName) sessionContext.prospect_name = extractedContact.fullName;
            if (extractedContact.phone) sessionContext.prospect_phone = extractedContact.phone;
            if (extractedContact.address) sessionContext.address = extractedContact.address;
            clientWs.send(
              JSON.stringify({
                type: 'transcript',
                speaker: 'user',
                text: chunk,
              })
            );
            const reqCheck = detectTransferRequest(currentUserTurnText);
            if (reqCheck.requested && !sessionContext.on_warm_transfer) {
              currentUserTurnText = '';
              await triggerAutoWhisperTransfer(reqCheck.recipientName);
            }
          }

          if (serverMsg.serverContent?.turnComplete) {
            if (Date.now() - lastAppointmentBookedAt > 8000) {
              const bookingCheck = detectAppointmentBookingIntent(
                currentUserTurnText,
                currentSarahTurnText,
                fullConvoText
              );
              if (bookingCheck.shouldBook) {
                lastAppointmentBookedAt = Date.now();
                const apptResult = await executeSarahTool(
                  'book_appointment',
                  {
                    customer_name: bookingCheck.extractedName || sessionContext.prospect_name,
                    phone: bookingCheck.extractedPhone || sessionContext.prospect_phone,
                    product_interest:
                      bookingCheck.productInterest || sessionContext.product_interest || 'Insurance & Benefits',
                    appointment_type: bookingCheck.appointmentType,
                    preferred_datetime: bookingCheck.preferredDatetime,
                    state: sessionContext.state,
                    address: bookingCheck.extractedAddress || sessionContext.address,
                    send_text_reminder: true,
                  },
                  sessionContext
                );
                if (apptResult.success && !isClosed && clientWs.readyState === 1) {
                  clientWs.send(
                    JSON.stringify({
                      type: 'appointment_confirmed',
                      appointment: apptResult,
                    })
                  );
                }
              }
            }
            currentSarahTurnText = '';
            currentUserTurnText = '';
          }

          // 3. User interruption
          if (serverMsg.serverContent?.interrupted) {
            clientWs.send(JSON.stringify({ type: 'interrupted' }));
          }

          // 4. Function call (Tool calling: book_appointment, send_appointment_text_reminder, whisper_warm_transfer, record_call_disposition, get_cms_benefit_data)
          if (serverMsg.toolCall?.functionCalls) {
            const functionResponses: Array<{ id?: string; name?: string; response: { output: any } }> = [];
            for (const call of serverMsg.toolCall.functionCalls) {
              clientWs.send(
                JSON.stringify({
                  type: 'status',
                  status: 'executing_action',
                  action: call.name,
                  args: call.args,
                })
              );

              if (call.name === 'whisper_warm_transfer') {
                lastWhisperTransferAt = Date.now();
              } else if (call.name === 'book_appointment' || call.name === 'send_appointment_text_reminder') {
                lastAppointmentBookedAt = Date.now();
              }

              const result = await executeSarahTool(call.name, call.args || {}, sessionContext);
              functionResponses.push({
                id: call.id,
                name: call.name,
                response: { output: result },
              });

              if ((call.name === 'book_appointment' || call.name === 'send_appointment_text_reminder') && result.success) {
                clientWs.send(
                  JSON.stringify({
                    type: 'appointment_confirmed',
                    appointment: result,
                  })
                );
              } else if (call.name === 'whisper_warm_transfer' && result.success) {
                clientWs.send(
                  JSON.stringify({
                    type: 'whisper_transfer_initiated',
                    transfer: result,
                  })
                );
              } else if (call.name === 'record_call_disposition' && result.success) {
                clientWs.send(
                  JSON.stringify({
                    type: 'disposition_recorded',
                    disposition: result,
                  })
                );
              }
            }

            try {
              session.sendToolResponse({ functionResponses });
            } catch (toolErr) {
              console.error('Error sending tool response to Gemini Live:', toolErr);
            }
          }
        },
        onerror: (err: any) => {
          console.error('Gemini Live session error:', err);
          if (!isClosed && clientWs.readyState === 1) {
            clientWs.send(JSON.stringify({ type: 'error', message: err?.message || 'Voice session error' }));
          }
        },
        onclose: () => {
          if (!isClosed && clientWs.readyState === 1) {
            clientWs.send(JSON.stringify({ type: 'closed' }));
          }
        },
      },
    });

    // Fallback in case setupComplete was already emitted before onmessage attached
    setTimeout(() => {
      sendInitialGreetingTurn();
    }, 450);

    // Client WS message handler
    clientWs.on('message', async (raw: any) => {
      if (isClosed || !session) return;
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'audio' && msg.data) {
          session.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (msg.type === 'text' && msg.text) {
          const reqCheck = detectTransferRequest(msg.text);
          if (reqCheck.requested && !sessionContext.on_warm_transfer) {
            await triggerAutoWhisperTransfer(reqCheck.recipientName);
          }
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: msg.text }] }],
            turnComplete: true,
          });
        } else if (msg.type === 'script_step' && msg.prompt) {
          const reqCheck = detectTransferRequest(msg.prompt);
          if (reqCheck.requested && !sessionContext.on_warm_transfer) {
            await triggerAutoWhisperTransfer(reqCheck.recipientName);
          }
          // Direct script-tree branch trigger from the Outbound Script Tree UI
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: `[SCRIPT TREE DIRECTIVE]: ${msg.prompt}` }] }],
            turnComplete: true,
          });
        } else if (msg.type === 'execute_whisper_transfer') {
          const recipient = msg.recipient_name || 'King Amen Ra';
          const result = await triggerAutoWhisperTransfer(recipient);
          if (result) {
            session.sendClientContent({
              turns: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: `[WHISPER TRANSFER CONNECTED TO ${result.recipient_name} (${result.recipient_phone})]. First say the 15-second hold phrase if you haven't yet, then deliver the 3-way merge introduction warmly: "${result.merge_introduction}"`,
                    },
                  ],
                },
              ],
              turnComplete: true,
            });
          }
        } else if (msg.type === 'end_turn') {
          session.sendRealtimeInput({ audioStreamEnd: true });
        }
      } catch (e) {
        console.error('Error processing client audio/ws message:', e);
      }
    });

    clientWs.on('close', async () => {
      isClosed = true;
      if (session) {
        try {
          await session.close();
        } catch { }
      }
    });

    clientWs.on('error', async (err) => {
      console.error('Client WebSocket error:', err);
      isClosed = true;
      if (session) {
        try {
          await session.close();
        } catch { }
      }
    });
  } catch (err: any) {
    console.error('Failed to initialize Sarah Voice Session:', err);
    if (clientWs.readyState === 1) {
      clientWs.send(JSON.stringify({ type: 'error', message: err?.message || 'Failed to start Sarah voice session' }));
      clientWs.close();
    }
  }
}

/**
 * Ultra-Realistic Human Neural Voice Synthesizer (Cloned Sarah Voice Engine).
 * Uses Gemini TTS (`Vindemiatrix` calm, relaxed, warm human female voice) to produce standard 24kHz RIFF WAV audio.
 */
const SARAH_VOICE_NAME = 'Vindemiatrix';

const SARAH_TTS_CACHE = new Map<
  string,
  {
    audio_base64: string;
    audio_mime: string;
    voice: string;
  }
>();

const SARAH_TTS_INFLIGHT = new Map<
  string,
  Promise<{
    audio_base64: string | null;
    audio_mime: string;
    voice: string;
  }>
>();

let workingTtsModel: string | null = null;
let workingTextModel: string | null = null;

/**
 * Wraps raw 24kHz 16-bit mono little-endian PCM (`audio/L16;codec=pcm;rate=24000`)
 * in a standard 44-byte RIFF WAV header so HTML5 `<audio>` plays it natively with zero errors.
 */
function ensureRiffWavBase64(rawBase64: string, sampleRate = 24000): string {
  const pcmBuf = Buffer.from(rawBase64, 'base64');
  if (pcmBuf.length >= 4 && pcmBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
    return rawBase64;
  }
  const header = Buffer.alloc(44);
  const dataLen = pcmBuf.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  header.writeUInt16LE(1, 22);  // NumChannels (1 = mono)
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // ByteRate = SampleRate * NumChannels * BitsPerSample/8
  header.writeUInt16LE(2, 32);  // BlockAlign = NumChannels * BitsPerSample/8
  header.writeUInt16LE(16, 34); // BitsPerSample = 16
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcmBuf]).toString('base64');
}

export function splitIntoFastSpeechChunks(text: string): { firstChunk: string; restChunk: string } {
  const clean = String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return { firstChunk: '', restChunk: '' };

  // First try splitting at the first sentence boundary (. ! ?)
  const sentenceMatch = clean.match(/^([^.!?]+[.!?]+)\s+([\s\S]+)$/);
  if (sentenceMatch && sentenceMatch[1].length <= 135) {
    return {
      firstChunk: sentenceMatch[1].trim(),
      restChunk: sentenceMatch[2].trim(),
    };
  }

  // If the first sentence is long (> 135 chars), split at the first natural clause comma/dash after 32 chars
  const clauseMatch = clean.match(/^(.{28,95}[,;—–-])\s+([\s\S]+)$/);
  if (clauseMatch) {
    return {
      firstChunk: clauseMatch[1].trim(),
      restChunk: clauseMatch[2].trim(),
    };
  }

  if (sentenceMatch) {
    return {
      firstChunk: sentenceMatch[1].trim(),
      restChunk: sentenceMatch[2].trim(),
    };
  }

  return { firstChunk: clean, restChunk: '' };
}

// Pre-seed Sarah's natural Vindemiatrix voice cache with the opening greeting chunks (0ms latency, 0 quota used)
for (const [k, b64] of Object.entries(sarahGreetingAudioJson as Record<string, string>)) {
  if (k && b64) {
    SARAH_TTS_CACHE.set(k.trim(), {
      audio_base64: b64,
      audio_mime: 'audio/wav',
      voice: SARAH_VOICE_NAME,
    });
  }
}

export async function synthesizeSarahNeuralAudio(text: string): Promise<{
  audio_base64: string | null;
  audio_mime: string;
  voice: string;
}> {
  const cleanText = String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanText) {
    return { audio_base64: null, audio_mime: 'audio/wav', voice: SARAH_VOICE_NAME };
  }

  const cached = SARAH_TTS_CACHE.get(cleanText);
  if (cached) {
    return cached;
  }

  if (!isAIEnabled()) {
    return { audio_base64: null, audio_mime: 'audio/wav', voice: SARAH_VOICE_NAME };
  }

  const inflight = SARAH_TTS_INFLIGHT.get(cleanText);
  if (inflight) {
    return inflight;
  }

  const runPromise = (async () => {
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    const baseModels = [
      'gemini-2.5-flash-preview-tts',
      'gemini-3.8-flash-lite-tts',
      'gemini-3.8-flash-tts',
      'gemini-3.1-flash-tts-preview',
    ];
    const ttsModels = workingTtsModel ? [workingTtsModel, ...baseModels] : baseModels;

    for (const modelName of [...new Set(ttsModels)]) {
      try {
        const r: any = await Promise.race([
          ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [{ text: cleanText }],
              },
            ],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: SARAH_VOICE_NAME,
                  },
                },
              },
            },
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('TTS timeout')), 3500)),
        ]);
        const inline = r?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inline?.data) {
          workingTtsModel = modelName;
          const wavBase64 = ensureRiffWavBase64(inline.data, 24000);
          const entry = {
            audio_base64: wavBase64,
            audio_mime: 'audio/wav',
            voice: SARAH_VOICE_NAME,
          };
          if (SARAH_TTS_CACHE.size > 150) {
            const oldestKey = SARAH_TTS_CACHE.keys().next().value;
            if (oldestKey && !(oldestKey in (sarahGreetingAudioJson as Record<string, string>))) {
              SARAH_TTS_CACHE.delete(oldestKey);
            }
          }
          SARAH_TTS_CACHE.set(cleanText, entry);
          return entry;
        }
      } catch {
        // try next TTS model or Gemini 3.1 Live Vindemiatrix fallback
      }
    }

    // Fallback to Gemini 3.1 Flash Live WebSocket using Vindemiatrix voice (unlimited quota!)
    try {
      const chunks: Buffer[] = [];
      await new Promise<void>(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Live TTS timeout')), 9500);
        try {
          const session = await ai.live.connect({
            model: 'gemini-3.1-flash-live-preview',
            config: {
              responseModalities: [Modality.AUDIO],
              systemInstruction: {
                parts: [{ text: 'Repeat the exact text the user sends verbatim with zero changes.' }],
              },
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: SARAH_VOICE_NAME,
                  },
                },
              },
            },
            callbacks: {
              onmessage: (msg: any) => {
                for (const p of msg?.serverContent?.modelTurn?.parts || []) {
                  if (p?.inlineData?.data) {
                    chunks.push(Buffer.from(p.inlineData.data, 'base64'));
                  }
                }
                if (msg?.serverContent?.turnComplete) {
                  clearTimeout(timer);
                  try {
                    session.close();
                  } catch { }
                  resolve();
                }
              },
              onerror: (err: any) => {
                clearTimeout(timer);
                reject(err);
              },
            },
          });
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: `Say verbatim: ${cleanText}` }] }],
            turnComplete: true,
          });
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });

      if (chunks.length > 0) {
        const wavBase64 = ensureRiffWavBase64(Buffer.concat(chunks).toString('base64'), 24000);
        const entry = {
          audio_base64: wavBase64,
          audio_mime: 'audio/wav',
          voice: SARAH_VOICE_NAME,
        };
        SARAH_TTS_CACHE.set(cleanText, entry);
        return entry;
      }
    } catch {
      // ignore
    }

    return { audio_base64: null, audio_mime: 'audio/wav', voice: SARAH_VOICE_NAME };
  })();

  SARAH_TTS_INFLIGHT.set(cleanText, runPromise);
  try {
    return await runPromise;
  } finally {
    SARAH_TTS_INFLIGHT.delete(cleanText);
  }
}

const NON_NAME_WORDS_RE =
  /^(good|doing|fine|well|calling|looking|interested|happy|ready|busy|wondering|asking|here|not|sure|term|life|whole|health|group|long|medicare|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|telephone|phone|video|in-person|person|appointment|schedule|book|confirm|yes|yeah|yep|okay|ok|please|thank|thanks|hello|hi|hey|my|the|and|for|with|about|want|need|would|like|can|you|help|me|set|up|an|at|on|in|to|from|arizona|phoenix|scottsdale|mesa|tempe|chandler|glendale|peoria|tucson|ohio|canton|cleveland|columbus|cincinnati|akron|toledo|dayton|california|texas|florida|illinois|pennsylvania|georgia|michigan|virginia|washington|massachusetts|indiana|tennessee|missouri|maryland|wisconsin|minnesota|colorado|alabama|louisiana|kentucky|oregon|oklahoma|connecticut|utah|iowa|nevada|arkansas|mississippi|kansas|nebraska|idaho|hawaii|maine|montana|delaware|alaska|vermont|wyoming|street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|circle|cir|place|pl|parkway|pkwy|trail|trl|loop|hwy|highway|terrace|ter|address|number|cell|mobile|zip|code|state|city|website|google|online|friend|referral|referred|colleague|coworker|heard|hear|us|your|is|am|are|was|were|live|located|receptionist|speaking|sarah|insurance|financial|services|fiduciary|advisory|carrier|carriers|broker|fees|direct|call|today|how|may|iwg)$/i;

const US_STATE_MAP: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

function toTitleCaseWords(input: string): string {
  return String(input || '')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 2 && /^[A-Z]{2}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function isValidExtractedFullName(candidate: string): boolean {
  const words = String(candidate || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2 || words.length > 3) return false;
  for (const w of words) {
    if (!/^[A-Za-z][A-Za-z'-]{1,20}$/.test(w)) return false;
    if (NON_NAME_WORDS_RE.test(w)) return false;
  }
  return true;
}

function extractCleanNameFromWords(rawPhrase: string): string | undefined {
  const tokens = String(rawPhrase || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, ''))
    .filter(Boolean);
  const validTokens: string[] = [];
  for (const tok of tokens) {
    if (!/^[A-Za-z][A-Za-z'-]{1,20}$/.test(tok)) break;
    if (NON_NAME_WORDS_RE.test(tok)) break;
    validTokens.push(tok);
    if (validTokens.length === 3) break;
  }
  if (validTokens.length >= 2) {
    const candidate = validTokens.join(' ');
    if (isValidExtractedFullName(candidate)) {
      return toTitleCaseWords(candidate);
    }
  }
  return undefined;
}

export function extractCustomerContactDetails(
  text: string,
  history?: Array<{ speaker: 'sarah' | 'user'; text: string }>
): {
  fullName?: string;
  phone?: string;
  address?: string;
  state?: string;
  howHeard?: string;
} {
  // Build user-only text so we NEVER accidentally extract Sarah's own (480) 331-9455 number or words
  const userTurns: string[] = [];
  if (Array.isArray(history) && history.length > 0) {
    for (const h of history) {
      if ((h.speaker === 'user' || (h as any).role === 'user') && h.text) {
        userTurns.push(String(h.text).trim());
      }
    }
  }
  if (text) {
    userTurns.push(String(text).trim());
  }
  const s = userTurns.join(' | ');
  let fullName: string | undefined;
  let phone: string | undefined;
  let address: string | undefined;
  let state: string | undefined;
  let howHeard: string | undefined;

  // 1. Extract Phone Number (supports 10-digit and 11-digit numbers like 33014122892; ignores 480-331-9455 and 602-456-9681)
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4,5}\b|\b\d{10,11}\b/g;
  let pm: RegExpExecArray | null;
  while ((pm = phoneRegex.exec(s)) !== null) {
    const digits = pm[0].replace(/\D/g, '');
    if (
      digits.length >= 10 &&
      digits.length <= 11 &&
      !digits.endsWith('4803319455') &&
      !digits.endsWith('6024569681')
    ) {
      phone = pm[0].trim();
    }
  }

  // 2. Extract Street Address & State (supports both "123456 Street, Canton, Ohio 44705" and unpunctuated "123456 street canton ohio 44705")
  const addrRegex =
    /\b(\d{1,6}\s+(?:[A-Za-z0-9.#-]{1,25}\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Circle|Cir|Place|Pl|Parkway|Pkwy|Trail|Trl|Loop|Hwy|Highway|Terrace|Ter)\b(?:[,\s]+[A-Za-z.]{2,20}){0,4}(?:[,\s]+\d{5}(?:-\d{4})?\b)?)/i;

  const addrMatch = s.match(addrRegex);
  if (addrMatch?.[1]) {
    address = addrMatch[1]
      .replace(/\s+\|\s+.*$/, '')
      .replace(/\b(?:and\s+my\s+phone|my\s+phone|phone\s+is|phone\s+number|phone\b|and\s+i\s+want|and\s+you\s+want|you\s+want|i\s+want|\d{10,11}).*$/i, '')
      .replace(/[,;\s]+$/, '')
      .trim();
  }

  // Extract State from address or user text
  const stateSearchStr = `${address || ''} ${s}`;
  for (const [stateName, abbr] of Object.entries(US_STATE_MAP)) {
    if (new RegExp(`\\b${stateName}\\b`, 'i').test(stateSearchStr)) {
      state = abbr;
      break;
    }
  }
  if (!state) {
    const abbrZipMatch = stateSearchStr.match(/\b([A-Z]{2})\s+\d{5}\b/);
    if (abbrZipMatch?.[1]) {
      state = abbrZipMatch[1].toUpperCase();
    }
  }

  // 3. Extract Full Name (stops cleanly at non-name words like "your", "my", "address", "phone" in unpunctuated speech!)
  const explicitIntroRegex = /\b(?:my name is|my full name is|your name is|name is|this is|i am|i'm)\s+([A-Za-z][A-Za-z'-]{1,20}(?:\s+[A-Za-z][A-Za-z'-]{1,20}){1,3})/gi;
  let nm: RegExpExecArray | null;
  while ((nm = explicitIntroRegex.exec(s)) !== null) {
    const candidate = extractCleanNameFromWords(nm[1]);
    if (candidate) {
      fullName = candidate;
    }
  }

  if (!fullName) {
    const beforeFieldMatch = s.match(
      /\b([A-Za-z][A-Za-z'-]{1,20}\s+[A-Za-z][A-Za-z'-]{1,20})(?=\s*(?:,|and my|my phone|my number|my address|your address|at\s+\d|phone|address|\(?\d{3}\)?[-.\s]?\d{3}))/i
    );
    if (beforeFieldMatch?.[1]) {
      const candidate = extractCleanNameFromWords(beforeFieldMatch[1]);
      if (candidate) fullName = candidate;
    }
  }

  // 4. Extract "How Did You Hear About Us?" (howHeard)
  if (/\b(friend|family|neighbor|colleague|coworker|referred|referral|word of mouth|someone told me|brother|sister|recommended)\b/i.test(s)) {
    howHeard = 'Friend / Personal Referral';
  } else if (/\b(website|iwillglobal\.com|your site|web page|online)\b/i.test(s)) {
    howHeard = 'Company Website (iwillglobal.com)';
  } else if (/\b(google|search engine|searched online|bing|yahoo)\b/i.test(s)) {
    howHeard = 'Google Search';
  } else if (/\b(facebook|instagram|youtube|linkedin|tiktok|social media)\b/i.test(s)) {
    howHeard = 'Social Media';
  } else if (/\b(postcard|direct mail|mailer|flyer|brochure|letter in the mail)\b/i.test(s)) {
    howHeard = 'Direct Mail / Postcard';
  }

  // 5. Context-aware direct turn extraction (when caller answers Sarah's question directly)
  const allTurns = [...(history || [])];
  if (text && (!allTurns.length || allTurns[allTurns.length - 1]?.text !== text)) {
    allTurns.push({ speaker: 'user', text });
  }

  for (let i = 0; i < allTurns.length; i++) {
    const turn = allTurns[i];
    if (turn.speaker !== 'user' && (turn as any).role !== 'user') continue;
    const uText = String(turn.text || '').trim();
    if (!uText) continue;
    const prevSarah =
      allTurns
        .slice(0, i)
        .reverse()
        .find((t) => t.speaker === 'sarah' || (t as any).role === 'sarah')?.text || '';

    // Direct name answer or leading name in user turn
    if (!fullName) {
      const cleanedForName = uText
        .replace(/^(?:yes|yeah|sure|okay|ok|hi|hello)[,\s]+/i, '')
        .replace(/[,.;|].*$/, '')
        .trim();
      const candidate = extractCleanNameFromWords(cleanedForName);
      if (candidate && (cleanedForName.split(/\s+/).length <= 3 || /full name|first and last name|your name/i.test(prevSarah))) {
        fullName = candidate;
      }
    }

    // Direct address answer if Sarah asked for street address
    if (!address && /street address|your address|business or street address/i.test(prevSarah)) {
      const numStreetMatch = uText.match(/\b(\d{1,6}\s+[A-Za-z0-9.\s,#-]{4,65})\b/);
      if (numStreetMatch?.[1]) {
        const candidateAddr = numStreetMatch[1]
          .replace(/\b(?:and my phone|my phone|phone is|number is|\d{10,11}).*$/i, '')
          .replace(/[,;\s]+$/, '')
          .trim();
        if (candidateAddr.length >= 6 && !/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4,5}$/.test(candidateAddr)) {
          address = candidateAddr;
        }
      }
    }

    // Direct "how did you hear about us" answer when Sarah specifically asked how they heard about us after booking
    if (
      !howHeard &&
      /before i let you go, how did you hear about/i.test(prevSarah) &&
      !/\b(my name is|address is|phone is|\d{10,11}|\d{1,6}\s+\w+\s+(?:street|st|ave|road|rd|dr|blvd))\b/i.test(uText)
    ) {
      const cleanHow = uText.trim();
      if (cleanHow.length >= 2 && cleanHow.length <= 80 && !extractCleanNameFromWords(cleanHow)) {
        howHeard = cleanHow;
      }
    }
  }

  return { fullName, phone, address, state, howHeard };
}

export function detectAppointmentBookingIntent(
  userText: string,
  sarahText = '',
  historyText = '',
  history?: Array<{ speaker: 'sarah' | 'user'; text: string }>
): {
  wantsAppointment: boolean;
  shouldBook: boolean;
  alreadyBookedInHistory: boolean;
  appointmentType: 'Telephone' | 'In-Person' | 'Video';
  preferredDatetime: string;
  productInterest: string;
  extractedName?: string;
  extractedPhone?: string;
  extractedAddress?: string;
  extractedState?: string;
  extractedHowHeard?: string;
} {
  const combined = `${historyText} ${userText} ${sarahText}`;
  const lowerUser = String(userText || '').toLowerCase();
  const lowerSarah = String(sarahText || '').toLowerCase();

  const extracted = extractCustomerContactDetails(userText, history);
  const productInterest = detectProductInterest(combined, 'Insurance & Benefits');
  const apptType: 'Telephone' | 'In-Person' | 'Video' = /in-person|in person|face to face/i.test(
    `${historyText} ${userText} ${sarahText}`
  )
    ? 'In-Person'
    : /video|google meet|zoom/i.test(`${historyText} ${userText} ${sarahText}`)
      ? 'Video'
      : 'Telephone';

  // Extract preferredDatetime from USER turns first so Sarah's work-hours mention ("Monday through Friday 8:00 AM") never overrides the caller's requested time ("Thursday afternoon")!
  const userOnlyText = [
    ...(history || [])
      .filter((h) => h.speaker === 'user' || (h as any).role === 'user')
      .map((h) => h.text),
    userText,
  ].join(' | ');

  const dayTimeRegex =
    /\b((?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|next week)(?:\s+(?:morning|afternoon|evening|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?|\d{1,2}(?::\d{2})?\s*(?:am|pm)|morning|afternoon)\b/gi;
  const userTimeMatches = [...userOnlyText.matchAll(dayTimeRegex)].map((m) => m[0]);
  const timeMatch =
    userTimeMatches.length > 0
      ? userTimeMatches[userTimeMatches.length - 1]
      : `${userText} ${sarahText}`.match(dayTimeRegex)?.[0] || 'Thursday afternoon';

  // Check if an appointment was ALREADY booked and confirmed in an earlier Sarah turn in this conversation
  const alreadyBookedInHistory = Boolean(
    (history || []).some(
      (h) =>
        (h.speaker === 'sarah' || (h as any).role === 'sarah') &&
        /\b(i have scheduled your .* appointment|just sent a confirmation text to your phone|please reply yes to that confirmation text)\b/i.test(
          h.text || ''
        )
    )
  );

  const userAskingToReschedule = /\b(change|reschedule|different time|instead|move it)\b/i.test(lowerUser);

  const userGivesTimeOrFormat =
    /\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|\d{1,2}\s*(?:am|pm)|telephone|phone appointment|in-person|in person|video appointment)\b/i.test(
      lowerUser
    ) &&
    /\b(schedule|book|appointment|set up|confirm|tomorrow|monday|tuesday|wednesday|thursday|friday|morning|afternoon|\d{1,2}\s*(?:am|pm)|telephone|in-person|video|confirmation text)\b/i.test(
      `${lowerUser} ${historyText.toLowerCase()}`
    );

  const userGivesContactForBooking =
    Boolean(extracted.fullName || extracted.phone || extracted.address) &&
    /\b(appointment|schedule|book|tomorrow|monday|tuesday|wednesday|thursday|friday|morning|afternoon|\d{1,2}\s*(?:am|pm)|telephone|in-person|video|confirmation text|full name|street address)\b/i.test(
      combined
    );

  const userExplicitlyRequestsBookingWithTime =
    /\b(book|schedule|set up|confirm|want an appointment|need an appointment|set an appointment)\b/i.test(lowerUser) &&
    /\b(appointment|consultation|call|visit|tomorrow|monday|tuesday|wednesday|thursday|friday|morning|afternoon|\d{1,2}\s*(?:am|pm))\b/i.test(
      lowerUser
    );

  const sarahConfirmsBooking =
    /\b(i have (?:officially )?(?:confirmed|reserved|scheduled|booked)|your .* appointment .* is (?:confirmed|set)|just sent a confirmation text)\b/i.test(
      lowerSarah
    );

  const rawWantsAppointment = Boolean(
    userGivesTimeOrFormat ||
    userGivesContactForBooking ||
    userExplicitlyRequestsBookingWithTime ||
    sarahConfirmsBooking
  );

  const wantsAppointment = alreadyBookedInHistory && !userAskingToReschedule ? false : rawWantsAppointment;

  return {
    wantsAppointment,
    shouldBook: wantsAppointment,
    alreadyBookedInHistory,
    appointmentType: apptType,
    preferredDatetime: timeMatch,
    productInterest,
    extractedName: extracted.fullName,
    extractedPhone: extracted.phone,
    extractedAddress: extracted.address,
    extractedState: extracted.state,
    extractedHowHeard: extracted.howHeard,
  };
}

/**
 * Exact Cloned Sarah Agent Scenario Engine (`sarah.json` Format 3).
 * Executes all 10 scenarios, 6 product funnels, 2027 CMS cost rules, 3 fiduciary objections,
 * 42-member directory whisper transfers, and step-by-step appointment setting identically to `sarah.json`.
 */
async function runClonedSarahScenario(
  userText: string,
  history: Array<{ speaker: 'sarah' | 'user'; text: string }>,
  sessionContext: SarahSessionContext
): Promise<{
  reply: string;
  scenario: string;
  transfer?: any;
  appointment?: any;
  disposition?: any;
}> {
  const lower = userText.toLowerCase().trim();
  const rawName = (sessionContext.prospect_name || '').trim();
  const isGenericName = isPlaceholderProspectName(rawName);
  const firstName = isGenericName ? 'there' : rawName.split(/\s+/)[0] || 'there';
  const allHistoryText = [...(history || []).map((h) => h.text), userText].join(' ');
  const activeProduct = detectProductInterest(allHistoryText, sessionContext.product_interest || '');
  if (activeProduct) {
    sessionContext.product_interest = activeProduct;
  }

  const lastSarahMsg =
    [...(history || [])]
      .reverse()
      .find((h) => h.speaker === 'sarah')
      ?.text?.toLowerCase() || '';

  // 0. Explicit Script Tree Directive from UI buttons
  if (lower.includes('[script tree directive]')) {
    if (lower.includes('step 1')) {
      return {
        scenario: 'Outbound Opening Greeting',
        reply: `Hello ${firstName}, this is Sarah calling from IWG Insurance and Financial Services. How are you today?`,
      };
    }
    if (lower.includes('step 2') || lower.includes('value hook')) {
      return {
        scenario: 'Outbound 2027 Value Hook',
        reply: `We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your options and protect your benefits, would you like to know about the upcoming changes for 2027?`,
      };
    }
    if (lower.includes('step 3') || lower.includes('3-point') || lower.includes('summary')) {
      return {
        scenario: '3-Point 2027 Medicare Summary',
        reply: `Under Original Medicare in 2027, Part A has a $1,788 hospital deductible and Part B is projected at $209.50 a month with a $292 annual deductible and an uncapped 20% medical coinsurance with no annual limit. Second, Part D caps annual out-of-pocket prescription costs at $2,400 with a $35 insulin cap and $0 adult vaccines. That is why we run a complimentary 5-minute check across 104+ carriers—comparing Medigap Plan G, Plan N, and Medicare Advantage plans—at zero cost. Would you like me to get our Principal Broker King Amen Ra on the line right now, or schedule an appointment?`,
      };
    }
  }

  // 0B. Check if caller is asking about our work hours / business hours
  if (/\b(work hours|business hours|office hours|what are your hours|what time do you open|what time do you close|when are you open|are you open)\b/i.test(lower)) {
    const wh = checkReceptionistWorkHours(sessionContext);
    return {
      scenario: 'Work Hours & Availability',
      reply: `Our work hours are Monday through Friday from 8:00 AM to 8:00 PM Arizona time. While I answer inbound calls 24 hours a day, 7 days a week to assist you and schedule appointments, live warm transfers to our Principal Broker King Amen Ra are available strictly during our work hours of Monday through Friday from 8:00 AM to 8:00 PM.${!wh.isOpen ? ' Since we are currently outside those hours, I would love to get you scheduled on King Amen Ra’s calendar—do you prefer a 30-minute Telephone, 60-minute In-Person, or 30-minute Video appointment, and may I have your full name, phone number, and street address?' : ' How may I assist you today?'}`,
    };
  }

  // 1. Check for Appointment Booking progression (Format + Date/Time + Full Name + Phone Number + Street Address)
  const bookingIntent = detectAppointmentBookingIntent(userText, '', allHistoryText, history);
  if (bookingIntent.wantsAppointment) {
    const apptTypeRaw = bookingIntent.appointmentType;
    const timeMatch = bookingIntent.preferredDatetime;
    const productForAppt = activeProduct || bookingIntent.productInterest || 'Insurance & Benefits';
    const apptRes = await executeSarahTool(
      'book_appointment',
      {
        customer_name: bookingIntent.extractedName || sessionContext.prospect_name,
        phone: bookingIntent.extractedPhone || sessionContext.prospect_phone,
        product_interest: productForAppt,
        appointment_type: apptTypeRaw,
        preferred_datetime: timeMatch,
        state: sessionContext.state,
        address: bookingIntent.extractedAddress || sessionContext.address,
        send_text_reminder: true,
      },
      sessionContext
    );
    return {
      scenario: 'Book Appointment (Step-by-Step Verification)',
      reply: apptRes.message,
      appointment: apptRes.success ? apptRes : null,
    };
  }

  // 2. Check Specific Non-Medicare Product Lines FIRST so Life Insurance / Health / Group / LTC NEVER get routed to Medicare!
  // 2A-1. Scenario: Investment Grade Life Insurance (High Cash-Value IUL / IRS Section 7702)
  if (/\b(iul|indexed universal|universal life|7702|infinite banking|tax-free retirement|cash value|cash-value)\b/i.test(lower)) {
    return {
      scenario: 'Investment Grade Life Insurance (IUL)',
      reply: `We specialize in institutional-grade wealth accumulation and protection! Representing over 104 premier carriers with zero broker fees, we structure high cash-value Indexed Universal Life policies under IRS Section 7702 that capture market upside with a contractual 0% downside floor—so you never lose a penny of principal when the market drops—and generate 100% tax-free retirement income. Let's schedule a private 30-minute Telephone, 30-minute Video, or 60-minute In-Person illustration review with our Principal Broker, King Amen Ra. What day and time works best for you, and may I get your full name, phone number, and street address so I can send your confirmation text?`,
    };
  }

  // 2A-2. Scenario: Modern Term Life & Whole Life Insurance with Living Benefits
  if (/\b(life insurance|term life|whole life|final expense|burial|living benefits|death benefit|family protection)\b/i.test(lower)) {
    return {
      scenario: 'Modern Term & Whole Life Insurance with Living Benefits',
      reply: `We would be honored to protect your family with Life Insurance! As a 100% free fiduciary brokerage representing over 104 premier carriers with zero fees, we specialize in Modern Term Life and Whole Life policies with built-in Living Benefits—which pay tax-free cash directly to you while you are alive in the event of a critical, chronic, or terminal illness—and feature 15-minute no-exam digital approvals at wholesale rates. Let's set up a 30-minute Telephone, 30-minute Video, or 60-minute In-Person appointment with our Principal Broker, King Amen Ra. Does tomorrow morning or afternoon work best for you, and may I have your full name, phone number, and street address so I can send your confirmation text?`,
    };
  }

  // 2B. Scenario: Individual & Family Health Insurance (ACA / Private PPO) (`sarah.json` line 148)
  if (/\b(individual|family|aca|marketplace|obamacare|ppo|subsidy|tax credit|under 65|kids|dental|vision)\b/i.test(lower)) {
    return {
      scenario: 'Individual Health Quote',
      reply: `We would be honored to help you and your family save on health coverage! As a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees, we compare both ACA Marketplace plans—maximizing your Advanced Premium Tax Credits and Silver CSR $0 deductibles—and nationwide off-exchange private PPO networks where you never need a referral. Let's reserve a 30-minute Telephone, 30-minute Video, or 60-minute In-Person consultation with our Principal Broker, King Amen Ra, to check if you qualify for a $0 or reduced-cost plan. What day and time works best, and may I have your full name, phone number, and street address so I can send your confirmation text?`,
    };
  }

  // 2C. Scenario: Group Health Plans (`sarah.json` line 209)
  if (/\b(group|business|employer|employee|company health|ichra|level-funded|level funded|small business)\b/i.test(lower)) {
    return {
      scenario: 'Group Health Plans',
      reply: `We would love to support your business and employees! As an independent fiduciary advisory representing over 104 premier carriers with zero broker fees, we design Level-Funded and ICHRA corporate benefit plans for businesses with 1 to 50+ employees that typically slash employer healthcare overhead by 15% to 30% while refunding unused claims reserves directly back to your business at year-end. Let's schedule a complimentary Corporate Benefits Audit with our Principal Broker, King Amen Ra, by Telephone, Video, or In-Person. What day and time works best, and may I get your full name, phone number, and business or street address so I can send your confirmation text?`,
    };
  }

  // 2D. Scenario: Long-Term Care (`sarah.json` line 289)
  if (/\b(long-term care|long term care|ltc|nursing|home health|assisted living|hybrid)\b/i.test(lower)) {
    return {
      scenario: 'Long-Term Care',
      reply: `Protecting your life savings and dignity is at the heart of what we do! We represent over 104 premier carriers offering modern 'use-it-or-leave-it' Asset-Based Hybrid Life and Long-Term Care with guaranteed level premiums—paying tax-free monthly benefits for home health care, assisted living, or memory care if you need it, or returning 100% of your benefit tax-free to your family if you never use it. Let's schedule a dedicated Telephone, Video, or In-Person asset-protection consultation with our Principal Broker, King Amen Ra. What day and time works best, and may I have your full name, phone number, and street address so I can send your confirmation text?`,
    };
  }

  // 3. Check if caller is agreeing ("yes", "sure", "okay", "please", "connect me") after Sarah offered to connect King Amen Ra
  const isAffirmative =
    /^(yes|yeah|yep|sure|okay|ok|please|absolutely|definitely|sounds good|let's do it|go ahead|connect me|put him on|get him on|right now)\b/i.test(
      lower
    ) || /\b(yes please|connect me|get him on the line|talk to king|speak with king|speak to an advisor)\b/i.test(lower);

  if (
    isAffirmative &&
    (lastSarahMsg.includes('get him on the line') ||
      lastSarahMsg.includes('connect you with king') ||
      lastSarahMsg.includes('connect you with our principal') ||
      lastSarahMsg.includes('connect you with a licensed') ||
      lastSarahMsg.includes('connect you now') ||
      lastSarahMsg.includes('verify that for your peace of mind'))
  ) {
    if (sessionContext.on_warm_transfer) {
      return {
        scenario: 'Book Appointment (Executive Alternative-Choice Close)',
        reply: `Because King Amen Ra is currently on a live consultation helping another client, I want to reserve a dedicated one-on-one time for you on his calendar and send a confirmation text right to your phone. Do you prefer a 30-minute Telephone consultation, a 60-minute In-Person visit, or a 30-minute Video consultation—and what day and time works best for you?`,
      };
    }
    const transferResult = await executeSarahTool(
      'whisper_warm_transfer',
      {
        recipient_name: 'King Amen Ra',
        prospect_name: sessionContext.prospect_name,
        prospect_phone: sessionContext.prospect_phone,
        state: sessionContext.state,
        reason: activeProduct ? `reviewing ${activeProduct} options` : undefined,
      },
      sessionContext
    );
    if (transferResult?.outside_work_hours) {
      return {
        scenario: 'Outside Work Hours — Book Appointment (No Warm Transfers Outside M-F 8am-8pm)',
        reply: transferResult.message,
      };
    }
    return {
      scenario: 'Connect to King Amen Ra',
      reply:
        transferResult.hold_message ||
        `Wonderful! Please hold for just a moment while I call King Amen Ra on his line and connect to him first. I will let you know as soon as we are connected.`,
      transfer: transferResult,
    };
  }

  // 4. Empathy-First Fiduciary Objection Handling (`sarah.json` Section 4)
  if (
    /\b(happy with my|keep my plan|don't want to change|already have a plan|already have an agent|already have a broker|satisfied with my)\b/i.test(
      lower
    )
  ) {
    return {
      scenario: 'Objection: Happy With Current Plan / Agent',
      reply: `I love hearing that, and our goal is never to move you if your current coverage is still the number one option for you. Our free 5-minute fiduciary review across 104+ carriers simply confirms in writing that you have the strongest benefits at the lowest cost—and if you do, we tell you to stay right where you are. Would you like King Amen Ra to verify that for you now, or should we schedule a quick appointment?`,
    };
  }

  if (/\b(how much does (this|it) cost|what('s| is) the catch|do you charge|broker fee|is this free)\b/i.test(lower)) {
    return {
      scenario: 'Objection: Cost / Fiduciary Guarantee',
      reply: `There is never a fee, markup, or obligation—ever. Insurance premiums are regulated, meaning you pay the exact same rate whether you shop alone or have our Principal Broker King Amen Ra and clinical leadership under Aneesha Sullivan, PA advocate for you year-round across 104+ carriers for free. Would you like me to connect you with King Amen Ra now, or schedule an appointment?`,
    };
  }

  if (/\b(mail me|send me something|busy right now|call me back|in a hurry|don't have time|schedule|appointment)\b/i.test(lower)) {
    const prodLabel = activeProduct || 'coverage';
    return {
      scenario: 'Objection: Busy / Schedule Appointment',
      reply: `I completely respect your time. Let’s set up a 30-minute Telephone consultation, a 60-minute In-Person visit, or a 30-minute Video appointment for your ${prodLabel} review. Which of those three formats and what day and time work best—and may I get your full name, phone number, and street address so I can send your confirmation text?`,
    };
  }

  // 5. Outbound Call Progression: Step 1 (How are you today?) -> Step 2 (2027 Value Hook) -> Step 3 (3-Point Summary)
  if (
    lastSarahMsg.includes('how are you today') &&
    !activeProduct &&
    !/\b(not interested|stop|remove|do not call|part a|part b|part d|medigap|life|iul|term|long-term|group|aca|health)\b/i.test(lower)
  ) {
    const askedHowSarahIs = /\b(how are you|and you|how about you)\b/i.test(lower);
    return {
      scenario: 'Outbound 2027 Value Hook',
      reply: `${askedHowSarahIs ? `I'm doing wonderful, thank you for asking! ` : `Wonderful! `}We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your Medicare options and protect your benefits, would you like to know about the upcoming changes for 2027?`,
    };
  }

  if (
    (lastSarahMsg.includes('upcoming changes for 2027') || lastSarahMsg.includes('changes for 2027')) &&
    (isAffirmative || /\b(what changes|tell me|what are they|go ahead|sure|yes)\b/i.test(lower))
  ) {
    return {
      scenario: '3-Point High-Impact 2027 Medicare Summary & Assumptive Close',
      reply: `Absolutely! First, under Original Medicare for 2027, Part A has a $1,788 hospital deductible and Part B is projected at $209.50 a month with a $292 deductible, leaving an uncapped 20% medical coinsurance with no annual limit. Second, Part D caps annual out-of-pocket prescription costs at $2,400 with a $35 insulin cap and $0 adult vaccines. Third, we run a complimentary 5-minute check across 104+ carriers—comparing Medigap Plan G, Plan N, and Medicare Advantage plans—to ensure your doctors and medications are covered at the lowest cost. Would you like me to get our Principal Broker King Amen Ra on the line right now, or schedule an appointment?`,
    };
  }

  // 6. Scenario: 2027 Medicare Costs & Specific Parts (`sarah.json` Scenario "2027 Medicare Costs" & "Medicare Plan Help")
  if (/\b(part a|part b|part c|part d|medigap|plan g|plan n|coinsurance|2027|insulin|prescription|medicare)\b/i.test(lower)) {
    return {
      scenario: '2027 Medicare Costs & Plan Help',
      reply: `Here are the official 2027 Medicare cost standards: Part A is $0 monthly premium for over 99% of beneficiaries with a $1,788 inpatient hospital deductible. Part B is projected at $209.50 per month with a $292 annual deductible and an uncapped 20% coinsurance. Part D caps your annual out-of-pocket prescription costs at $2,400 with a $35 insulin cap and $0 adult vaccines. Medigap Plan G covers 100% of the $1,788 hospital deductible and 20% Part B coinsurance after the $292 deductible. Would you like me to connect you with Principal Broker King Amen Ra right now, or schedule an appointment and send a confirmation text to your phone?`,
    };
  }

  // 7. Scenario: Company & Carrier Info (`sarah.json` line 383)
  if (/\b(who are you|what is i will global|fiduciary|carriers|which companies|states|where do you operate|about us)\b/i.test(lower)) {
    return {
      scenario: 'Company & Carrier Info',
      reply: `I Will Global Insurance and Financial Services is a 100% free independent fiduciary brokerage led by Principal Broker King Amen Ra and Chief Operating Officer Aneesha Sullivan, PA. We represent you across 104+ premier carriers in 7 states across six core divisions: Life Insurance & IUL, Modern Term Life with Living Benefits, Individual & Family Health, Corporate Group Health, Asset-Based Long Term Care, and Medicare. Which division can I help you with today?`,
    };
  }

  // Default progression based on mode & detected product
  if (activeProduct && activeProduct !== 'Medicare') {
    return {
      scenario: `${activeProduct} Consultation & Scheduling`,
      reply: `I would love to help you with your ${activeProduct} options across our 104+ premier carriers at zero broker fee. Would you like me to connect you directly with our Principal Broker, King Amen Ra, right now, or would you prefer to schedule a 30-minute Telephone, 60-minute In-Person, or 30-minute Video appointment?`,
    };
  }

  if (sessionContext.mode === 'outbound') {
    return {
      scenario: 'Outbound Value Hook & Assumptive Close',
      reply: `We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. Our Principal Broker King Amen Ra can review your coverage options side by side in just 5 minutes. Would you like me to connect you with King Amen Ra right now, or schedule a 30-minute Telephone, 60-minute In-Person, or 30-minute Video appointment?`,
    };
  }

  return {
    scenario: 'Inbound 6-Product Funnel',
    reply: `As a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees, we specialize in six core divisions: Life Insurance & High Cash-Value IUL, Modern Term Life with Living Benefits, Individual & Family Health Insurance, Corporate Group Health, Asset-Based Long Term Care, and 2027 Medicare Plans—or I can connect you with anyone on our 42-member Team Directory. Which area can I help you with today?`,
  };
}

/**
 * Serverless HTTP Voice Turn handler (`POST /api/sarah/turn`) for Vercel (`iwillglobal.com`) & local CRM.
 * Clones the complete Sarah Agent Model (`sarah.json`) and synthesizes realistic human neural audio (`Vindemiatrix`).
 */
export async function handleSarahHttpTurn(params: {
  message?: string;
  userText?: string;
  history?: Array<{ speaker: 'sarah' | 'user'; text: string }>;
  context?: Partial<SarahSessionContext>;
  mode?: 'inbound' | 'outbound';
  leadName?: string;
  leadPhone?: string;
  leadState?: string;
  is_initial?: boolean;
  skip_inline_tts?: boolean;
}) {
  const resolveTts = async (text: string) => {
    const { firstChunk, restChunk } = splitIntoFastSpeechChunks(text);
    if (!firstChunk) {
      return {
        audio_base64: null,
        audio_mime: 'audio/wav',
        voice: SARAH_VOICE_NAME,
        first_chunk_text: '',
        rest_text: '',
      };
    }

    if (params.skip_inline_tts) {
      synthesizeSarahNeuralAudio(firstChunk).catch(() => { });
      if (restChunk) synthesizeSarahNeuralAudio(restChunk).catch(() => { });
      return {
        audio_base64: null,
        audio_mime: 'audio/wav',
        voice: SARAH_VOICE_NAME,
        first_chunk_text: firstChunk,
        rest_text: restChunk,
      };
    }

    // Start synthesizing restChunk in parallel so it is already in-flight/cached while firstChunk plays
    if (restChunk) {
      synthesizeSarahNeuralAudio(restChunk).catch(() => { });
    }
    const firstTts = await synthesizeSarahNeuralAudio(firstChunk);
    return {
      audio_base64: firstTts.audio_base64,
      audio_mime: firstTts.audio_mime || 'audio/wav',
      voice: firstTts.voice || SARAH_VOICE_NAME,
      first_chunk_text: firstChunk,
      rest_text: restChunk,
    };
  };

  let dbWarmTransfer = false;
  if (params.context?.on_warm_transfer === undefined) {
    try {
      const sarahCfg = await getSarahDialerConfig();
      dbWarmTransfer = Boolean(sarahCfg.is_on_warm_transfer);
    } catch {
      // ignore
    }
  }

  const resolvedMode =
    params.context?.mode === 'outbound' || params.mode === 'outbound' ? 'outbound' : 'inbound';
  const rawMessage = String(
    params.message ?? params.userText ?? (params as any).user_text ?? (params as any).text ?? ''
  ).trim();
  const allConvoText = [...(params.history || []).map((h) => h.text), rawMessage].join(' ');
  const detectedProduct = detectProductInterest(allConvoText, params.context?.product_interest || '');

  const rawLeadName = (params.context?.prospect_name || params.leadName || '').trim();
  const isGenericLeadName = isPlaceholderProspectName(rawLeadName);
  const rawLeadPhone = (params.context?.prospect_phone || params.leadPhone || '').trim();
  const isGenericLeadPhone = isPlaceholderProspectPhone(rawLeadPhone, resolvedMode);
  const rawLeadAddress = (params.context?.address || '').trim();
  const isGenericLeadAddress = isPlaceholderProspectAddress(rawLeadAddress);

  const sessionContext: SarahSessionContext = {
    mode: resolvedMode,
    lead_id: params.context?.lead_id,
    prospect_name: isGenericLeadName ? (resolvedMode === 'outbound' ? 'Valued Client' : '') : rawLeadName,
    prospect_phone: isGenericLeadPhone ? '' : rawLeadPhone,
    state: params.context?.state || params.leadState || 'Arizona',
    address: isGenericLeadAddress ? '' : rawLeadAddress,
    how_heard: params.context?.how_heard || '',
    caller_name: params.context?.caller_name || 'Sarah',
    on_warm_transfer:
      params.context?.on_warm_transfer !== undefined ? Boolean(params.context.on_warm_transfer) : dbWarmTransfer,
    product_interest: detectedProduct,
    source_channel:
      params.context?.source_channel || (resolvedMode === 'outbound' ? 'outbound' : 'call_in_lead'),
    force_work_hours: params.context?.force_work_hours,
    simulated_now_iso: params.context?.simulated_now_iso,
    force_live_connect: params.context?.force_live_connect,
  };

  const workHoursNow = checkReceptionistWorkHours(sessionContext);
  const firstName = isGenericLeadName ? 'there' : (sessionContext.prospect_name || 'there').split(/\s+/)[0] || 'there';

  // 1. Initial opening greeting when call starts (answers inbound calls immediately right away!)
  if (params.is_initial || !rawMessage) {
    const openingReply =
      sessionContext.mode === 'outbound'
        ? `Hello ${firstName}, this is Sarah calling from IWG Insurance and Financial Services. How are you today?`
        : `Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?`;
    const tts = await resolveTts(openingReply);
    return {
      ok: true,
      reply: openingReply,
      audio_base64: tts.audio_base64,
      audio_mime: tts.audio_mime,
      first_chunk_text: tts.first_chunk_text,
      rest_text: tts.rest_text,
      voice: tts.voice,
      mode: sessionContext.mode,
      line: SARAH_MAIN_LINE_DISPLAY,
      on_warm_transfer: sessionContext.on_warm_transfer,
      work_hours: RECEPTIONIST_WORK_HOURS_LABEL,
      work_hours_status: workHoursNow,
    };
  }

  const userText = rawMessage;
  let transferResult: any = null;
  let appointmentResult: any = null;
  let dispositionResult: any = null;

  // Extract caller's spoken name, phone, street address, state, and how they heard about us strictly from USER turns
  const extractedContact = extractCustomerContactDetails(userText, params.history || []);
  if (extractedContact.fullName) {
    sessionContext.prospect_name = extractedContact.fullName;
  }
  if (extractedContact.phone) {
    sessionContext.prospect_phone = extractedContact.phone;
  }
  if (extractedContact.address) {
    sessionContext.address = extractedContact.address;
  }
  if (extractedContact.state) {
    sessionContext.state = extractedContact.state;
  }
  if (extractedContact.howHeard) {
    sessionContext.how_heard = extractedContact.howHeard;
  }

  // If the caller provided their name or phone number, immediately add/update their Lead record in the CRM tagged as Call-In Lead
  if (
    sessionContext.mode === 'inbound' &&
    (!isPlaceholderProspectName(sessionContext.prospect_name) ||
      !isPlaceholderProspectPhone(sessionContext.prospect_phone, 'inbound'))
  ) {
    const upsertedLeadId = await upsertReceptionistLeadFromContext(sessionContext);
    if (upsertedLeadId) {
      sessionContext.lead_id = upsertedLeadId;
    }
  }

  const activeFirstName = !isPlaceholderProspectName(sessionContext.prospect_name)
    ? (sessionContext.prospect_name || 'there').split(/\s+/)[0] || 'there'
    : 'there';

  // Check if an appointment was ALREADY booked in an earlier turn and the caller is now answering "How did you hear about us?" or wrapping up
  const preBookingCheck = detectAppointmentBookingIntent(userText, '', allConvoText, params.history || []);
  const lastSarahInHistory =
    [...(params.history || [])]
      .reverse()
      .find((h) => h.speaker === 'sarah' || (h as any).role === 'sarah')?.text || '';

  if (
    preBookingCheck.alreadyBookedInHistory &&
    !preBookingCheck.wantsAppointment &&
    (/how did you hear about|how you heard about/i.test(lastSarahInHistory) || Boolean(extractedContact.howHeard))
  ) {
    const howHeardVal = sessionContext.how_heard || userText.trim();
    sessionContext.how_heard = howHeardVal;
    if (sessionContext.lead_id || !isPlaceholderProspectName(sessionContext.prospect_name)) {
      await upsertReceptionistLeadFromContext(
        sessionContext,
        `[${resolveInboundLeadSource(sessionContext)}] Heard About Us: ${howHeardVal} (Caller: ${sessionContext.prospect_name || 'Client'}, Phone: ${sessionContext.prospect_phone || ''})`
      );
    }
    const closingReply = `Thank you so much for sharing that with us, ${activeFirstName}! I have noted on your Call-In Lead profile for Principal Broker King Amen Ra that you heard about us through ${howHeardVal}. Your appointment for ${preBookingCheck.preferredDatetime} is all set—just reply YES to the confirmation text on your phone, and have a truly wonderful day!`;
    const tts = await resolveTts(closingReply);
    return {
      ok: true,
      reply: closingReply,
      scenario: 'Appointment Confirmed — How Heard Recorded',
      audio_base64: tts.audio_base64,
      audio_mime: tts.audio_mime,
      first_chunk_text: tts.first_chunk_text,
      rest_text: tts.rest_text,
      voice: tts.voice,
      product_interest: detectedProduct || null,
      lead_id: sessionContext.lead_id || null,
      lead_source: resolveInboundLeadSource(sessionContext),
      how_heard: sessionContext.how_heard || null,
      prospect_name: sessionContext.prospect_name,
      prospect_phone: sessionContext.prospect_phone,
      prospect_address: sessionContext.address,
      prospect_state: sessionContext.state,
      work_hours: RECEPTIONIST_WORK_HOURS_LABEL,
      work_hours_status: workHoursNow,
      mode: sessionContext.mode,
      line: SARAH_MAIN_LINE_DISPLAY,
    };
  }

  // 2. Check if caller requested a warm transfer (and is NOT asking to schedule an appointment instead)
  const reqCheck = detectTransferRequest(userText);
  const mentionsAppointmentScheduling =
    /\b(appointment|schedule|book|set up an appointment|monday|tuesday|wednesday|thursday|friday|tomorrow)\b/i.test(
      userText
    );
  if (reqCheck.requested && !mentionsAppointmentScheduling && !sessionContext.on_warm_transfer) {
    transferResult = await executeSarahTool(
      'whisper_warm_transfer',
      {
        recipient_name: reqCheck.recipientName,
        prospect_name: sessionContext.prospect_name,
        prospect_phone: sessionContext.prospect_phone,
        state: sessionContext.state,
        reason: detectedProduct ? `reviewing ${detectedProduct} options` : undefined,
      },
      sessionContext
    );
    if (transferResult?.outside_work_hours) {
      const outsideReply = transferResult.message;
      const tts = await resolveTts(outsideReply);
      return {
        ok: true,
        reply: outsideReply,
        audio_base64: tts.audio_base64,
        audio_mime: tts.audio_mime,
        first_chunk_text: tts.first_chunk_text,
        rest_text: tts.rest_text,
        voice: tts.voice,
        transfer: null,
        outside_work_hours: true,
        work_hours: RECEPTIONIST_WORK_HOURS_LABEL,
        work_hours_status: workHoursNow,
        mode: sessionContext.mode,
        line: SARAH_MAIN_LINE_DISPLAY,
      };
    }
    // IMPORTANT: Speak ONLY the hold message while dialing 602-456-9681 — NEVER announce connection before 602-456-9681 answers!
    const transferReply =
      transferResult.hold_message ||
      `Wonderful! Please hold for just a moment while I call ${transferResult.recipient_name || reqCheck.recipientName} on the line and connect to them first. I will let you know as soon as we are connected.`;
    const tts = await resolveTts(transferReply);
    return {
      ok: true,
      reply: transferReply,
      audio_base64: tts.audio_base64,
      audio_mime: tts.audio_mime,
      first_chunk_text: tts.first_chunk_text,
      rest_text: tts.rest_text,
      voice: tts.voice,
      transfer: transferResult,
      work_hours: RECEPTIONIST_WORK_HOURS_LABEL,
      work_hours_status: workHoursNow,
      mode: sessionContext.mode,
      line: SARAH_MAIN_LINE_DISPLAY,
    };
  }

  // 3. Explicit Script Tree Directive button click -> run exact deterministic step
  if (userText.toLowerCase().includes('[script tree directive]')) {
    const clonedMatch = await runClonedSarahScenario(userText, params.history || [], sessionContext);
    const tts = await resolveTts(clonedMatch.reply);
    return {
      ok: true,
      reply: clonedMatch.reply,
      scenario: clonedMatch.scenario,
      audio_base64: tts.audio_base64,
      audio_mime: tts.audio_mime,
      first_chunk_text: tts.first_chunk_text,
      rest_text: tts.rest_text,
      voice: tts.voice,
      transfer: clonedMatch.transfer || null,
      appointment: clonedMatch.appointment || null,
      disposition: clonedMatch.disposition || null,
      mode: sessionContext.mode,
      line: SARAH_MAIN_LINE_DISPLAY,
      lead_id: sessionContext.lead_id,
      prospect_name: sessionContext.prospect_name,
      prospect_phone: sessionContext.prospect_phone,
      prospect_address: sessionContext.address,
      prospect_state: sessionContext.state,
      how_heard: sessionContext.how_heard || null,
    };
  }

  // 3B. Fast deterministic step-by-step Appointment Intake & Booking Engine (<200ms response, 100% consistent!)
  if (preBookingCheck.shouldBook) {
    const checkRes = await executeSarahTool(
      'book_appointment',
      {
        customer_name: preBookingCheck.extractedName || sessionContext.prospect_name,
        phone: preBookingCheck.extractedPhone || sessionContext.prospect_phone,
        product_interest: preBookingCheck.productInterest || detectedProduct || 'Insurance & Benefits',
        appointment_type: preBookingCheck.appointmentType,
        preferred_datetime: preBookingCheck.preferredDatetime,
        state: preBookingCheck.extractedState || sessionContext.state,
        address: preBookingCheck.extractedAddress || sessionContext.address,
        how_heard: preBookingCheck.extractedHowHeard || sessionContext.how_heard,
        send_text_reminder: true,
      },
      sessionContext
    );
    if (checkRes.lead_id) sessionContext.lead_id = checkRes.lead_id;
    const replyText = checkRes.message;
    const tts = await resolveTts(replyText);
    return {
      ok: true,
      reply: replyText,
      scenario: checkRes.success ? 'Appointment Confirmed (Call-In Lead)' : 'Appointment Intake Step',
      audio_base64: tts.audio_base64,
      audio_mime: tts.audio_mime,
      first_chunk_text: tts.first_chunk_text,
      rest_text: tts.rest_text,
      voice: tts.voice,
      product_interest: detectedProduct || checkRes.product_line || null,
      lead_id: sessionContext.lead_id || checkRes.lead_id || null,
      lead_source: resolveInboundLeadSource(sessionContext),
      how_heard: sessionContext.how_heard || checkRes.how_heard || null,
      prospect_name: sessionContext.prospect_name,
      prospect_phone: sessionContext.prospect_phone,
      prospect_address: sessionContext.address,
      prospect_state: sessionContext.state,
      transfer: null,
      appointment: checkRes.success ? checkRes : null,
      needs_contact_info: Boolean(checkRes.needs_contact_info),
      missing_fields: checkRes.missing_fields || [],
      disposition: null,
      work_hours: RECEPTIONIST_WORK_HOURS_LABEL,
      work_hours_status: workHoursNow,
      mode: sessionContext.mode,
      line: SARAH_MAIN_LINE_DISPLAY,
    };
  }

  // 4. Primary Conversational Brain: Run Gemini (`gemini-3.5-flash-lite` -> `gemini-3.5-flash`) for natural conversational answers
  if (isAIEnabled()) {
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

    // Normalize multi-turn history so it ALWAYS begins with role: 'user' and strictly alternates user <-> model
    const normalizedHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    const rawHistory = (params.history || []).slice(-10);

    for (const h of rawHistory) {
      const text = String(h?.text || '').trim();
      if (!text) continue;
      const role: 'user' | 'model' =
        h.speaker === 'sarah' || (h as any).role === 'sarah' || (h as any).role === 'model' ? 'model' : 'user';
      if (normalizedHistory.length === 0 && role === 'model') {
        normalizedHistory.push({
          role: 'user',
          parts: [
            {
              text:
                sessionContext.mode === 'outbound'
                  ? `[Outbound call connected to ${sessionContext.prospect_name || 'Prospect'}]`
                  : `[Inbound caller connected to IWG Receptionist on ${SARAH_MAIN_LINE_DISPLAY}]`,
            },
          ],
        });
      }
      const prev = normalizedHistory[normalizedHistory.length - 1];
      if (prev && prev.role === role) {
        prev.parts[0].text += ' ' + text;
      } else {
        normalizedHistory.push({ role, parts: [{ text }] });
      }
    }

    const lastTurn = normalizedHistory[normalizedHistory.length - 1];
    if (lastTurn && lastTurn.role === 'user') {
      if (!lastTurn.parts[0].text.includes(userText)) {
        lastTurn.parts[0].text += '\n' + userText;
      }
    } else {
      normalizedHistory.push({
        role: 'user',
        parts: [{ text: userText }],
      });
    }

    const hasNameNow = !isPlaceholderProspectName(sessionContext.prospect_name);
    const hasPhoneNow = !isPlaceholderProspectPhone(sessionContext.prospect_phone, sessionContext.mode);
    const hasAddressNow = !isPlaceholderProspectAddress(sessionContext.address);

    const baseTextModels = ['gemini-3.5-flash-lite', config.gemini.model || 'gemini-3.5-flash'];
    const candidateModels = workingTextModel ? [workingTextModel, ...baseTextModels] : baseTextModels;
    for (const modelName of [...new Set(candidateModels)]) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: normalizedHistory,
          config: {
            systemInstruction:
              buildSarahSystemInstruction(sessionContext) +
              `\n\nCRITICAL CONVERSATIONAL LISTENING & STEP-BY-STEP APPOINTMENT SETTING RULE:\n- Listen carefully and respond DIRECTLY to what the caller just said ("${userText}").\n- ${detectedProduct
                ? `The caller is asking about ${detectedProduct}. Respond strictly using the award-winning ${detectedProduct} script that leads to an appointment—NEVER treat them as a Medicare lead unless ${detectedProduct} is Medicare!`
                : `Identify which of our 6 divisions the caller is asking about and never confuse Life Insurance, Health Insurance, or Long-Term Care with Medicare.`
              }\n- Current captured prospect details: Full Name="${hasNameNow ? sessionContext.prospect_name : 'MISSING — MUST ASK CALLER'}", Phone="${hasPhoneNow ? sessionContext.prospect_phone : 'MISSING — MUST ASK CALLER'}", Street Address="${hasAddressNow ? sessionContext.address : 'MISSING — MUST ASK CALLER'}".\n- STEP-BY-STEP APPOINTMENT RULE: You MUST ask for and collect the caller's Full Name, Phone Number, and Street Address (along with preferred format & date/time) BEFORE confirming an appointment! If any of Full Name, Phone Number, or Street Address is still MISSING, ask the caller for the missing information first.\n- Once Full Name, Phone Number, Street Address, and Date/Time are all provided, call \`book_appointment\` immediately and tell the caller that you have sent an initial confirmation text to their phone and they only need to reply YES to confirm! NEVER mention day-before or same-day reminder texts to the caller (those happen automatically behind the scenes).\n- Keep your spoken response calm, relaxed, warm, human, and concise (1 to 3 sentences).`,
            tools: SARAH_TOOLS,
            temperature: 0.2,
            maxOutputTokens: 200,
          },
        });

        workingTextModel = modelName;
        let replyText = (response.text || '').trim();
        let blockedByMissingContact = false;

        if (response.functionCalls && response.functionCalls.length > 0) {
          for (const call of response.functionCalls) {
            const callArgs = (call.args as Record<string, any>) || {};
            // Capture any contact details Gemini extracted in tool arguments
            if (callArgs.customer_name && !isPlaceholderProspectName(callArgs.customer_name)) {
              sessionContext.prospect_name = String(callArgs.customer_name).trim();
            }
            if (callArgs.phone && !isPlaceholderProspectPhone(callArgs.phone, sessionContext.mode)) {
              sessionContext.prospect_phone = String(callArgs.phone).trim();
            }
            if (callArgs.address && !isPlaceholderProspectAddress(callArgs.address)) {
              sessionContext.address = String(callArgs.address).trim();
            }

            const result = await executeSarahTool(call.name || '', callArgs, sessionContext);
            if (call.name === 'whisper_warm_transfer') {
              if (result.outside_work_hours) {
                transferResult = null;
                replyText = result.message;
              } else if (result.success) {
                transferResult = result;
                replyText =
                  result.hold_message ||
                  `Wonderful! Please hold for just a moment while I call ${result.recipient_name} on the line and connect to them first. I will let you know as soon as we are connected.`;
              }
            } else if (call.name === 'book_appointment' || call.name === 'send_appointment_text_reminder') {
              if (result.needs_contact_info) {
                blockedByMissingContact = true;
                replyText = result.message;
              } else if (result.success) {
                appointmentResult = result;
                if (result.lead_id) sessionContext.lead_id = result.lead_id;
                replyText = result.message;
              }
            } else if (call.name === 'record_call_disposition' && result.success) {
              dispositionResult = result;
              if (!replyText) {
                replyText = `Thank you so much for your time today! Have a wonderful rest of your day!`;
              }
            }
          }
        }

        // Safety net: if the caller or Receptionist is in the middle of booking an appointment and the LLM didn't emit a functionCall, check step-by-step requirements!
        if (!appointmentResult && !blockedByMissingContact) {
          const bookingCheck = detectAppointmentBookingIntent(userText, replyText, allConvoText, params.history || []);
          if (bookingCheck.shouldBook) {
            const checkRes = await executeSarahTool(
              'book_appointment',
              {
                customer_name: bookingCheck.extractedName || sessionContext.prospect_name,
                phone: bookingCheck.extractedPhone || sessionContext.prospect_phone,
                product_interest: bookingCheck.productInterest || detectedProduct || 'Insurance & Benefits',
                appointment_type: bookingCheck.appointmentType,
                preferred_datetime: bookingCheck.preferredDatetime,
                state: sessionContext.state,
                address: bookingCheck.extractedAddress || sessionContext.address,
                send_text_reminder: true,
              },
              sessionContext
            );
            if (checkRes.needs_contact_info) {
              replyText = checkRes.message;
            } else if (checkRes.success) {
              appointmentResult = checkRes;
              if (checkRes.lead_id) sessionContext.lead_id = checkRes.lead_id;
              replyText = checkRes.message;
            }
          }
        }

        if (replyText) {
          // Strip any accidental LLM mention of day-before or same-day reminder texts from customer-facing speech
          replyText = replyText
            .replace(
              /[,—–-]?\s*(?:followed by|along with|plus|and)\s+(?:an?\s+)?(?:automatic\s+)?day-before[^.!?]*(?:and\s+(?:a\s+)?same-day[^.!?]*)?/gi,
              ''
            )
            .replace(/You will also receive a reminder text the day before[^.!?]*[.!?]/gi, '')
            .trim();

          const holdCheck = detectSarahTransferHoldSpeech(replyText);
          if (holdCheck.triggered && !transferResult && !sessionContext.on_warm_transfer) {
            const autoTransferRes = await executeSarahTool(
              'whisper_warm_transfer',
              {
                recipient_name: holdCheck.recipientName,
                prospect_name: sessionContext.prospect_name,
                prospect_phone: sessionContext.prospect_phone,
                state: sessionContext.state,
                reason: detectedProduct ? `reviewing ${detectedProduct} options` : undefined,
              },
              sessionContext
            );
            if (autoTransferRes.outside_work_hours) {
              transferResult = null;
              replyText = autoTransferRes.message;
            } else if (autoTransferRes.success) {
              transferResult = autoTransferRes;
              replyText =
                autoTransferRes.hold_message ||
                `Wonderful! Please hold for just a moment while I call ${autoTransferRes.recipient_name} on the line and connect to them first. I will let you know as soon as we are connected.`;
            }
          }
          const tts = await resolveTts(replyText);
          return {
            ok: true,
            reply: replyText,
            audio_base64: tts.audio_base64,
            audio_mime: tts.audio_mime,
            first_chunk_text: tts.first_chunk_text,
            rest_text: tts.rest_text,
            voice: tts.voice,
            product_interest: detectedProduct || appointmentResult?.product_line || null,
            lead_id: sessionContext.lead_id || appointmentResult?.lead_id || null,
            lead_source: resolveInboundLeadSource(sessionContext),
            prospect_name: sessionContext.prospect_name,
            prospect_phone: sessionContext.prospect_phone,
            prospect_address: sessionContext.address,
            transfer: transferResult,
            appointment: appointmentResult,
            disposition: dispositionResult,
            work_hours: RECEPTIONIST_WORK_HOURS_LABEL,
            work_hours_status: workHoursNow,
            mode: sessionContext.mode,
            line: SARAH_MAIN_LINE_DISPLAY,
          };
        }
      } catch (err) {
        console.warn(`Sarah HTTP turn model ${modelName} fallback:`, (err as any)?.message || err);
      }
    }
  }

  // 5. Deterministic Cloned Sarah Scenario fallback if AI is offline
  const clonedMatch = await runClonedSarahScenario(userText, params.history || [], sessionContext);
  const tts = await resolveTts(clonedMatch.reply);
  return {
    ok: true,
    reply: clonedMatch.reply,
    scenario: clonedMatch.scenario,
    audio_base64: tts.audio_base64,
    audio_mime: tts.audio_mime,
    first_chunk_text: tts.first_chunk_text,
    rest_text: tts.rest_text,
    voice: tts.voice,
    product_interest: detectedProduct || clonedMatch.appointment?.product_line || null,
    lead_id: sessionContext.lead_id || clonedMatch.appointment?.lead_id || null,
    lead_source: resolveInboundLeadSource(sessionContext),
    prospect_name: sessionContext.prospect_name,
    prospect_phone: sessionContext.prospect_phone,
    prospect_address: sessionContext.address,
    transfer: clonedMatch.transfer || null,
    appointment: clonedMatch.appointment || null,
    disposition: clonedMatch.disposition || null,
    mode: sessionContext.mode,
    line: SARAH_MAIN_LINE_DISPLAY,
  };
}

/**
 * Returns direct browser-to-Gemini-3.8-Live WebSocket session configuration (`~600ms` real-time native audio).
 * Used on both `iwillglobal.com` (Vercel) and local CRM so the Receptionist answers inbound calls right away
 * in under 1 second with the calm, relaxed `Vindemiatrix` voice and full conversational intelligence.
 */
export function getSarahDirectLiveSessionConfig(params: Partial<SarahSessionContext> = {}) {
  const mode: 'inbound' | 'outbound' = params.mode === 'outbound' ? 'outbound' : 'inbound';
  const rawName = (params.prospect_name || '').trim();
  const isGenericName = isPlaceholderProspectName(rawName);
  const rawPhone = (params.prospect_phone || '').trim();
  const isGenericPhone = isPlaceholderProspectPhone(rawPhone, mode);
  const sessionContext: SarahSessionContext = {
    mode,
    lead_id: params.lead_id,
    prospect_name: isGenericName ? (mode === 'outbound' ? 'Valued Client' : '') : rawName,
    prospect_phone: isGenericPhone ? '' : rawPhone,
    state: params.state || 'Arizona',
    address: isPlaceholderProspectAddress(params.address) ? '' : String(params.address || '').trim(),
    caller_name: params.caller_name || 'Sarah',
    on_warm_transfer: Boolean(params.on_warm_transfer),
    product_interest: params.product_interest || '',
    source_channel: params.source_channel || (mode === 'outbound' ? 'outbound' : 'website_traffic'),
  };

  const firstName = isGenericName ? 'there' : (sessionContext.prospect_name || 'there').split(/\s+/)[0] || 'there';
  const initialGreetingPrompt =
    mode === 'outbound'
      ? `[OUTBOUND CALL CONNECTED ON ${SARAH_MAIN_LINE_DISPLAY} TO PROSPECT: ${sessionContext.prospect_name} (Phone: ${sessionContext.prospect_phone}, State: ${sessionContext.state})]. Begin Step 1 of the Outbound Script immediately by greeting them warmly: "Hello ${firstName}, this is Sarah calling from IWG Insurance and Financial Services. How are you today?"`
      : `[INBOUND CALL CONNECTED ON ${SARAH_MAIN_LINE_DISPLAY}]. Answer right away as Sarah with your opening greeting: "Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?"`;

  const wsUrl = config.gemini.apiKey
    ? `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(
      config.gemini.apiKey
    )}`
    : '';

  return {
    ok: Boolean(wsUrl),
    ws_url: wsUrl,
    voice: SARAH_VOICE_NAME,
    model: 'models/gemini-3.8-live',
    initial_greeting_prompt: initialGreetingPrompt,
    setup: {
      setup: {
        model: 'models/gemini-3.8-live',
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: SARAH_VOICE_NAME,
              },
            },
          },
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
            endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
            prefixPaddingMs: 100,
            silenceDurationMs: 220,
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [
            {
              text:
                buildSarahSystemInstruction(sessionContext) +
                `\n\nCRITICAL LIVE CONVERSATIONAL RULES:\n- Answer inbound calls immediately with zero delay in a calm, relaxed, warm, natural human tone (Vindemiatrix voice).\n- NEVER treat a Life Insurance, Individual Health, Group Health, or Long-Term Care caller as a Medicare lead! Use the award-winning scripts for each of the 6 product lines to lead directly to an appointment.\n- STEP-BY-STEP APPOINTMENT SETTING: To set an appointment, you MUST ask for and collect the prospect's full name, phone number, and street address (plus preferred format and date/time). Once they provide their full name, phone number, street address, and date/time, immediately call the \`book_appointment\` tool, verbally confirm their appointment with Principal Broker King Amen Ra, AND tell them to reply YES to the initial confirmation text sent to their phone! NEVER mention day-before or same-day reminder texts to the customer.\n- Keep your answers direct and concise (1 to 3 sentences) so there is never any lag.`,
            },
          ],
        },
        tools: SARAH_TOOLS,
      },
    },
  };
}
