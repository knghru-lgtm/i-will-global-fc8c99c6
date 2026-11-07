import { q, one, insert, getDb } from './index.ts';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../auth.ts';
import { DEFAULT_DISPOSITIONS } from '../services/automation.ts';
import { scoreLead } from '../services/scoring.ts';

/** Seed data generator for I Will Global (20 agents across Admin, Manager, Licensed Agent, Scheduler). */

export async function ensureSeeded(force = false) {
  await getDb();
  const count = await one<{ n: number }>('SELECT count(*)::int AS n FROM users');
  const alreadySeeded = !force && count && count.n >= 5;

  if (force) {
    const tables = ['calls', 'activities', 'messages', 'conversations', 'soas', 'commissions', 'policies', 'opportunities',
                    'health_items', 'clients', 'leads', 'campaigns', 'carriers', 'agent_credentials', 'dispositions', 'users'];
    for (const t of tables) {
      try { await q(`DELETE FROM ${t}`); } catch { /* Ignore missing table during fresh initialization */ }
    }
  }

  // 1. Dispositions
  for (const d of DEFAULT_DISPOSITIONS) {
    const exists = await one('SELECT id FROM dispositions WHERE id=$1', [d.id]);
    if (!exists) {
      await insert('dispositions', {
        id: d.id, label: d.label, category: d.category, color: d.color, icon: d.icon,
        automation: d.automation, licensed_only: Boolean(d.licensed_only), sort: DEFAULT_DISPOSITIONS.indexOf(d) + 1, active: true
      });
    }
  }

  // 2. Carriers
  const carriersData = [
    { id: 'c_humana', name: 'Humana', lines: ['MA', 'MAPD', 'PDP', 'Medigap'], portal_url: 'https://mower.humana.com', agent_phone: '(800) 309-3168', color: '#00754a' },
    { id: 'c_uhc', name: 'UnitedHealthcare (AARP)', lines: ['MA', 'MAPD', 'PDP', 'Medigap'], portal_url: 'https://jarvis.uhc.com', agent_phone: '(888) 381-8581', color: '#002677' },
    { id: 'c_aetna', name: 'Aetna Medicare', lines: ['MA', 'MAPD', 'PDP', 'Medigap'], portal_url: 'https://myaetnasupplemental.com', agent_phone: '(866) 272-6630', color: '#d2092b' },
    { id: 'c_bluecross', name: 'Blue Cross Blue Shield AZ', lines: ['MA', 'MAPD', 'Medigap'], portal_url: 'https://azblue.com/agents', agent_phone: '(800) 232-2345', color: '#005596' },
    { id: 'c_wellcare', name: 'Wellcare (Centene)', lines: ['MA', 'MAPD', 'PDP'], portal_url: 'https://centene.com/agents', agent_phone: '(866) 822-1339', color: '#00843d' },
    { id: 'c_cigna', name: 'Cigna Healthcare', lines: ['MA', 'MAPD', 'PDP', 'Medigap'], portal_url: 'https://cignaforbrokers.com', agent_phone: '(866) 448-6132', color: '#0097a9' },
    { id: 'c_devoted', name: 'Devoted Health', lines: ['MA', 'MAPD'], portal_url: 'https://devoted.com/brokers', agent_phone: '(800) 338-6833', color: '#632ca6' },
  ];
  for (const c of carriersData) {
    if (!(await one('SELECT id FROM carriers WHERE id=$1', [c.id]))) await insert('carriers', c);
  }

  // 3. 21 Users (Principal, Admin, Managers, Schedulers, Licensed Agents)
  const pwd = hashPassword('Welcome123!');
  const usersList = [
    // Executive & Management
    { id: 'u_principal', name: 'King Amen Ra', email: 'king@iwillglobal.com', role: 'admin', title: 'Principal & Broker of Record', phone: '(602) 456-9681', npn: '16094432', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'] },
    { id: 'u_admin', name: 'Licensed Transfer Agent', email: 'admin@iwillglobal.com', role: 'admin', title: 'Licensed Transfer Agent & Principal', phone: '(480) 331-9455', npn: '19842011', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'] },
    { id: 'u_transfer_agent', name: 'Licensed Transfer Agent', email: 'transfer@iwillglobal.com', role: 'licensed_agent', title: 'State-Licensed Medicare Transfer Specialist', phone: '(480) 331-9455', npn: '19842011', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'] },
    { id: 'u_info_cal', name: 'I Will Global Master Calendar', email: 'info@iwillglobal.com', role: 'admin', title: 'Agency Master Calendar & Operations', phone: '(480) 331-9455', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'] },
    { id: 'u_coo_aneesha', name: 'Aneesha Sullivan, PA', email: 'aneesha@iwillglobal.com', role: 'admin', title: 'Chief Operating Officer (COO), Physician Assistant (PA) & Principal Governance', phone: '(602) 412-1945', npn: '19842012', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'] },
    { id: 'u_mgr1', name: 'Sarah Jenkins', email: 'sjenkins@iwillglobal.com', role: 'manager', title: 'Sales Director', phone: '(480) 331-9401', npn: '18923012', states: ['AZ', 'CA', 'NV'] },
    { id: 'u_mgr2', name: 'Marcus Vance', email: 'mvance@iwillglobal.com', role: 'manager', title: 'Inbound & Scheduling Manager', phone: '(480) 331-9402', npn: '17849203', states: ['AZ', 'TX', 'NM'] },

    // Dedicated Outbound Call Appointment Schedulers
    { id: 'u_jakeeta', name: 'JaKeeta Sullivan', email: 'jakeeta@iwillglobal.com', role: 'scheduler', title: 'Outbound Scheduling Specialist', phone: '(602) 456-2760', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'] },
    { id: 'u_sgranger', name: 'Shakira Granger', email: 'sgranger@iwillglobal.com', role: 'scheduler', title: 'Outbound Scheduling Specialist', phone: '(602) 753-6169', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'] },
    { id: 'u_sch_kmartinez', name: 'Kamille Martinez', email: 'kmartinez@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist & Appointment Setter', phone: '(602) 456-0293', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'] },
    { id: 'u_sch_rmccullough', name: 'Regina McCullough', email: 'rmccullough@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist & Appointment Setter', phone: '(602) 456-5903', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'] },
    { id: 'u_sch2', name: 'David Miller', email: 'dmiller@iwillglobal.com', role: 'scheduler', title: 'Outbound Senior Scheduler', phone: '(480) 331-9411', states: ['AZ'] },
    { id: 'u_sch3', name: 'Chloe Bennett', email: 'cbennett@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9412', states: ['AZ'] },
    { id: 'u_sch4', name: 'Jordan Rivera', email: 'jrivera@iwillglobal.com', role: 'scheduler', title: 'Outbound Lead Coordinator', phone: '(480) 331-9413', states: ['AZ'] },
    { id: 'u_sch5', name: 'Hannah Abbott', email: 'habbott@iwillglobal.com', role: 'scheduler', title: 'Outbound Appointment Setter', phone: '(480) 331-9414', states: ['AZ'] },
    { id: 'u_sch6', name: 'Maya Collins', email: 'mcollins@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9415', states: ['AZ'] },
    { id: 'u_sch7', name: 'Tyler Sanders', email: 'tsanders@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Scheduler', phone: '(480) 331-9416', states: ['AZ'] },
    { id: 'u_sch8', name: 'Vikram Patel', email: 'vpatel@iwillglobal.com', role: 'scheduler', title: 'Outbound Appointment Setter', phone: '(480) 331-9417', states: ['AZ'] },
    { id: 'u_sch9', name: 'Sofia Ramirez', email: 'sramirez@iwillglobal.com', role: 'scheduler', title: 'Outbound Lead Qualifier', phone: '(480) 331-9418', states: ['AZ'] },
    { id: 'u_sch10', name: 'Lucas Nelson', email: 'lnelson@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9419', states: ['AZ'] },
    { id: 'u_sch11', name: 'Emma Russell', email: 'erussell@iwillglobal.com', role: 'scheduler', title: 'Outbound Appointment Setter', phone: '(480) 331-9433', states: ['AZ'] },
    { id: 'u_sch12', name: 'Kevin Wright', email: 'kwright@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9434', states: ['AZ'] },
    { id: 'u_sch13', name: 'Alicia Diaz', email: 'adiaz@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Scheduler', phone: '(480) 331-9435', states: ['AZ'] },
    { id: 'u_sch14', name: 'Nathan Parker', email: 'nparker@iwillglobal.com', role: 'scheduler', title: 'Outbound Lead Coordinator', phone: '(480) 331-9436', states: ['AZ'] },
    { id: 'u_sch15', name: 'Zainab Khouri', email: 'zkhouri@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9437', states: ['AZ'] },
    { id: 'u_sch16', name: 'Brandon Sullivan', email: 'bsullivan@iwillglobal.com', role: 'scheduler', title: 'Outbound Appointment Setter', phone: '(480) 331-9438', states: ['AZ'] },
    { id: 'u_sch17', name: 'Jasmine Chen', email: 'jchen@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9439', states: ['AZ'] },
    { id: 'u_sch18', name: 'Marcus Reed', email: 'mreed@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Scheduler', phone: '(480) 331-9440', states: ['AZ'] },
    { id: 'u_sch19', name: 'Kayla Bailey', email: 'kbailey@iwillglobal.com', role: 'scheduler', title: 'Outbound Lead Qualifier', phone: '(480) 331-9441', states: ['AZ'] },
    { id: 'u_sch20', name: 'Derek Howard', email: 'dhoward@iwillglobal.com', role: 'scheduler', title: 'Outbound Appointment Setter', phone: '(480) 331-9442', states: ['AZ'] },
    { id: 'u_sch21', name: 'Samantha Wood', email: 'swood@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9443', states: ['AZ'] },

    // Licensed Agents (13)
    { id: 'u_agent1', name: 'Robert Chen', email: 'rchen@iwillglobal.com', role: 'licensed_agent', title: 'Senior Medicare Specialist', phone: '(480) 331-9420', npn: '19482015', states: ['AZ', 'CA', 'NV'] },
    { id: 'u_agent2', name: 'Amanda Torres', email: 'atorres@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Advisor', phone: '(480) 331-9421', npn: '20194821', states: ['AZ', 'TX'] },
    { id: 'u_agent3', name: 'James Wilson', email: 'jwilson@iwillglobal.com', role: 'licensed_agent', title: 'Retirement & Health Advisor', phone: '(480) 331-9422', npn: '18392044', states: ['AZ', 'NM', 'CO'] },
    { id: 'u_agent4', name: 'Rachel Adams', email: 'radams@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Benefits Counselor', phone: '(480) 331-9423', npn: '20938410', states: ['AZ', 'CA'] },
    { id: 'u_agent5', name: 'Carlos Gomez', email: 'cgomez@iwillglobal.com', role: 'licensed_agent', title: 'Bi-lingual Senior Advisor', phone: '(480) 331-9424', npn: '19384029', states: ['AZ', 'NV', 'FL'] },
    { id: 'u_agent6', name: 'Emily Watson', email: 'ewatson@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Specialist', phone: '(480) 331-9425', npn: '21039482', states: ['AZ'] },
    { id: 'u_agent7', name: 'Brian O\'Connor', email: 'boconnor@iwillglobal.com', role: 'licensed_agent', title: 'Senior Insurance Broker', phone: '(480) 331-9426', npn: '17594032', states: ['AZ', 'TX', 'CO'] },
    { id: 'u_agent8', name: 'Jessica Taylor', email: 'jtaylor@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Agent', phone: '(480) 331-9427', npn: '20495820', states: ['AZ', 'CA'] },
    { id: 'u_agent9', name: 'Michael Chang', email: 'mchang@iwillglobal.com', role: 'licensed_agent', title: 'Senior Health Broker', phone: '(480) 331-9428', npn: '19203948', states: ['AZ', 'NV'] },
    { id: 'u_agent10', name: 'Laura Martinez', email: 'lmartinez@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Advisor', phone: '(480) 331-9429', npn: '20839401', states: ['AZ', 'NM'] },
    { id: 'u_agent11', name: 'Kevin Brooks', email: 'kbrooks@iwillglobal.com', role: 'licensed_agent', title: 'Senior Specialist', phone: '(480) 331-9430', npn: '18493021', states: ['AZ'] },
    { id: 'u_agent12', name: 'Nicole Foster', email: 'nfoster@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Counselor', phone: '(480) 331-9431', npn: '21948302', states: ['AZ', 'FL'] },
    { id: 'u_agent13', name: 'Timothy Hays', email: 'thays@iwillglobal.com', role: 'licensed_agent', title: 'Insurance Specialist', phone: '(480) 331-9432', npn: '19503928', states: ['AZ'] },
  ];

  // Sarah Voice AI autonomous outbound caller & 24/7 receptionist on (480) 331-9455 — every prospect assigned to this user is dialed automatically
  // Mon–Fri 9 AM–7 PM and Sat–Sun 9 AM–6 PM (Arizona time). Login is disabled via an unguessable password.
  const sarahAiUser = await one('SELECT id FROM users WHERE id=$1 OR lower(email) IN (lower($2), lower($3), lower($4))', ['u_sarah_ai', 'sarah@iwillglobal.com', 'voice@iwillglobal.com', 'receptionist@iwillglobal.com']);
  if (!sarahAiUser) {
    await insert('users', {
      id: 'u_sarah_ai',
      name: 'Sarah — Voice AI Receptionist & Outbound Caller',
      email: 'sarah@iwillglobal.com',
      password_hash: hashPassword(randomUUID() + randomUUID()),
      role: 'scheduler',
      title: 'Autonomous Voice AI Outbound Caller & Receptionist (480) 331-9455',
      phone: '(480) 331-9455',
      states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'],
      active: true,
      daily_call_goal: 1000,
    });
  } else {
    await q(
      `UPDATE users SET name=$1, title=$2, phone=$3, active=true WHERE id=$4`,
      [
        'Sarah — Voice AI Receptionist & Outbound Caller',
        'Autonomous Voice AI Outbound Caller & Receptionist (480) 331-9455',
        '(480) 331-9455',
        sarahAiUser.id,
      ]
    );
  }

  for (const u of usersList) {
    const userPwd = u.email === 'king@iwillglobal.com' ? hashPassword('Heru5464') : (u.email === 'kmartinez@iwillglobal.com' ? hashPassword('Today#01') : pwd);
    const existing = await one('SELECT id, phone, role FROM users WHERE id=$1 OR lower(email)=lower($2)', [u.id, u.email]);
    if (!existing) {
      const meetHandle = u.email.split('@')[0].toLowerCase();
      await insert('users', {
        id: u.id, name: u.name, email: u.email, password_hash: userPwd, role: u.role, title: u.title,
        phone: u.phone, npn: u.npn || null, states: u.states, active: true,
        google_meet_url: `https://meet.google.com/iwg-${meetHandle}`,
        daily_call_goal: u.role === 'scheduler' ? 120 : 60,
      });
      // Add credentials for licensed agents
      if (u.role === 'licensed_agent' || u.role === 'manager' || u.role === 'admin') {
        for (const st of u.states) {
          await insert('agent_credentials', {
            user_id: u.id, kind: 'license', name: st, number: `LIC-${st}-${u.npn || '9999'}`,
            status: 'Active', ready_to_sell: true, expires_on: '2027-12-31'
          });
        }
        await insert('agent_credentials', {
          user_id: u.id, kind: 'certification', name: 'AHIP', plan_year: 2026,
          status: 'Active', ready_to_sell: true, expires_on: '2026-12-31'
        });
        await insert('agent_credentials', {
          user_id: u.id, kind: 'appointment', name: 'Humana', status: 'Active', ready_to_sell: true
        });
        await insert('agent_credentials', {
          user_id: u.id, kind: 'appointment', name: 'UnitedHealthcare', status: 'Active', ready_to_sell: true
        });
        await insert('agent_credentials', {
          user_id: u.id, kind: 'appointment', name: 'Aetna Medicare', status: 'Active', ready_to_sell: true
        });
      }
    } else {
      if (u.phone && existing.phone !== u.phone) {
        await q('UPDATE users SET phone=$1 WHERE id=$2', [u.phone, existing.id]);
      }
      if (u.id === 'u_principal' || u.email === 'king@iwillglobal.com') {
        await q("UPDATE users SET email='king@iwillglobal.com', password_hash=$1, role='admin', title='Principal & Broker of Record', npn='16094432', phone='(602) 456-9681', states=$2::jsonb WHERE id=$3 OR lower(email) IN ('king@iwillglobal.com', 'asking@iwillglobal.com')", [userPwd, JSON.stringify(u.states), u.id]);
        for (const st of u.states) {
          const cred = await one('SELECT id FROM agent_credentials WHERE user_id=$1 AND kind=$2 AND name=$3', [u.id, 'license', st]);
          if (!cred) {
            await insert('agent_credentials', {
              user_id: u.id, kind: 'license', name: st, number: `LIC-${st}-16094432`,
              status: 'Active', ready_to_sell: true, expires_on: '2027-12-31'
            });
          }
        }
      } else if (u.id === 'u_sch1' || u.id === 'u_coo_aneesha' || u.email === 'aneesha@iwillglobal.com') {
        await q("UPDATE users SET name='Aneesha Sullivan, PA', role='admin', title='Chief Operating Officer (COO), Physician Assistant (PA) & Principal Governance', npn='19842012', states=$1::jsonb WHERE id IN ('u_sch1', 'u_coo_aneesha') OR lower(email)='aneesha@iwillglobal.com'", [JSON.stringify(u.states)]);
      }
    }
  }

  const actCount = await one<{ n: number }>('SELECT count(*)::int AS n FROM activities');
  if (!force && count && count.n >= 5 && actCount && actCount.n >= 5) return;

  // 4. Campaigns
  const campaigns = [
    { id: 'cmp_t65_az', name: 'Arizona Turning 65 Direct Mail', type: 'Direct Mail', status: 'Active', start_date: '2026-01-01', end_date: '2026-12-31', budget: 15000 },
    { id: 'cmp_aep_2026', name: 'AEP 2026 Annual Review Outreach', type: 'Email & SMS', status: 'Active', start_date: '2026-09-15', end_date: '2026-12-07', budget: 25000 },
    { id: 'cmp_web_inbound', name: 'iwillglobal.com Digital Inbound', type: 'Web Search', status: 'Active', start_date: '2026-01-01', end_date: '2026-12-31', budget: 10000 },
  ];
  for (const cmp of campaigns) {
    if (!(await one('SELECT id FROM campaigns WHERE id=$1', [cmp.id]))) await insert('campaigns', cmp);
  }

  // 5. Sample Leads (Turning 65, AEP Prospects, Inbound Web)
  const leadsData = [
    {
      id: 'lead_1', first_name: 'Arthur', last_name: 'Pendleton', phone: '(480) 555-0144', email: 'arthur.p@gmail.com',
      dob: '1961-12-14', address: '742 E Camelback Rd', city: 'Phoenix', state: 'AZ', zip: '85014', county: 'Maricopa',
      source: 'Turning 65 Mailer', campaign_id: 'cmp_t65_az', status: 'New', interest: 'Turning 65 / Medicare Advantage',
      owner_id: 'u_jakeeta', assigned_agent_id: 'u_agent1', tcpa_consent: true,
    },
    {
      id: 'lead_2', first_name: 'Eleanor', last_name: 'Vance', phone: '(602) 555-0192', email: 'evance@yahoo.com',
      dob: '1961-11-05', address: '3102 N 44th St', city: 'Phoenix', state: 'AZ', zip: '85018', county: 'Maricopa',
      source: 'Website Chat (AI)', campaign_id: 'cmp_web_inbound', status: 'SOA Signed', interest: 'Medigap Plan G vs Advantage',
      owner_id: 'u_sch2', assigned_agent_id: 'u_agent2', tcpa_consent: true,
    },
    {
      id: 'lead_3', first_name: 'George', last_name: 'Kovacs', phone: '(480) 555-0183', email: 'gkovacs@outlook.com',
      dob: '1955-04-12', address: '1204 E Baseline Rd', city: 'Tempe', state: 'AZ', zip: '85283', county: 'Maricopa',
      source: 'AEP Review Email', campaign_id: 'cmp_aep_2026', status: 'Appointment Set', interest: 'Part D Rx Review',
      owner_id: 'u_jakeeta', assigned_agent_id: 'u_agent1', tcpa_consent: true,
    },
    {
      id: 'lead_4', first_name: 'Maria', last_name: 'Santos', phone: '(520) 555-0177', email: 'msantos_az@gmail.com',
      dob: '1961-10-22', address: '4820 E Broadway Blvd', city: 'Tucson', state: 'AZ', zip: '85711', county: 'Pima',
      source: 'Website Chat (AI)', campaign_id: 'cmp_web_inbound', status: 'Contacted', interest: 'D-SNP Dual Eligible',
      owner_id: 'u_sch3', assigned_agent_id: 'u_agent5', tcpa_consent: true,
    },
    {
      id: 'lead_5', first_name: 'Harold', last_name: 'Finch', phone: '(928) 555-0129', email: 'hfinch@gmail.com',
      dob: '1952-08-30', address: '1500 E Route 66', city: 'Flagstaff', state: 'AZ', zip: '86001', county: 'Coconino',
      source: 'Referral', status: 'SOA Sent', interest: 'Humana Medicare Advantage',
      owner_id: 'u_sch4', assigned_agent_id: 'u_agent3', tcpa_consent: true,
    },
    {
      id: 'lead_6', first_name: 'Dorothy', last_name: 'Gale', phone: '(480) 555-0161', email: 'dgale@mindsprung.com',
      dob: '1961-12-01', address: '8801 E Indian School Rd', city: 'Scottsdale', state: 'AZ', zip: '85251', county: 'Maricopa',
      source: 'Turning 65 Mailer', campaign_id: 'cmp_t65_az', status: 'New', interest: 'Supplement / Medigap Plan N',
      owner_id: 'u_sch2', assigned_agent_id: 'u_agent4', tcpa_consent: true,
    }
  ];

  for (const l of leadsData) {
    if (!(await one('SELECT id FROM leads WHERE id=$1', [l.id]))) {
      const scoring = scoreLead(l);
      await insert('leads', { ...l, ...scoring });
    }
  }

  // 6. Sample Clients & Policies
  const clientData = {
    id: 'cli_1', first_name: 'Walter', last_name: 'White', phone: '(505) 555-0155', email: 'wwhite@greymatter.com',
    dob: '1959-09-07', address: '308 Negra Arroyo Lane', city: 'Albuquerque', state: 'NM', zip: '87104', county: 'Bernalillo',
    mbi_last4: '4921', part_a_date: '2024-09-01', part_b_date: '2024-09-01', status: 'Active', owner_id: 'u_agent3',
    notes: 'Prescription review needed every Oct. Takes Specialty Oncological Rx.',
  };
  if (!(await one('SELECT id FROM clients WHERE id=$1', [clientData.id]))) {
    await insert('clients', clientData);
    await insert('policies', {
      id: 'pol_1', client_id: 'cli_1', agent_id: 'u_agent3', carrier: 'Humana', plan_name: 'Humana Gold Plus HMO',
      plan_type: 'MAPD', plan_id: 'H6607-012', policy_number: 'HUM-84920194', status: 'Active', effective_date: '2025-01-01',
      premium: 0, submitted_at: '2024-11-10'
    });
    await insert('commissions', {
      id: 'comm_1', policy_id: 'pol_1', agent_id: 'u_agent3', carrier: 'Humana', type: 'Initial', period: '2025-01',
      expected_amount: 611, paid_amount: 611, status: 'Paid', paid_date: '2025-01-15'
    });
    await insert('health_items', { id: 'hi_1', client_id: 'cli_1', kind: 'medication', name: 'Atorvastatin 20mg', detail: '1 tab daily' });
    await insert('health_items', { id: 'hi_2', client_id: 'cli_1', kind: 'doctor', name: 'Dr. Jesse Pinkman', detail: 'Pulmonology / UNM Health' });
  }

  // 7. Sample Opportunities
  if (!(await one('SELECT id FROM opportunities WHERE id=$1', ['opp_1']))) {
    await insert('opportunities', {
      id: 'opp_1', name: 'George Kovacs — MAPD AEP Review 2026', lead_id: 'lead_3', owner_id: 'u_agent1',
      stage: 'Appointment Set', plan_type: 'MAPD', carrier: 'Aetna Medicare', expected_commission: 305,
      probability: 60, enrollment_period: 'AEP', effective_date: '2027-01-01'
    });
  }

  // 8. Sample SOA
  if (!(await one('SELECT id FROM soas WHERE id=$1', ['soa_1']))) {
    await insert('soas', {
      id: 'soa_1', token: 'demo-soa-token-eleanor-vance', lead_id: 'lead_2', agent_id: 'u_agent2',
      beneficiary_name: 'Eleanor Vance', products: ['Medicare Advantage (Part C)', 'Prescription Drug Plan (Part D)', 'Medicare Supplement (Medigap)'],
      method: 'E-sign', status: 'Signed', signed_at: '2026-10-08T14:20:00Z', signer_name: 'Eleanor Vance'
    });
  }

  // 9. Sample Activities (Calls, Warm Transfers, Appointments, Tasks with explicit Scheduler vs Agent attribution)
  const sampleActivities = [
    {
      id: 'act_call_1',
      type: 'call',
      subject: 'Outbound Medicare Call to Arthur Pendleton — Appointment Set',
      body: 'Contacted Arthur regarding Turning 65 enrollment options in Maricopa County. Discussed Medicare Advantage vs Supplement (Plan G). Scheduled phone appointment with Licensed Agent Robert Chen for consultation.',
      related_type: 'lead',
      related_id: 'lead_1',
      user_id: 'u_jakeeta',
      assigned_to: 'u_agent1',
      status: 'Completed',
      direction: 'outbound',
      phone: '(480) 555-0144',
      duration_sec: 245,
      disposition_id: 'appointment_set',
      disposition: 'Confirmed Appointment Set',
      provider: 'google_voice',
      meta: {
        scheduler_id: 'u_jakeeta',
        scheduler_name: 'JaKeeta Sullivan',
        booked_by_user_id: 'u_jakeeta',
        booked_by_name: 'JaKeeta Sullivan',
        assigned_agent_id: 'u_agent1',
        assigned_agent_name: 'Robert Chen',
      },
    },
    {
      id: 'act_appt_1',
      type: 'event',
      subject: 'Medicare Telephone Consultation — Arthur Pendleton',
      body: 'Part D Rx Review & Medicare Advantage Consultation.\nClient: Arthur Pendleton\nPhone: (480) 555-0144\nBooked by Scheduler: JaKeeta Sullivan\nConsultation Agent: Robert Chen\n🎥 Google Meet: https://meet.google.com/iwg-rchen',
      related_type: 'lead',
      related_id: 'lead_1',
      user_id: 'u_jakeeta',
      assigned_to: 'u_agent1',
      due_at: new Date(Date.now() + 86400000 * 2),
      end_at: new Date(Date.now() + 86400000 * 2 + 3600000),
      status: 'Confirmed Appointment Set',
      completed: false,
      meta: {
        appointment_type: 'telephone',
        location: 'Phone: (480) 555-0144',
        google_meet_url: 'https://meet.google.com/iwg-rchen',
        booked_by_user_id: 'u_jakeeta',
        booked_by_name: 'JaKeeta Sullivan',
        assigned_agent_id: 'u_agent1',
        assigned_agent_name: 'Robert Chen',
        customer_name: 'Arthur Pendleton',
        customer_phone: '(480) 555-0144',
        customer_confirmed: true,
        master_calendar_email: 'info@iwillglobal.com',
        master_calendar_synced: true,
      },
    },
    {
      id: 'act_transfer_1',
      type: 'call',
      subject: 'Live 3-Way Warm Transfer — Eleanor Vance to King Amen Ra',
      body: 'Scheduler Kamille Martinez connected prospect Eleanor Vance with Principal Broker King Amen Ra for immediate enrollment review. Prospect has Medicare Parts A & B active.',
      related_type: 'lead',
      related_id: 'lead_2',
      user_id: 'u_sch_kmartinez',
      assigned_to: 'u_principal',
      status: '3-Way Conference Completed',
      direction: 'outbound',
      phone: '(602) 555-0192',
      duration_sec: 430,
      disposition_id: 'warm_transfer_success',
      disposition: 'Warm Transfer Completed (Live Connect)',
      provider: 'telephony_trunk',
      meta: {
        scheduler_id: 'u_sch_kmartinez',
        scheduler_name: 'Kamille Martinez',
        booked_by_user_id: 'u_sch_kmartinez',
        booked_by_name: 'Kamille Martinez',
        target_agent_id: 'u_principal',
        target_agent_name: 'King Amen Ra',
        assigned_agent_id: 'u_principal',
        assigned_agent_name: 'King Amen Ra',
        warm_transfer: true,
        scheduler_credit_status: 'Credited',
        scheduler_credit_amount: 25.00,
      },
    },
    {
      id: 'act_call_2',
      type: 'call',
      subject: 'Outbound Call to George Kovacs — Callback Requested',
      body: 'Spoke with George. Requested callback tomorrow at 2:00 PM MST to review Aetna and Humana plans.',
      related_type: 'lead',
      related_id: 'lead_3',
      user_id: 'u_sgranger',
      status: 'Completed',
      direction: 'outbound',
      phone: '(480) 555-0183',
      duration_sec: 110,
      disposition_id: 'callback_requested',
      disposition: 'Callback Requested',
      provider: 'google_voice',
      meta: {
        scheduler_id: 'u_sgranger',
        scheduler_name: 'Shakira Granger',
        booked_by_user_id: 'u_sgranger',
        booked_by_name: 'Shakira Granger',
      },
    },
    {
      id: 'act_call_3',
      type: 'call',
      subject: 'Outbound Call to Martha Washington — Left Voicemail',
      body: 'Left introductory voicemail regarding Medicare Annual Enrollment Period plan options and extra benefits.',
      related_type: 'lead',
      related_id: 'lead_4',
      user_id: 'u_sch_rmccullough',
      status: 'Completed',
      direction: 'outbound',
      phone: '(520) 555-0177',
      duration_sec: 38,
      disposition_id: 'voicemail',
      disposition: 'Left Voicemail',
      provider: 'google_voice',
      meta: {
        scheduler_id: 'u_sch_rmccullough',
        scheduler_name: 'Regina McCullough',
      },
    },
    {
      id: 'act_agent_call_1',
      type: 'call',
      subject: 'Consultation & Enrollment Review — Eleanor Vance',
      body: 'Conducted Medicare Advantage comparison with Eleanor Vance. Reviewed current prescriptions and primary care network. Electronic SOA executed.',
      related_type: 'lead',
      related_id: 'lead_2',
      user_id: 'u_agent2',
      assigned_to: 'u_agent2',
      status: 'Completed',
      direction: 'outbound',
      phone: '(602) 555-0192',
      duration_sec: 840,
      disposition_id: 'soa_signed',
      disposition: 'Scope of Appointment Completed',
      provider: 'google_voice',
      meta: {
        assigned_agent_id: 'u_agent2',
        assigned_agent_name: 'Amanda Torres',
      },
    },
    {
      id: 'act_task_1',
      type: 'task',
      subject: 'Follow-up: Verify LIS / Extra Help status for Walter White',
      body: 'Check Medicaid level and prescription subsidy before annual plan renewal review.',
      related_type: 'client',
      related_id: 'cli_1',
      user_id: 'u_jakeeta',
      assigned_to: 'u_agent3',
      priority: 'high',
      status: 'Pending',
      completed: false,
      due_at: new Date(Date.now() + 86400000 * 3),
      meta: {
        created_by_name: 'JaKeeta Sullivan',
        created_by_role: 'scheduler',
        assigned_to_name: 'James Wilson',
      },
    },
  ];

  for (const act of sampleActivities) {
    if (!(await one('SELECT id FROM activities WHERE id=$1', [act.id]))) {
      await insert('activities', act);
    }
  }

  console.log('✅ Database seeded with 20 I Will Global team members, leads, carriers, and sample records.');
}

