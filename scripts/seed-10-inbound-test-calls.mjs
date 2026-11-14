import assert from 'node:assert/strict';

const TARGET_BASE = process.env.SARAH_TEST_BASE_URL || 'http://127.0.0.1:4000';

const TEN_INBOUND_CUSTOMERS = [
  {
    num: 1,
    name: 'Marcus Vance',
    phone: '(480) 555-0201',
    address: '7420 E Camelback Rd, Scottsdale, AZ 85251',
    state: 'AZ',
    product: 'Medicare Advantage',
    apptType: 'Telephone',
    apptTime: 'Monday at 9:30 AM',
    howHeard: 'Google Search',
    simIso: '2026-11-16T09:15:00-07:00',
    openingQuestion: 'Hi Sarah, I am turning 65 soon and want to compare Medicare Advantage plans with Part B giveback.',
  },
  {
    num: 2,
    name: 'Elena Rostova',
    phone: '(602) 555-0202',
    address: '2150 E Highland Ave, Phoenix, AZ 85016',
    state: 'AZ',
    product: 'Investment Grade Life Insurance (High Cash-Value IUL)',
    apptType: 'Video',
    apptTime: 'Tuesday at 11:00 AM',
    howHeard: 'Client Referral',
    simIso: '2026-11-17T10:30:00-07:00',
    openingQuestion: 'Hello Sarah, I would like information on a high cash-value Indexed Universal Life policy for tax-free retirement.',
  },
  {
    num: 3,
    name: 'Darnell Washington',
    phone: '(480) 555-0203',
    address: '1840 S Stapley Dr, Mesa, AZ 85204',
    state: 'AZ',
    product: 'Fixed Indexed Annuities & Retirement Income',
    apptType: 'In-Person',
    apptTime: 'Wednesday at 2:00 PM',
    howHeard: 'YouTube',
    simIso: '2026-11-18T11:00:00-07:00',
    openingQuestion: 'Hi Sarah, I have an old 401k I want to roll into a principal-protected Fixed Indexed Annuity.',
  },
  {
    num: 4,
    name: 'Priya Patel',
    phone: '(623) 555-0204',
    address: '9210 W Peoria Ave, Peoria, AZ 85345',
    state: 'AZ',
    product: 'ACA / Individual & Family Health Insurance',
    apptType: 'Telephone',
    apptTime: 'Thursday at 10:00 AM',
    howHeard: 'Website',
    simIso: '2026-11-19T09:45:00-07:00',
    openingQuestion: 'Hi Sarah, my family needs an individual and family health insurance plan for next year.',
  },
  {
    num: 5,
    name: 'Thomas Callahan',
    phone: '(480) 555-0205',
    address: '3185 W Frye Rd, Chandler, AZ 85226',
    state: 'AZ',
    product: 'Medicare Supplement (Medigap Plan G)',
    apptType: 'Telephone',
    apptTime: 'Friday at 1:30 PM',
    howHeard: 'Direct Mail Postcard',
    simIso: '2026-11-20T13:00:00-07:00',
    openingQuestion: 'Hello Sarah, I want to compare Medicare Supplement Plan G rates with zero broker fees.',
  },
  {
    num: 6,
    name: 'Sofia Morales',
    phone: '(602) 555-0206',
    address: '4512 N 16th St, Phoenix, AZ 85016',
    state: 'AZ',
    product: 'Final Expense & Whole Life Insurance',
    apptType: 'Telephone',
    apptTime: 'Monday at 2:30 PM',
    howHeard: 'Facebook',
    simIso: '2026-11-16T14:00:00-07:00',
    openingQuestion: 'Hi Sarah, I am looking for a Final Expense whole life policy for my mother in Phoenix.',
  },
  {
    num: 7,
    name: 'Nathan Brooks',
    phone: '(480) 555-0207',
    address: '600 S Mill Ave, Tempe, AZ 85281',
    state: 'AZ',
    product: 'Small Business Group Health & Employee Benefits',
    apptType: 'Video',
    apptTime: 'Tuesday at 3:00 PM',
    howHeard: 'Chamber of Commerce',
    simIso: '2026-11-17T15:10:00-07:00',
    openingQuestion: 'Hi Sarah, I own a 14-employee company in Tempe and need quotes for small business group health benefits.',
  },
  {
    num: 8,
    name: 'Carmen Delgado',
    phone: '(520) 555-0208',
    address: '4780 E Grant Rd, Tucson, AZ 85712',
    state: 'AZ',
    product: 'Dental, Vision & Hearing Insurance',
    apptType: 'Telephone',
    apptTime: 'Wednesday at 10:30 AM',
    howHeard: 'Friend Referral',
    simIso: '2026-11-18T10:15:00-07:00',
    openingQuestion: 'Hello Sarah, I need a comprehensive Dental, Vision, and Hearing plan with implant coverage.',
  },
  {
    num: 9,
    name: 'Gregory Sterling',
    phone: '(928) 555-0209',
    address: '1240 W Iron Springs Rd, Prescott, AZ 86305',
    state: 'AZ',
    product: 'Hospital Indemnity & Critical Illness Protection',
    apptType: 'Telephone',
    apptTime: 'Thursday at 1:00 PM',
    howHeard: 'Google Maps',
    simIso: '2026-11-19T13:20:00-07:00',
    openingQuestion: 'Hi Sarah, I want to add a Hospital Indemnity and Critical Illness plan alongside my Medicare coverage.',
  },
  {
    num: 10,
    name: 'Hannah Kim',
    phone: '(480) 555-0210',
    address: '15345 N Scottsdale Rd, Scottsdale, AZ 85254',
    state: 'AZ',
    product: 'Estate, Trust & Legacy Wealth Protection',
    apptType: 'In-Person',
    apptTime: 'Friday at 10:30 AM',
    howHeard: 'LinkedIn',
    simIso: '2026-11-20T10:00:00-07:00',
    openingQuestion: 'Hello Sarah, I would like to schedule an estate and tax-free legacy wealth review with Principal Broker King Amen Ra.',
  },
];

async function postJson(pathname, body) {
  const res = await fetch(`${TARGET_BASE}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, raw, json: JSON.parse(raw) };
}

for (const c of TEN_INBOUND_CUSTOMERS) {
  const sessionId = `inbound-lead-call-${c.num}-${Date.now()}`;

  // Turn 0: Ring-1 Pickup
  const ring = await postJson('/api/sarah/inbound', {
    from: c.phone,
    session_id: sessionId,
    simulated_now_iso: c.simIso,
    skip_inline_tts: true,
  });
  assert.equal(ring.status, 200);

  // Turn 1: Product Inquiry
  const turn1 = await postJson('/api/sarah/turn', {
    session_id: sessionId,
    message: `${c.openingQuestion} Can I schedule a ${c.apptType} appointment for ${c.apptTime}?`,
    history: [{ speaker: 'sarah', text: ring.json?.reply || '' }],
    context: { mode: 'inbound', source_channel: 'inbound_lead', product_interest: c.product, simulated_now_iso: c.simIso },
  });
  assert.equal(turn1.status, 200);

  // Turn 2: Name + Phone Collection
  const turn2 = await postJson('/api/sarah/turn', {
    session_id: sessionId,
    message: `Sure, my full name is ${c.name} and my best phone number is ${c.phone}.`,
    history: [
      { speaker: 'sarah', text: ring.json?.reply || '' },
      { speaker: 'user', text: c.openingQuestion },
      { speaker: 'sarah', text: turn1.json?.reply || '' },
    ],
    context: {
      mode: 'inbound',
      source_channel: 'inbound_lead',
      lead_id: turn1.json?.lead_id || undefined,
      prospect_name: c.name,
      prospect_phone: c.phone,
      product_interest: c.product,
      appointment_type: c.apptType,
      preferred_datetime: c.apptTime,
      simulated_now_iso: c.simIso,
    },
  });
  assert.equal(turn2.status, 200);

  // Turn 3: Address + How Heard + Appointment Booking & Inbound Lead Tag
  const turn3 = await postJson('/api/sarah/turn', {
    session_id: sessionId,
    message: `My street address is ${c.address}, I heard about you through ${c.howHeard}, and please lock in that ${c.apptType} appointment for ${c.apptTime}.`,
    history: [
      { speaker: 'sarah', text: turn1.json?.reply || '' },
      { speaker: 'user', text: `My full name is ${c.name} and my phone number is ${c.phone}.` },
      { speaker: 'sarah', text: turn2.json?.reply || '' },
    ],
    context: {
      mode: 'inbound',
      source_channel: 'inbound_lead',
      lead_id: turn2.json?.lead_id || turn1.json?.lead_id || undefined,
      prospect_name: c.name,
      prospect_phone: c.phone,
      address: c.address,
      state: c.state,
      how_heard: c.howHeard,
      product_interest: c.product,
      appointment_type: c.apptType,
      preferred_datetime: c.apptTime,
      simulated_now_iso: c.simIso,
    },
  });
  assert.equal(turn3.status, 200);
  assert.equal(Boolean(turn3.json?.appointment?.success), true);

  console.log(
    `[PASS Call #${String(c.num).padStart(2, '0')}] ${c.name} | ${c.phone} | ${c.product} | Tag: ${turn3.json?.lead_source} | Lead ID: ${turn3.json?.lead_id}`
  );
}
console.log('=== ALL 10 COMPLETE INBOUND LEAD CALLS RECORDED IN CRM ===');
