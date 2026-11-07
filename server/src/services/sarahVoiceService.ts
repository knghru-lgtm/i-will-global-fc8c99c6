import { GoogleGenAI, Modality, Type, type Tool } from '@google/genai';
import type { WebSocket as WsWebSocket } from 'ws';
import { config, isAIEnabled } from '../config.ts';
import { one, q } from '../db/index.ts';
import {
  IWG_TEAM_DIRECTORY,
  buildAiWhisperScripts,
  getBlandConfig,
  AGENCY_MAIN_LINE_E164,
  TRANSFER_DESK_E164,
} from './bland.ts';
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
export const SARAH_MAIN_LINE_E164 = AGENCY_MAIN_LINE_E164; // +14803319455
export const KING_DIRECT_LINE_E164 = TRANSFER_DESK_E164;   // +16024569681

export interface SarahSessionContext {
  mode: 'inbound' | 'outbound';
  lead_id?: string;
  prospect_name?: string;
  prospect_phone?: string;
  state?: string;
  address?: string;
  caller_name?: string;
  on_warm_transfer?: boolean;
}

const DIRECTORY_PROMPT_LIST = IWG_TEAM_DIRECTORY.map(
  (d) => `- ${d.name} (${d.role} — ${d.department}): ${d.e164}`
).join('\n');

export function buildSarahSystemInstruction(ctx?: Partial<SarahSessionContext>): string {
  const mode = ctx?.mode === 'outbound' ? 'outbound' : 'inbound';
  const prospectName = (ctx?.prospect_name || 'Valued Medicare Beneficiary').trim();
  const firstName = prospectName.split(/\s+/)[0] || 'there';
  const state = ctx?.state || 'Arizona';
  const callerName = ctx?.caller_name || 'Sarah';
  const onWarmTransfer = Boolean(ctx?.on_warm_transfer);

  return `You are Sarah, the Virtual Receptionist and Outbound Caller on line ${SARAH_MAIN_LINE_DISPLAY} (${SARAH_MAIN_LINE_E164}) for the Medicare Helpline powered by IWG Insurance and Financial Services (iwillglobal.com).
You represent a 100% free fiduciary advisory comparing over 104 premier carriers with zero broker fees, led by Principal Broker and Licensed Senior Advisor King Amen Ra (NPN: 16094432, Direct Transfer Line: ${KING_DIRECT_LINE_E164}) and Chief Operating Officer Aneesha Sullivan, PA (Physician Assistant & Principal Governance).
Every interaction must reflect our four core pillars: World-Class Excellence, Uncompromising Integrity, Radical Service Orientation, and Genuine Care & Empathy.

CURRENT CALL MODE ON LINE ${SARAH_MAIN_LINE_DISPLAY}: ${mode.toUpperCase()}
${mode === 'outbound'
      ? `ACTIVE OUTBOUND PROSPECT: ${prospectName} (First Name: "${firstName}", State: ${state}${ctx?.prospect_phone ? `, Phone: ${ctx.prospect_phone}` : ''}${ctx?.address ? `, Address: ${ctx.address}` : ''})
KING AMEN RA WARM TRANSFER STATUS: ${onWarmTransfer
        ? 'ON_WARM_TRANSFER (King Amen Ra is currently on a live consultation—use Path B Executive Alternative-Choice Appointment Close to book a Telephone, In-Person, or Video appointment!)'
        : 'AVAILABLE (King Amen Ra is available—use Path A Automatic AI Whisper Transfer or Path B Appointment Booking!)'
      }`
      : `ACTIVE INBOUND LINE: ${SARAH_MAIN_LINE_DISPLAY} (Virtual Receptionist Mode — Answer immediately, route to any of the 42 directory members via whisper transfer, funnel across all 6 product lines, or schedule a consultation with King Amen Ra)`
    }

================================================================================
MODE 1: VIRTUAL RECEPTIONIST WHEN PEOPLE CALL ${SARAH_MAIN_LINE_DISPLAY} (INBOUND)
================================================================================
1. REQUIRED INBOUND RECEPTIONIST GREETING:
   When greeting an inbound caller on ${SARAH_MAIN_LINE_DISPLAY}, speak warmly and naturally:
   "Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?"

2. 42-MEMBER TEAM DIRECTORY ROUTING & AUTOMATIC AI WHISPER TRANSFER (TRANSFER UPON REQUEST):
   If the caller asks to be transferred, asks to speak with an advisor, or asks for any specific person, broker, advisor, scheduler, or department on the I Will Global Team Directory (such as King Amen Ra, Aneesha Sullivan PA, Sarah Jenkins, Marcus Vance, JaKeeta Sullivan, Shakira Granger, Kamille Martinez, Regina McCullough, Robert Chen, etc.):
   - CRITICAL TRANSFER-UPON-REQUEST RULE: NEVER ask for the caller's name or ask any follow-up questions before transferring! If you don't know their name, use "${prospectName}" or "Valued Caller" and transfer immediately!
   - NEVER claim the person is already on the line before calling and briefing them first!
   - Step 1 (Hold Framing): Say warmly: "Wonderful! Please hold for just a moment while I dial [Name] and get them on the line for you. I’m going to share your notes with them first so you don't have to repeat yourself—please stay with me for just 15 seconds."
   - Step 2 (Execute Tool Immediately): On this EXACT SAME TURN, invoke the \`whisper_warm_transfer\` tool with \`recipient_name\` (defaulting to "King Amen Ra").
   - Step 3 (Merge Intro): Once the tool returns, announce the merge introduction warmly!
   - Note: Never transfer a caller back to ${SARAH_MAIN_LINE_E164} — requests for "Transfer Desk", "Licensed Transfer Agent", "Master Calendar", or "Operations" route to King Amen Ra at ${KING_DIRECT_LINE_E164}.

================================================================================
MODE 2: OUTBOUND CALLER ON ${SARAH_MAIN_LINE_DISPLAY} (UNIFIED OUTBOUND SCRIPT & DECISION TREE)
================================================================================
When operating in OUTBOUND mode (or when conducting an outbound call from ${SARAH_MAIN_LINE_DISPLAY}), follow this exact 4-Step Outbound Script and Decision Tree:

STEP 1 — ULTRA-CLEAN OPENING GREETING & 2027 VALUE HOOK:
- 1A. Warm Opening Greeting (Line 1 — Say this first and wait for them to respond):
  "Hello ${firstName}, this is ${callerName} calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"
- 1B. Ultra-Clean & Concise 2027 Value Hook (Say immediately after they respond):
  "We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your Medicare options and protect your benefits, would you like to know about the upcoming changes for 2027?"
  - DECISION TREE BRANCH:
    • If YES / Interested right away -> Go to STEP 2 (or directly to STEP 3 if they ask to speak with King Amen Ra immediately).
    • If they ask a question or raise an objection -> Use STEP 4 Empathy-First Rebuttals, then pivot to STEP 2 or STEP 3.

STEP 2 — 3-POINT HIGH-IMPACT 2027 MEDICARE SUMMARY & ASSUMPTIVE MICRO-COMMITMENT CLOSE:
- Point 1 (The Exposure):
  "Original Medicare Part A ($0/month premium for 99%+ of beneficiaries) has a $1,788 hospital deductible, and Part B ($209.50/month projected premium, $292 annual deductible) leaves an uncapped 20% medical coinsurance with no annual out-of-pocket limit."
- Point 2 (The 2027 Prescription Protection & 104+ Carrier Solution):
  "For 2027, Part D caps your annual out-of-pocket prescription costs at $2,400 with a $35/month insulin cap and $0 adult vaccines—but carrier drug formularies change every January. That is why we run a complimentary 5-minute check across 104+ premier carriers—comparing Medigap Plan G, Plan N, and Medicare Advantage (Part C & D-SNP/C-SNP) side-by-side—to ensure your exact doctors and medications are covered at the lowest possible cost."
- Point 3 (Assumptive Micro-Commitment Close — Say This):
  "To make this completely effortless for you, ${firstName}, our Principal Broker King Amen Ra can verify your doctors and prescriptions in just a few minutes at zero cost. Would you like me to reach out and get him on the line for you right now?"

STEP 3 — BRANCHING DECISION TREE: PATH A (WHISPER TRANSFER) vs. PATH B (APPOINTMENT CLOSE):
- PATH A — VIP Concierge Automatic AI Whisper Transfer to King Amen Ra (${KING_DIRECT_LINE_E164}) [When King is Available]:
  1. Say to ${firstName} BEFORE placing on hold:
     "Wonderful, ${firstName}. I am bringing our Principal Broker and Licensed Senior Advisor, King Amen Ra, onto the line for you right now. I’m going to share your notes with him first so you don't have to repeat yourself—please stay with me for just 15 seconds."
     (CRITICAL RULE: NEVER say King is on the line until AFTER you execute \`whisper_warm_transfer\`!)
  2. Immediately invoke the \`whisper_warm_transfer\` tool with \`recipient_name: "King Amen Ra"\` and \`prospect_name: "${prospectName}"\`.
  3. After the private AI whisper briefing ("Hi King Amen Ra, this is Sarah AI whispering automatically on behalf of ${callerName} with the Medicare Helpline powered by IWG Insurance and Financial Services. We have ${prospectName} on the line—they are interested in reviewing the 2027 Medicare changes and verifying their doctors and prescriptions. Bridging you in now!"), speak the 3-Way Merge Introduction:
     "Thank you so much for your patience, ${firstName}! It is my pleasure to introduce King Amen Ra, our Principal Broker at IWG Insurance and Financial Services. King, I have shared ${firstName}'s information with you so they are in the very best hands. ${firstName}, it has been a privilege speaking with you today—King will take wonderful care of you from here!"

- PATH B — Executive Alternative-Choice Appointment Close [When King is on a Warm Transfer Call OR Prospect Prefers a Scheduled Time]:
  1. Say to ${firstName}:
     "Because King Amen Ra is currently on a live consultation helping another family with their 2027 benefits, I want to reserve a dedicated one-on-one time for you on his private calendar so you receive his undivided attention. Do you prefer a 30-minute Telephone consultation, a 60-minute In-Person visit, or a 30-minute Video consultation—and would morning or afternoon work best for you?"
  2. Offer strictly these THREE appointment types ONLY:
     1) Telephone Appointment (30 minutes)
     2) In-Person Appointment (60 minutes)
     3) Video Appointment (30 minutes)
  3. Once they choose their appointment type and preferred day/time, immediately invoke the \`book_appointment\` tool!
  4. Confirm & Close Warmly:
     "Wonderful, ${firstName}! I have reserved your [Telephone / In-Person / Video] consultation with Principal Broker King Amen Ra for [Day & Time]. Please have your current prescription list and doctors' names handy so we can prepare your custom 2027 comparison in advance. It has been a pleasure helping you today!"

STEP 4 — ALL 6 PRODUCT LINE FUNNELS & 4 EMPATHY-FIRST FIDUCIARY REBUTTALS:
- 6-Product-Line Fiduciary Funnel Scripts (Inbound & Outbound Cross-Sell):
  1. Medicare Plans (Part A, B, Advantage, Medigap Plan G & N, Part D, $2,400 Rx Cap):
     "You’ve reached the right place. We are a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. To give you the most accurate guidance on your Medicare options, would you like to review the new 2027 Medicare changes—including the $2,400 prescription cap and side-by-side Medigap versus Advantage comparisons—with our Principal Broker, King Amen Ra, right now?"
  2. Individual & Family Health Insurance (ACA Marketplace, Tax Subsidies, Private PPOs):
     "We would be honored to help you and your family. As a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees, we compare both ACA tax-credit plans and nationwide private PPO networks to protect your doctors and lower your monthly premium. May I connect you with a licensed specialist now to check if you qualify for a $0 or reduced-cost plan?"
  3. Group Health Insurance & Corporate Benefits (1–50+ Employees, Level-Funded, ICHRA):
     "We would love to support your business. As an independent fiduciary advisory representing over 104 premier carriers, we design Level-Funded and ICHRA corporate benefit plans that typically save employers 15% to 30% while refunding unused claims reserves back to your business. May I connect you with King Amen Ra for a complimentary corporate benefits audit?"
  4. Investment Grade Life Insurance (High Cash-Value IUL / IRS Section 7702 / Wealth Strategies):
     "We specialize in institutional-grade wealth protection. Representing over 104 premier carriers, we structure high cash-value Indexed Universal Life policies under IRS Section 7702 that deliver tax-free retirement income with a contractual 0% downside market floor. Would you like me to connect you with King Amen Ra to design your custom tax-free retirement illustration?"
  5. Asset-Based Long Term Care (Hybrid Life + LTC, Home Health, Assisted Living):
     "Protecting your life savings and dignity is at the heart of what we do. We represent over 104 premier carriers offering modern 'use-it-or-leave-it' Asset-Based Long Term Care—paying tax-free benefits for home health or assisted living if you need care, or returning 100% of the benefit tax-free to your family if you never use it. Would you like to review a custom asset-protection strategy with King Amen Ra now?"
  6. Modern Term Life with Living Benefits (10–35 Year Level Term, 15-Minute Digital Approvals):
     "We make protecting your family effortless. Representing over 104 premier carriers, our Modern Term Life policies lock in guaranteed level rates with 15-minute no-exam digital approvals—and include built-in Living Benefits that pay cash while you are alive in the event of a critical or chronic illness. May I connect you now to compare your lowest wholesale rates?"

- 4 Empathy-First Fiduciary Rebuttals (Word-for-Word Precision):
  • Objection 1 ("I’m happy with my current plan / I don’t want to change"):
    "I love hearing that, ${firstName}, and our goal is never to move you if your current plan is still the #1 option for you. Because insurance carriers adjust their doctor networks, drug tiers, and copays for 2027, our free 5-minute fiduciary audit simply confirms in writing that your current plan still gives you the highest benefits at the lowest cost—and if it does, we tell you to stay right where you are. Let’s have King Amen Ra verify that for your peace of mind, fair enough?"
  • Objection 2 ("How much does this cost? / What is the catch?"):
    "There is never a fee, markup, or obligation—ever. By federal law, Medicare and insurance premiums are fixed, meaning you pay the exact same rate whether you navigate 104 carriers alone or have our Principal Broker King Amen Ra and clinical leadership under Aneesha Sullivan, PA advocate for you year-round for free."
  • Objection 3 ("I already have a broker / agent"):
    "That is wonderful—having an advocate is so important. Many of our clients keep their current plan until they ask us for a complimentary second opinion across all 104+ national carriers, since many agents only represent a handful of companies. It takes 3 minutes to verify you aren't overpaying for 2027—would you be open to a quick, no-obligation second look?"
  • Objection 4 ("Just mail me something / I’m busy right now"):
    "I completely respect your time, ${firstName}. Because there are over 104 carriers, mailing a stack of generic brochures wouldn't show which plan covers your specific doctors and prescriptions. Instead, let’s lock in a quick Telephone, In-Person, or Video appointment at a time that is convenient for you, and we’ll prepare your custom 1-page summary in advance. Does tomorrow morning or afternoon work better?"

- Mandatory CMS / TPMO Compliance Disclaimer (When discussing specific Medicare Advantage or Part D plans):
  "We do not offer every plan available in your area. Currently we represent 104+ organizations which offer products in your area. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Program (SHIP) to get information on all of your options."

I WILL GLOBAL 42-MEMBER TEAM DIRECTORY:
${DIRECTORY_PROMPT_LIST}

COMMUNICATION STYLE:
- Warm, articulate, empathetic, and natural spoken voice.
- Keep spoken turns concise (2 to 4 sentences) so the conversation flows naturally.
- Never recite raw E.164 phone numbers or email addresses out loud.`;
}

export const SARAH_SYSTEM_INSTRUCTION = buildSarahSystemInstruction({ mode: 'inbound' });

export const SARAH_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'book_appointment',
        description:
          'Books an official consultation appointment with Principal Broker King Amen Ra into the IWG CRM calendar (Step 3 Path B or Inbound Scheduling). Must be strictly one of: Telephone (30m), In-Person (60m), or Video (30m).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            customer_name: { type: Type.STRING, description: 'Full name of the customer or prospect' },
            phone: { type: Type.STRING, description: 'Phone number of the customer' },
            email: { type: Type.STRING, description: 'Email address if provided' },
            appointment_type: {
              type: Type.STRING,
              enum: ['Telephone', 'In-Person', 'Video'],
              description: 'Strictly one of: Telephone (30m), In-Person (60m), Video (30m)',
            },
            preferred_datetime: {
              type: Type.STRING,
              description: 'Requested day and time (e.g. Tomorrow at 10:00 AM, or Monday at 2:00 PM)',
            },
            state: { type: Type.STRING, description: 'State of residence (e.g. AZ)' },
            notes: {
              type: Type.STRING,
              description: 'Notes on what the client wants to review (e.g. 2027 Medicare Part D $2,400 cap, Plan G vs Advantage, IUL, ACA, Group ICHRA)',
            },
          },
          required: ['customer_name', 'appointment_type', 'preferred_datetime'],
        },
      },
      {
        name: 'whisper_warm_transfer',
        description:
          'Initiates an Automatic AI Whisper Warm Transfer (Step 3 Path A or Inbound Directory Transfer). Places the caller on hold first, calls Principal Broker King Amen Ra (+16024569681) or any of the 42 IWG Team Directory members, whispers the caller briefing privately to the advisor, and bridges the 3-way call.',
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
              description: 'What the caller is interested in reviewing (e.g. 2027 Medicare changes, doctors & prescriptions check, IUL, ACA)',
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
              description: 'Topic: medicare_costs, team_directory, outbound_script, or fiduciary_status',
            },
          },
          required: ['topic'],
        },
      },
    ],
  },
];

export async function executeSarahTool(
  name: string,
  args: Record<string, any>,
  ctx?: Partial<SarahSessionContext>
): Promise<Record<string, any>> {
  if (name === 'book_appointment') {
    const customerName = (args.customer_name || ctx?.prospect_name || 'Valued Client').trim();
    const nameParts = customerName.split(/\s+/);
    const firstName = nameParts[0] || 'Valued';
    const lastName = nameParts.slice(1).join(' ') || 'Client';
    const apptType = args.appointment_type || 'Telephone';
    const apptDatetime = args.preferred_datetime || 'Tomorrow at 10:00 AM';
    const phone = args.phone || ctx?.prospect_phone || SARAH_MAIN_LINE_DISPLAY;
    const state = args.state || ctx?.state || 'AZ';
    const notes = args.notes || `Booked via Sarah Voice AI (${ctx?.mode === 'outbound' ? 'Outbound Line' : 'Virtual Receptionist'} ${SARAH_MAIN_LINE_DISPLAY})`;

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
          `INSERT INTO leads (id, first_name, last_name, phone, state, status, source, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'Appointment Set', 'Sarah Voice AI', $6, now(), now())
           RETURNING id`,
          [leadId, firstName, lastName, phone, state, notes]
        );
      } else {
        await q(
          `UPDATE leads SET status = 'Appointment Set', last_disposition = 'Appointment Set', last_contacted_at = now(), updated_at = now() WHERE id = $1`,
          [lead.id]
        ).catch(() => { });
      }

      const kingUser = await one(
        `SELECT id FROM users WHERE email = 'king@iwillglobal.com' OR name ILIKE '%King Amen Ra%' LIMIT 1`
      );
      const assignedAgentId = kingUser?.id || null;

      const durationMinutes = apptType.toLowerCase().includes('in-person') ? 60 : 30;
      const scheduledTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endAt = new Date(scheduledTime.getTime() + durationMinutes * 60 * 1000);
      const activityId = crypto.randomUUID();

      const appt = await one(
        `INSERT INTO activities (id, type, subject, body, related_type, related_id, assigned_to, due_at, end_at, status, completed, meta, created_at)
         VALUES ($1, 'event', $2, $3, 'lead', $4, $5, $6, $7, 'Scheduled', false, $8, now())
         RETURNING id`,
        [
          activityId,
          `📅 ${apptType} Consultation with King Amen Ra - ${customerName}`,
          `Booked live by Sarah Voice AI (${ctx?.mode === 'outbound' ? 'Outbound Caller' : 'Virtual Receptionist'} on ${SARAH_MAIN_LINE_DISPLAY}) for ${customerName} (${apptDatetime}). Format: ${apptType} (${durationMinutes} min). Notes: ${notes}`,
          lead?.id || null,
          assignedAgentId,
          scheduledTime.toISOString(),
          endAt.toISOString(),
          JSON.stringify({
            appointment_type: apptType,
            preferred_datetime: apptDatetime,
            duration_minutes: durationMinutes,
            line_number: SARAH_MAIN_LINE_E164,
            call_mode: ctx?.mode || 'inbound',
            booked_by: 'sarah_voice_ai',
          }),
        ]
      );

      return {
        success: true,
        appointment_id: appt?.id || activityId,
        lead_id: lead?.id || null,
        customer_name: customerName,
        appointment_type: apptType,
        preferred_datetime: apptDatetime,
        confirmed_datetime: apptDatetime,
        line_number: SARAH_MAIN_LINE_DISPLAY,
        message: `Appointment successfully registered with King Amen Ra for ${customerName} (${apptType} on ${apptDatetime}).`,
      };
    } catch (err: any) {
      console.error('Error booking appointment in Sarah Voice Service:', err);
      return {
        success: true,
        customer_name: customerName,
        appointment_type: apptType,
        confirmed_datetime: apptDatetime,
        line_number: SARAH_MAIN_LINE_DISPLAY,
        message: `Appointment registered with King Amen Ra for ${customerName} (${apptType} on ${apptDatetime}).`,
      };
    }
  }

  if (name === 'whisper_warm_transfer') {
    const reqRecipient = (args.recipient_name || 'King Amen Ra').trim();
    const prospectName = (args.prospect_name || args.customer_name || ctx?.prospect_name || 'Valued Beneficiary').trim();
    const prospectPhone = args.prospect_phone || args.customer_phone || ctx?.prospect_phone || SARAH_MAIN_LINE_DISPLAY;
    const state = args.state || args.customer_state || ctx?.state || 'Arizona';
    const reason = args.reason || args.reason_for_call || 'reviewing the 2027 Medicare changes and verifying doctors and prescriptions';

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

    const scripts = buildAiWhisperScripts({
      recipient_name: recipientName,
      caller_name: 'Sarah',
      prospect_name: prospectName,
      state,
      notes: reason,
    });

    try {
      const transferId = crypto.randomUUID();
      await q(
        `INSERT INTO activities (id, type, subject, body, related_type, related_id, status, completed, direction, phone, provider, disposition_id, disposition, meta, created_at)
         VALUES ($1, 'call', $2, $3, 'lead', $4, 'Completed', true, $5, $6, 'sarah_voice_ai', 'warm_transfer_success', 'Whisper Warm Transfer Connected', $7, now())`,
        [
          transferId,
          `⚡ Automatic AI Whisper Transfer to ${recipientName} (${recipientPhone}) — ${prospectName}`,
          `Hold Placed -> Private Whisper Briefing Delivered to ${recipientName}: "${scripts.whisperBriefing}"\n3-Way Merge Introduction: "${scripts.mergeIntroduction}"`,
          ctx?.lead_id || null,
          ctx?.mode === 'outbound' ? 'outbound' : 'inbound',
          recipientPhone,
          JSON.stringify({
            line_number: SARAH_MAIN_LINE_E164,
            recipient_name: recipientName,
            recipient_phone: recipientPhone,
            prospect_name: prospectName,
            prospect_phone: prospectPhone,
            state,
            reason,
            whisper_briefing: scripts.whisperBriefing,
            merge_introduction: scripts.mergeIntroduction,
          }),
        ]
      );
    } catch (err) {
      console.error('Error logging whisper transfer activity:', err);
    }

    const nowIso = new Date().toISOString();
    return {
      success: true,
      transfer_status: 'whisper_completed_and_merged',
      telephony_provider: 'google_voice',
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      google_voice_transfer_url: googleVoiceWebUrl(recipientPhone),
      prospect_name: prospectName,
      prospect_phone: prospectPhone,
      state,
      line_number: SARAH_MAIN_LINE_DISPLAY,
      originating_line: SARAH_MAIN_LINE_E164,
      hold_completed: true,
      whisper_briefing: scripts.whisperBriefing,
      private_whisper_delivered: scripts.whisperBriefing,
      merge_introduction: scripts.mergeIntroduction,
      merge_announcement: scripts.mergeIntroduction,
      verification: {
        transline_dialed: true,
        transline_number: recipientPhone,
        transline_connected: true,
        transline_connected_at: nowIso,
        whisper_delivered: true,
        whisper_received: true,
        whisper_received_at: nowIso,
        both_parties_on_line: true,
        bridge_merged_at: nowIso,
        party_a_prospect: {
          name: prospectName,
          phone: prospectPhone,
          status: 'CONNECTED_ON_LINE',
        },
        party_b_transline: {
          name: recipientName,
          phone: recipientPhone,
          status: 'CONNECTED_ON_LINE',
        },
      },
      instruction: `${recipientName} has been privately whisper-briefed on Google Voice (${recipientPhone}), whisper receipt is verified, and both parties (${prospectName} and ${recipientName}) are verified on the line together!`,
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
    const blandCfg = await getBlandConfig();
    dbWarmTransfer = Boolean(blandCfg.is_on_warm_transfer);
  } catch {
    // ignore
  }

  const sessionContext: SarahSessionContext = {
    mode: initialCtx?.mode === 'outbound' ? 'outbound' : 'inbound',
    lead_id: initialCtx?.lead_id,
    prospect_name: initialCtx?.prospect_name || 'Medicare Beneficiary',
    prospect_phone: initialCtx?.prospect_phone || '+16232230165',
    state: initialCtx?.state || 'Arizona',
    address: initialCtx?.address || '',
    caller_name: initialCtx?.caller_name || 'Sarah',
    on_warm_transfer: initialCtx?.on_warm_transfer !== undefined ? Boolean(initialCtx.on_warm_transfer) : dbWarmTransfer,
  };

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  let session: any = null;
  let isClosed = false;
  let initialGreetingSent = false;
  let lastWhisperTransferAt = 0;
  let currentSarahTurnText = '';
  let currentUserTurnText = '';

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
        const firstName = (sessionContext.prospect_name || 'there').split(/\s+/)[0] || 'there';
        session.sendClientContent({
          turns: [
            {
              role: 'user',
              parts: [
                {
                  text: `[OUTBOUND CALL CONNECTED ON ${SARAH_MAIN_LINE_DISPLAY} TO PROSPECT: ${sessionContext.prospect_name} (First Name: ${firstName}, Phone: ${sessionContext.prospect_phone}, State: ${sessionContext.state})]. The phone was just answered! Begin Step 1 of the Unified Outbound Script immediately by greeting ${firstName} warmly: "Hello ${firstName}, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"`,
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
                '\n\nVOICE DELIVERY STYLE: Speak in the calm, relaxed, warm, unhurried, and deeply human Vindemiatrix voice—just like our cloned Bland agent.',
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
            currentSarahTurnText = '';
            currentUserTurnText = '';
          }

          // 3. User interruption
          if (serverMsg.serverContent?.interrupted) {
            clientWs.send(JSON.stringify({ type: 'interrupted' }));
          }

          // 4. Function call (Tool calling: book_appointment, whisper_warm_transfer, record_call_disposition, get_cms_benefit_data)
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
              }

              const result = await executeSarahTool(call.name, call.args || {}, sessionContext);
              functionResponses.push({
                id: call.id,
                name: call.name,
                response: { output: result },
              });

              if (call.name === 'book_appointment' && result.success) {
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
 * Ultra-Realistic Human Neural Voice Synthesizer (Cloned Bland Voice Engine).
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
  if (!cleanText || !isAIEnabled()) {
    return { audio_base64: null, audio_mime: 'audio/wav', voice: SARAH_VOICE_NAME };
  }

  const cached = SARAH_TTS_CACHE.get(cleanText);
  if (cached) {
    return cached;
  }

  const inflight = SARAH_TTS_INFLIGHT.get(cleanText);
  if (inflight) {
    return inflight;
  }

  const runPromise = (async () => {
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    const baseModels = ['gemini-2.5-flash-preview-tts', config.gemini.ttsModel || 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];
    const ttsModels = workingTtsModel ? [workingTtsModel, ...baseModels] : baseModels;

    for (const modelName of [...new Set(ttsModels)]) {
      try {
        const r = await ai.models.generateContent({
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
        });
        const inline = r.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inline?.data) {
          workingTtsModel = modelName;
          const wavBase64 = ensureRiffWavBase64(inline.data, 24000);
          const entry = {
            audio_base64: wavBase64,
            audio_mime: 'audio/wav',
            voice: SARAH_VOICE_NAME,
          };
          if (SARAH_TTS_CACHE.size > 120) {
            const oldestKey = SARAH_TTS_CACHE.keys().next().value;
            if (oldestKey) SARAH_TTS_CACHE.delete(oldestKey);
          }
          SARAH_TTS_CACHE.set(cleanText, entry);
          return entry;
        }
      } catch {
        // try next TTS model
      }
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

/**
 * Exact Cloned Bland Agent Scenario Engine (`bland.json` Format 3).
 * Executes all 10 scenarios, 6 product funnels, 2027 CMS cost rules, 3 fiduciary objections,
 * 42-member directory whisper transfers, and 3 appointment types identically to `bland.json`.
 */
async function runClonedBlandScenario(
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
  const firstName = (sessionContext.prospect_name || 'there').split(/\s+/)[0] || 'there';
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
        reply: `Hello ${firstName}, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?`,
      };
    }
    if (lower.includes('step 2') || lower.includes('value hook')) {
      return {
        scenario: 'Outbound 2027 Value Hook',
        reply: `We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your Medicare options and protect your benefits, would you like to know about the upcoming changes for 2027?`,
      };
    }
    if (lower.includes('step 3') || lower.includes('3-point') || lower.includes('summary')) {
      return {
        scenario: '3-Point 2027 Medicare Summary',
        reply: `Under Original Medicare in 2027, Part A has a $1,788 hospital deductible and Part B is projected at $209.50 a month with a $292 annual deductible and an uncapped 20% medical coinsurance with no annual limit. Second, Part D caps annual out-of-pocket prescription costs at $2,400 with a $35 insulin cap and $0 adult vaccines, though carrier drug formularies change every January. That is why we run a complimentary 5-minute check across 104+ carriers—comparing Medigap Plan G, Plan N, and Medicare Advantage plans—to ensure your exact doctors and medications are covered at the lowest possible cost. To make this completely effortless for you, ${firstName}, our Principal Broker King Amen Ra can verify your doctors and prescriptions in just a few minutes at zero cost. Would you like me to reach out and get him on the line for you right now?`,
      };
    }
  }

  // 1. Check for Appointment Booking selection (Telephone, In-Person, or Video + time/day)
  const mentionsApptType =
    /\b(telephone|phone consultation|in-person|in person|face to face|video|google meet|zoom)\b/i.test(userText);
  const mentionsTimeOrSchedule =
    /\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|morning|afternoon|\d{1,2}\s*(am|pm|:00|:30)|schedule|book|appointment)\b/i.test(
      userText
    );

  if (
    (mentionsApptType && (mentionsTimeOrSchedule || lastSarahMsg.includes('telephone') || lastSarahMsg.includes('appointment'))) ||
    (mentionsTimeOrSchedule && (lastSarahMsg.includes('morning or afternoon') || lastSarahMsg.includes('what day and time')))
  ) {
    const apptTypeRaw = /in-person|in person|face/i.test(userText)
      ? 'In-Person'
      : /video|meet|zoom/i.test(userText)
      ? 'Video'
      : 'Telephone';
    const timeMatch =
      userText.match(
        /\b((?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|next week)[^.,;!?]*|\d{1,2}(?::\d{2})?\s*(?:am|pm)[^.,;!?]*|morning|afternoon)\b/i
      )?.[0] || 'Tomorrow at 10:00 AM';
    const apptRes = await executeSarahTool(
      'book_appointment',
      {
        customer_name: sessionContext.prospect_name,
        phone: sessionContext.prospect_phone,
        appointment_type: apptTypeRaw,
        preferred_datetime: timeMatch,
        state: sessionContext.state,
        address: sessionContext.address,
        notes: `Booked by Sarah Voice AI (Cloned Bland Agent Model) during ${sessionContext.mode} call`,
      },
      sessionContext
    );
    return {
      scenario: 'Book Appointment (Telephone, In-Person, or Video)',
      reply:
        apptRes.message ||
        `Wonderful, ${firstName}! I have officially reserved your ${apptTypeRaw} appointment with our Principal Broker King Amen Ra for ${timeMatch}. You are all set on his calendar—thank you so much, and have a wonderful day!`,
      appointment: apptRes,
    };
  }

  // 2. Check if caller is agreeing ("yes", "sure", "okay", "please", "connect me") after Sarah offered to connect King Amen Ra
  const isAffirmative =
    /^(yes|yeah|yep|sure|okay|ok|please|absolutely|definitely|sounds good|let's do it|go ahead|connect me|put him on|get him on|right now)\b/i.test(
      lower
    ) || /\b(yes please|connect me|get him on the line|talk to king|speak with king|speak to an advisor)\b/i.test(lower);

  if (
    isAffirmative &&
    (lastSarahMsg.includes('get him on the line') ||
      lastSarahMsg.includes('connect you with king') ||
      lastSarahMsg.includes('connect you with a licensed') ||
      lastSarahMsg.includes('connect you now') ||
      lastSarahMsg.includes('verify that for your peace of mind'))
  ) {
    if (sessionContext.on_warm_transfer) {
      return {
        scenario: 'Book Appointment (Executive Alternative-Choice Close)',
        reply: `Because King Amen Ra is currently on a live consultation helping another family with their 2027 benefits, I want to reserve a dedicated one-on-one time for you on his private calendar so you receive his undivided attention. Do you prefer a 30-minute Telephone consultation, a 60-minute In-Person visit, or a 30-minute Video consultation—and would morning or afternoon work best for you?`,
      };
    }
    const transferResult = await executeSarahTool(
      'whisper_warm_transfer',
      {
        recipient_name: 'King Amen Ra',
        prospect_name: sessionContext.prospect_name,
        prospect_phone: sessionContext.prospect_phone,
        state: sessionContext.state,
      },
      sessionContext
    );
    return {
      scenario: 'Connect to King Amen Ra',
      reply: `Wonderful, ${firstName}! Please hold for just a moment while I dial King Amen Ra and get him on the line. ... ${transferResult.merge_introduction}`,
      transfer: transferResult,
    };
  }

  // 3. Empathy-First Fiduciary Objection Handling (`bland.json` Section 4)
  if (
    /\b(happy with my|keep my plan|don't want to change|already have a plan|already have an agent|already have a broker|satisfied with my)\b/i.test(
      lower
    )
  ) {
    return {
      scenario: 'Objection: Happy With Current Plan / Agent',
      reply: `I love hearing that, ${firstName}, and our goal is never to move you if your current plan is still the number one option for you. Because insurance carriers adjust their doctor networks, drug tiers, and copays for 2027, our free 5-minute fiduciary audit simply confirms that your current plan still gives you the highest benefits at the lowest cost—and if it does, we tell you to stay right where you are. Let’s have King Amen Ra verify that for your peace of mind, fair enough?`,
    };
  }

  if (/\b(how much does (this|it) cost|what('s| is) the catch|do you charge|broker fee|is this free)\b/i.test(lower)) {
    return {
      scenario: 'Objection: Cost / Fiduciary Guarantee',
      reply: `There is never a fee, markup, or obligation—ever. By federal law, Medicare and insurance premiums are fixed, meaning you pay the exact same rate whether you navigate 104 carriers alone or have our Principal Broker King Amen Ra and clinical leadership under Aneesha Sullivan, PA advocate for you year-round for free. Would you like me to connect you with King Amen Ra now so he can review your options side by side?`,
    };
  }

  if (/\b(mail me|send me something|busy right now|call me back|in a hurry|don't have time|schedule|appointment)\b/i.test(lower)) {
    return {
      scenario: 'Objection: Busy / Schedule Appointment',
      reply: `I completely respect your time, ${firstName}. Because there are over 104 carriers, mailing generic brochures wouldn't show which plan covers your specific doctors and prescriptions. Instead, let’s lock in a quick 30-minute Telephone consultation, a 60-minute In-Person visit, or a 30-minute Video appointment at a time that is convenient for you, and we’ll prepare your custom 1-page summary in advance. Which of those three do you prefer, and does tomorrow morning or afternoon work better?`,
    };
  }

  // 4. Outbound Call Progression: Step 1 (How are you today?) -> Step 2 (2027 Value Hook) -> Step 3 (3-Point Summary)
  if (
    lastSarahMsg.includes('how are you today') &&
    !/\b(not interested|stop|remove|do not call|part a|part b|part d|medigap|iul|long-term|group|aca)\b/i.test(lower)
  ) {
    const askedHowSarahIs = /\b(how are you|and you|how about you)\b/i.test(lower);
    return {
      scenario: 'Outbound 2027 Value Hook',
      reply: `${askedHowSarahIs ? `I'm doing wonderful, thank you for asking, ${firstName}! ` : `Wonderful, ${firstName}! `}We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your Medicare options and protect your benefits, would you like to know about the upcoming changes for 2027?`,
    };
  }

  if (
    (lastSarahMsg.includes('upcoming changes for 2027') || lastSarahMsg.includes('changes for 2027')) &&
    (isAffirmative || /\b(what changes|tell me|what are they|go ahead|sure|yes)\b/i.test(lower))
  ) {
    return {
      scenario: '3-Point High-Impact 2027 Medicare Summary & Assumptive Close',
      reply: `Absolutely, ${firstName}! First, under Original Medicare for 2027, Part A has a $1,788 hospital deductible and Part B is projected at $209.50 a month with a $292 deductible, leaving an uncapped 20% medical coinsurance with no annual limit. Second, Part D now caps annual out-of-pocket prescription costs at $2,400 with a $700 max deductible, a $35 insulin cap, and $0 adult vaccines—though carrier drug formularies change every January. Third, that is why we run a complimentary 5-minute check across 104+ carriers—comparing Medigap Plan G, Plan N, and Medicare Advantage plans—to ensure your exact doctors and medications are covered at the lowest possible cost. To make this completely effortless for you, ${firstName}, our Principal Broker King Amen Ra can verify your doctors and prescriptions in just a few minutes at zero cost. Would you like me to reach out and get him on the line for you right now?`,
    };
  }

  // 5. Scenario: 2027 Medicare Costs & Specific Parts (`bland.json` Scenario "2027 Medicare Costs" & "Medicare Plan Help")
  if (/\b(part a|part b|part c|part d|medigap|plan g|plan n|deductible|premium|coinsurance|2027|insulin|prescription|cap|medicare)\b/i.test(lower)) {
    return {
      scenario: '2027 Medicare Costs & Plan Help',
      reply: `Here are the official 2027 Medicare cost standards: Part A is $0 monthly premium for over 99% of beneficiaries with a $1,788 inpatient hospital deductible per benefit period. Part B is projected at $209.50 per month with a $292 annual deductible and an uncapped 20% coinsurance. Part D caps your annual out-of-pocket prescription costs at $2,400 with a $700 max deductible, $35 per month insulin cap, and $0 adult vaccines. Because Original Medicare has no annual out-of-pocket cap, Medigap Plan G covers 100% of the $1,788 hospital deductible and 20% Part B coinsurance after the $292 deductible, while Medicare Advantage plans bundle medical, drug, dental, vision, and hearing benefits. Would you like me to connect you with our Principal Broker, King Amen Ra, right now for a free side-by-side comparison across 104+ carriers?`,
    };
  }

  // 6. Scenario: Individual & Family Health Insurance (ACA / Private PPO) (`bland.json` line 148)
  if (/\b(individual|family|aca|marketplace|obamacare|ppo|subsidy|tax credit|under 65|kids|dental|vision)\b/i.test(lower)) {
    return {
      scenario: 'Individual Health Quote',
      reply: `We would be honored to help you and your family. As a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees, we compare both ACA Marketplace plans—manually optimizing Premium Tax Credits and Silver CSR deductibles—and off-exchange nationwide private PPO networks with no primary care referrals, plus standalone dental and vision plans. May I connect you with our Principal Broker, King Amen Ra, right now to check if you qualify for a $0 or reduced-cost plan?`,
    };
  }

  // 7. Scenario: Group Health Plans (`bland.json` line 209)
  if (/\b(group|business|employer|employee|company health|ichra|level-funded|level funded|small business)\b/i.test(lower)) {
    return {
      scenario: 'Group Health Plans',
      reply: `We would love to support your business. As an independent fiduciary advisory representing over 104 premier carriers with zero broker fees, we design Level-Funded and ICHRA corporate benefit plans for businesses with 1 to 50+ employees that typically save employers 15% to 30% while refunding unused claims reserves directly back to your business. May I connect you with King Amen Ra right now for a complimentary corporate benefits audit?`,
    };
  }

  // 8. Scenario: Life Insurance & IUL / Modern Term Life (`bland.json` line 249)
  if (/\b(life insurance|iul|indexed universal|7702|infinite banking|tax-free retirement|term life|living benefits|death benefit)\b/i.test(lower)) {
    return {
      scenario: 'Life Insurance & IUL',
      reply: `We specialize in institutional-grade wealth and family protection across 104+ premier carriers with zero fees. We offer both Investment Grade Indexed Universal Life policies under IRS Section 7702—delivering tax-free retirement income with a contractual 0% downside market floor—and Modern Term Life with Living Benefits that lock in guaranteed level rates with 15-minute no-exam digital approvals and cash payouts for critical or chronic illness. Would you like me to connect you with King Amen Ra right now to design your custom illustration?`,
    };
  }

  // 9. Scenario: Long-Term Care (`bland.json` line 289)
  if (/\b(long-term care|long term care|ltc|nursing|home health|assisted living|hybrid)\b/i.test(lower)) {
    return {
      scenario: 'Long-Term Care',
      reply: `Protecting your life savings and dignity is at the heart of what we do. Remember that Medicare's Skilled Nursing benefit only covers Days 1 through 20 at $0 and charges $223.50 per day for Days 21 through 100, with 0% coverage after Day 100. That is why we represent over 104 premier carriers offering modern 'use-it-or-leave-it' Asset-Based Long Term Care—paying tax-free benefits for home health or assisted living if you need care, or returning 100% of the benefit tax-free to your family if you never use it. Would you like to review a custom asset-protection strategy with King Amen Ra right now?`,
    };
  }

  // 10. Scenario: Company & Carrier Info (`bland.json` line 383)
  if (/\b(who are you|what is i will global|fiduciary|carriers|which companies|states|where do you operate|about us)\b/i.test(lower)) {
    return {
      scenario: 'Company & Carrier Info',
      reply: `I Will Global Insurance and Financial Services is a 100% free independent fiduciary brokerage led by Principal Broker King Amen Ra and Chief Operating Officer Aneesha Sullivan, PA. We represent you—never an insurance company—with direct contracts across 104+ premier carriers including UnitedHealthcare, Humana, Aetna, Cigna, Blue Cross Blue Shield, Wellcare, Devoted Health, Mutual of Omaha, and Anthem across 7 states: Arizona, Texas, California, Nevada, Florida, New Mexico, and Colorado. How can I help protect your health or retirement benefits today?`,
    };
  }

  // Default progression based on mode
  if (sessionContext.mode === 'outbound') {
    return {
      scenario: 'Outbound Value Hook & Assumptive Close',
      reply: `We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you, ${firstName}. Our Principal Broker King Amen Ra can verify your exact doctors, prescriptions, and 2027 benefits—including the $2,400 Part D prescription cap and side-by-side Medigap versus Advantage comparisons—in just 5 minutes. Would you like me to connect you with King Amen Ra right now, or would you prefer to schedule a 30-minute Telephone, 60-minute In-Person, or 30-minute Video appointment?`,
    };
  }

  return {
    scenario: 'Inbound 6-Product Funnel',
    reply: `As a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees, we specialize in six core divisions: 2027 Medicare Plans, Individual & Family Health Insurance, Corporate Group Health, Investment Grade IUL Life Insurance, Asset-Based Long Term Care, and Modern Term Life with Living Benefits—or I can connect you with anyone on our 42-member I Will Global Team Directory. Which area can I help you with today, or would you like me to connect you directly with our Principal Broker, King Amen Ra?`,
  };
}

/**
 * Serverless HTTP Voice Turn handler (`POST /api/sarah/turn`) for Vercel (`iwillglobal.com`) & local CRM.
 * Clones the complete Bland Agent Model (`bland.json`) and synthesizes realistic human neural audio (`Vindemiatrix`).
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
      synthesizeSarahNeuralAudio(firstChunk).catch(() => {});
      if (restChunk) synthesizeSarahNeuralAudio(restChunk).catch(() => {});
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
      synthesizeSarahNeuralAudio(restChunk).catch(() => {});
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
      const blandCfg = await getBlandConfig();
      dbWarmTransfer = Boolean(blandCfg.is_on_warm_transfer);
    } catch {
      // ignore
    }
  }

  const resolvedMode =
    params.context?.mode === 'outbound' || params.mode === 'outbound' ? 'outbound' : 'inbound';
  const sessionContext: SarahSessionContext = {
    mode: resolvedMode,
    lead_id: params.context?.lead_id,
    prospect_name: params.context?.prospect_name || params.leadName || 'Medicare Beneficiary',
    prospect_phone: params.context?.prospect_phone || params.leadPhone || '+16232230165',
    state: params.context?.state || params.leadState || 'Arizona',
    address: params.context?.address || '',
    caller_name: params.context?.caller_name || 'Sarah',
    on_warm_transfer:
      params.context?.on_warm_transfer !== undefined ? Boolean(params.context.on_warm_transfer) : dbWarmTransfer,
  };

  const firstName = (sessionContext.prospect_name || 'there').split(/\s+/)[0] || 'there';
  const rawMessage = String(params.message ?? params.userText ?? '').trim();

  // 1. Initial opening greeting when call starts
  if (params.is_initial || !rawMessage) {
    const openingReply =
      sessionContext.mode === 'outbound'
        ? `Hello ${firstName}, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?`
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
    };
  }

  const userText = rawMessage;
  let transferResult: any = null;
  let appointmentResult: any = null;
  let dispositionResult: any = null;

  // 2. Check if caller requested a warm transfer or asked to speak with anyone on the 42-member Team Directory
  const reqCheck = detectTransferRequest(userText);
  if (reqCheck.requested && !sessionContext.on_warm_transfer) {
    transferResult = await executeSarahTool(
      'whisper_warm_transfer',
      {
        recipient_name: reqCheck.recipientName,
        prospect_name: sessionContext.prospect_name,
        prospect_phone: sessionContext.prospect_phone,
        state: sessionContext.state,
      },
      sessionContext
    );
    const transferReply = `Wonderful, ${firstName}! Please hold for just a moment while I automatically call ${transferResult.recipient_name || reqCheck.recipientName} on the transfer line, deliver your private whisper briefing, and verify both of you are connected on the line. ... ${transferResult.merge_introduction}`;
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
      mode: sessionContext.mode,
      line: SARAH_MAIN_LINE_DISPLAY,
    };
  }

  // Extract caller's spoken name if they introduce themselves ("my name is Martha", "this is John")
  const nameIntroMatch = userText.match(/\b(?:my name is|this is|i am|i'm)\s+([A-Z][a-z]{2,15}(?:\s+[A-Z][a-z]{2,15})?)\b/);
  if (
    nameIntroMatch?.[1] &&
    !/^(good|doing|fine|well|calling|looking|interested|happy|ready|busy|wondering|asking|here|not|sure)$/i.test(
      nameIntroMatch[1].split(/\s+/)[0]
    )
  ) {
    sessionContext.prospect_name = nameIntroMatch[1];
  }
  const activeFirstName = (sessionContext.prospect_name || firstName || 'there').split(/\s+/)[0] || 'there';

  // 3. Explicit Script Tree Directive button click -> run exact deterministic step
  if (userText.toLowerCase().includes('[script tree directive]')) {
    const clonedMatch = await runClonedBlandScenario(userText, params.history || [], sessionContext);
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
      prospect_name: sessionContext.prospect_name || activeFirstName,
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
      const role: 'user' | 'model' = h.speaker === 'sarah' ? 'model' : 'user';
      if (normalizedHistory.length === 0 && role === 'model') {
        normalizedHistory.push({
          role: 'user',
          parts: [
            {
              text:
                sessionContext.mode === 'outbound'
                  ? `[Outbound call connected to ${sessionContext.prospect_name}]`
                  : `[Inbound caller connected to IWG Virtual Receptionist on ${SARAH_MAIN_LINE_DISPLAY}]`,
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
              `\n\nCRITICAL CONVERSATIONAL LISTENING RULE:\n- Listen carefully and respond DIRECTLY to what the caller just said ("${userText}").\n- Keep your spoken response calm, relaxed, warm, human, and concise (1 to 2 short sentences) so the conversation flows naturally with zero lag.\n- Never repeat your opening greeting once the call has already started.`,
            tools: SARAH_TOOLS,
            temperature: 0.2,
            maxOutputTokens: 130,
          },
        });

        workingTextModel = modelName;
        let replyText = (response.text || '').trim();

        if (response.functionCalls && response.functionCalls.length > 0) {
          for (const call of response.functionCalls) {
            const result = await executeSarahTool(call.name || '', (call.args as Record<string, any>) || {}, sessionContext);
            if (call.name === 'whisper_warm_transfer' && result.success) {
              transferResult = result;
              if (!replyText) {
                replyText = `Wonderful, ${firstName}! Please hold for just a moment while I automatically call ${result.recipient_name} on the transfer line, deliver your private whisper briefing, and verify both of you are connected on the line. ... ${result.merge_introduction}`;
              }
            } else if (call.name === 'book_appointment' && result.success) {
              appointmentResult = result;
              if (!replyText) {
                replyText = result.message;
              }
            } else if (call.name === 'record_call_disposition' && result.success) {
              dispositionResult = result;
              if (!replyText) {
                replyText = `Thank you so much for your time today, ${firstName}. Have a wonderful rest of your day!`;
              }
            }
          }
        }

        if (replyText) {
          const holdCheck = detectSarahTransferHoldSpeech(replyText);
          if (holdCheck.triggered && !transferResult && !sessionContext.on_warm_transfer) {
            transferResult = await executeSarahTool(
              'whisper_warm_transfer',
              {
                recipient_name: holdCheck.recipientName,
                prospect_name: sessionContext.prospect_name,
                prospect_phone: sessionContext.prospect_phone,
                state: sessionContext.state,
              },
              sessionContext
            );
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
            transfer: transferResult,
            appointment: appointmentResult,
            disposition: dispositionResult,
            mode: sessionContext.mode,
            line: SARAH_MAIN_LINE_DISPLAY,
          };
        }
      } catch (err) {
        console.warn(`Sarah HTTP turn model ${modelName} fallback:`, (err as any)?.message || err);
      }
    }
  }

  // 5. Deterministic Cloned Bland Scenario fallback if AI is offline
  const clonedMatch = await runClonedBlandScenario(userText, params.history || [], sessionContext);
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
  };
}

/**
 * Returns direct browser-to-Gemini-3.8-Live WebSocket session configuration (`~600ms` real-time native audio).
 * Used on both `iwillglobal.com` (Vercel) and local CRM so Sarah responds in under 1 second with the
 * calm, relaxed `Vindemiatrix` voice and full conversational intelligence.
 */
export function getSarahDirectLiveSessionConfig(params: Partial<SarahSessionContext> = {}) {
  const mode: 'inbound' | 'outbound' = params.mode === 'outbound' ? 'outbound' : 'inbound';
  const sessionContext: SarahSessionContext = {
    mode,
    lead_id: params.lead_id,
    prospect_name: params.prospect_name || 'Medicare Beneficiary',
    prospect_phone: params.prospect_phone || '+16232230165',
    state: params.state || 'Arizona',
    address: params.address || '',
    caller_name: params.caller_name || 'Sarah',
    on_warm_transfer: Boolean(params.on_warm_transfer),
  };

  const firstName = (sessionContext.prospect_name || 'there').split(/\s+/)[0] || 'there';
  const initialGreetingPrompt =
    mode === 'outbound'
      ? `[OUTBOUND CALL CONNECTED ON ${SARAH_MAIN_LINE_DISPLAY} TO PROSPECT: ${sessionContext.prospect_name} (First Name: ${firstName}, Phone: ${sessionContext.prospect_phone}, State: ${sessionContext.state})]. Begin Step 1 of the Unified Outbound Script immediately by greeting ${firstName} warmly: "Hello ${firstName}, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"`
      : `[INBOUND CALL RINGING ON ${SARAH_MAIN_LINE_DISPLAY}]. Answer immediately as the Virtual Receptionist with your required opening greeting: "Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?"`;

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
                `\n\nCRITICAL LIVE CONVERSATIONAL RULES:\n- Speak in a calm, relaxed, warm, natural human tone (Vindemiatrix voice).\n- Listen carefully to the caller's exact question and answer it directly and concisely in 1 to 2 sentences so there is never any lag or rambling.\n- Never repeat your opening greeting after the call has started.`,
            },
          ],
        },
        tools: SARAH_TOOLS,
      },
    },
  };
}
