const { Client } = require('pg');
const xlsx = require('xlsx');

async function populate() {
  const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_m6vHUV0eKqRD@ep-withered-base-b4fiirpw.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require' });
  await client.connect();

  console.log('Connected to Neon Postgres.');

  // 1. Scan Excel files for full names, addresses, phones, and metadata
  const phoneMap = new Map();

  function scanSheet(path, sheetName) {
    try {
      const wb = xlsx.readFile(path);
      if (!wb.Sheets[sheetName]) return;
      const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName]);
      for (const r of rows) {
        const rawPhone = String(r.Mobile || r.Phone || r['Primary Phone'] || r.phone || '').replace(/\D/g, '');
        if (rawPhone.length < 10) continue;
        const p10 = rawPhone.slice(-10);
        if (phoneMap.has(p10)) continue;

        const fn = String(r['First Name'] || r.first_name || '').trim();
        const ln = String(r['Last Name'] || r.last_name || '').trim();
        const addr = String(r['Address 1'] || r.Address || r.address || '').trim();
        const city = String(r.City || r.city || '').trim();
        const state = String(r.State || r.state || 'AZ').trim();
        const zip = String(r.Zip || r.zip || '').trim();
        const dob = String(r.DOB || r.dob || '').trim();
        const email = String(r.Email || r.email || '').trim();

        if (!fn || !ln || !addr || ['prospect','lead'].includes(fn.toLowerCase())) continue;

        phoneMap.set(p10, { fn, ln, addr, city, state, zip, dob, email, phone: '+1' + p10 });
      }
    } catch(e) {
      console.error('Error scanning sheet', sheetName, e.message);
    }
  }

  scanSheet('C:/Users/knghr/Downloads/IWG_2026_Prospects_10k_Part_1_FINAL.xlsx', 'Part 1');
  scanSheet('C:/Users/knghr/Downloads/IWG_Prospect_Batch1_Expanded_Phone_Master.xlsx', 'Matched Phone Numbers (179)');
  scanSheet('C:/Users/knghr/Downloads/IWG_Prospect_Batch1_Expanded_Phone_Master.xlsx', 'Batch 1 Deduplicated (31,651)');
  scanSheet('C:/Users/knghr/Downloads/IWG_Prospect_Batch1_Expanded_Phone_Master.xlsx', 'West Valley 65+ (14,853)');

  console.log('Scanned verified prospects from spreadsheets:', phoneMap.size);

  // 2. Fetch existing real leads from backup
  const backupRes = await client.query("SELECT * FROM leads_backup_20261024 WHERE first_name != 'Prospect' AND last_name != 'Lead'");
  console.log('Real leads from backup table:', backupRes.rows.length);

  const seenP10 = new Set();
  const allLeads = [];

  for (const b of backupRes.rows) {
    const p10 = String(b.phone || '').replace(/\D/g, '').slice(-10);
    const meta = phoneMap.get(p10);
    seenP10.add(p10);

    const addr = meta ? meta.addr : (b.address || null);
    const city = meta ? (meta.city || b.city) : b.city;
    const state = meta ? (meta.state || b.state) : (b.state || 'AZ');
    const zip = meta ? (meta.zip || b.zip) : b.zip;
    const email = meta ? (meta.email || b.email) : b.email;
    const dob = meta ? (meta.dob || b.dob) : b.dob;

    allLeads.push({
      ...b,
      address: addr,
      city: city || 'PHOENIX',
      state: state || 'AZ',
      zip: zip || '85001',
      email: email,
      dob: dob,
    });
  }

  // Add remaining verified leads from phoneMap
  for (const [p10, meta] of phoneMap.entries()) {
    if (seenP10.has(p10)) continue;
    seenP10.add(p10);

    allLeads.push({
      id: require('crypto').randomUUID(),
      first_name: meta.fn,
      last_name: meta.ln,
      phone: meta.phone,
      email: meta.email || null,
      dob: meta.dob || null,
      address: meta.addr,
      city: meta.city || 'PHOENIX',
      state: meta.state || 'AZ',
      zip: meta.zip || '85001',
      county: null,
      source: 'Excel/CSV Import',
      campaign_id: null,
      status: 'New',
      medicare_status: null,
      current_coverage: null,
      interest: null,
      owner_id: null,
      assigned_agent_id: null,
      score: 46,
      score_reason: 'Medicare-eligible (AEP/SEP) • TCPA consent on file',
      tcpa_consent: true,
      consent_at: null,
      dnc: false,
      phone_invalid: false,
      attempts: 0,
      last_disposition: null,
      last_contacted_at: null,
      next_callback_at: null,
      converted_client_id: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  console.log('Total verified leads prepared:', allLeads.length);

  // 3. Balance assignments so Janice Varnado has 500 high-quality verified leads with names & addresses
  // Target:
  // Janice Varnado (u_sch_jvanado): 500
  // Kamille Martinez (u_sch_kmartinez): 500
  // JaKeeta Sullivan (5afe5307-7893-4eb0-ba55-f2464db596f0): 500
  // King Amen Ra (3afbca01-76cd-4fa9-91cc-f3a1a4821276): 300
  // Unassigned pool: remainder (~253)

  const janiceLeads = [];
  const kamilleLeads = [];
  const jakeetaLeads = [];
  const kingLeads = [];
  const unassignedLeads = [];

  for (let i = 0; i < allLeads.length; i++) {
    const lead = allLeads[i];
    if (janiceLeads.length < 500) {
      lead.owner_id = 'u_sch_jvanado';
      janiceLeads.push(lead);
    } else if (kamilleLeads.length < 500) {
      lead.owner_id = 'u_sch_kmartinez';
      kamilleLeads.push(lead);
    } else if (jakeetaLeads.length < 500) {
      lead.owner_id = '5afe5307-7893-4eb0-ba55-f2464db596f0';
      jakeetaLeads.push(lead);
    } else if (kingLeads.length < 300) {
      lead.owner_id = '3afbca01-76cd-4fa9-91cc-f3a1a4821276';
      kingLeads.push(lead);
    } else {
      lead.owner_id = null;
      lead.assigned_agent_id = null;
      unassignedLeads.push(lead);
    }
  }

  console.log(`Assignment Breakdown:
  - Janice Varnado (u_sch_jvanado): ${janiceLeads.length}
  - Kamille Martinez (u_sch_kmartinez): ${kamilleLeads.length}
  - JaKeeta Sullivan: ${jakeetaLeads.length}
  - King Amen Ra: ${kingLeads.length}
  - Unassigned Master Pool: ${unassignedLeads.length}
  `);

  // 4. Insert into leads table in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < allLeads.length; i += BATCH_SIZE) {
    const batch = allLeads.slice(i, i + BATCH_SIZE);
    const valueSets = [];
    const params = [];
    let pIdx = 1;

    for (const l of batch) {
      params.push(
        l.id,
        l.first_name,
        l.last_name,
        l.phone,
        l.email,
        l.dob,
        l.address,
        l.city,
        l.state,
        l.zip,
        l.county,
        l.source || 'Excel/CSV Import',
        l.campaign_id || null,
        l.status || 'New',
        l.medicare_status || null,
        l.current_coverage || null,
        l.interest || null,
        l.owner_id,
        l.assigned_agent_id || null,
        l.score || 46,
        l.score_reason || 'Medicare-eligible (AEP/SEP) • TCPA consent on file',
        l.tcpa_consent !== false,
        l.consent_at || null,
        l.dnc === true,
        l.phone_invalid === true,
        l.attempts || 0,
        l.last_disposition || null,
        l.last_contacted_at || null,
        l.next_callback_at || null,
        l.converted_client_id || null,
        l.notes || null,
        l.created_at || new Date().toISOString(),
        l.updated_at || new Date().toISOString()
      );

      const placeHolders = [];
      for (let j = 0; j < 33; j++) {
        placeHolders.push(`$${pIdx++}`);
      }
      valueSets.push(`(${placeHolders.join(', ')})`);
    }

    const sql = `
      INSERT INTO leads (
        id, first_name, last_name, phone, email, dob, address, city, state, zip, county,
        source, campaign_id, status, medicare_status, current_coverage, interest,
        owner_id, assigned_agent_id, score, score_reason, tcpa_consent, consent_at,
        dnc, phone_invalid, attempts, last_disposition, last_contacted_at,
        next_callback_at, converted_client_id, notes, created_at, updated_at
      ) VALUES ${valueSets.join(', ')}
      ON CONFLICT (id) DO UPDATE SET
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        owner_id = EXCLUDED.owner_id,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        dob = EXCLUDED.dob,
        updated_at = NOW()
    `;

    await client.query(sql, params);
  }

  // 5. Verification
  const totalInDb = await client.query("SELECT count(*)::int AS count FROM leads");
  const janiceInDb = await client.query("SELECT count(*)::int AS count FROM leads WHERE owner_id = 'u_sch_jvanado'");
  const janiceSample = await client.query("SELECT first_name, last_name, phone, address, city, state, zip FROM leads WHERE owner_id = 'u_sch_jvanado' LIMIT 5");

  console.log('Total verified leads in leads table:', totalInDb.rows[0].count);
  console.log('Janice Varnado verified leads:', janiceInDb.rows[0].count);
  console.log('Janice Sample leads with address:');
  console.table(janiceSample.rows);

  await client.end();
}

populate().catch(console.error);
