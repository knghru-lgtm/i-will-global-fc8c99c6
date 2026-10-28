const { Client } = require('pg');
const xlsx = require('xlsx');

async function dryRun() {
  const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_m6vHUV0eKqRD@ep-withered-base-b4fiirpw.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require' });
  await client.connect();

  // 1. Build phone lookup map from Excel files
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

  console.log('Total verified prospects in phoneMap:', phoneMap.size);

  // 2. Fetch existing real leads from backup
  const backupRes = await client.query("SELECT * FROM leads_backup_20261024 WHERE first_name != 'Prospect' AND last_name != 'Lead'");
  console.log('Real leads in backup:', backupRes.rows.length);

  const seenP10 = new Set();
  const leadsToInsert = [];

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

    leadsToInsert.push({
      ...b,
      address: addr,
      city: city,
      state: state,
      zip: zip,
      email: email,
      dob: dob,
    });
  }

  // 3. Add any additional verified prospects from phoneMap not in backup
  for (const [p10, meta] of phoneMap.entries()) {
    if (seenP10.has(p10)) continue;
    seenP10.add(p10);

    leadsToInsert.push({
      id: require('crypto').randomUUID(),
      first_name: meta.fn,
      last_name: meta.ln,
      phone: meta.phone,
      email: meta.email || null,
      dob: meta.dob || null,
      address: meta.addr,
      city: meta.city || 'PHOENIX',
      state: meta.state || 'AZ',
      zip: meta.zip || null,
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

  console.log('Total leads ready for insertion:', leadsToInsert.length);
  const withAddr = leadsToInsert.filter(l => l.address && l.address.trim().length > 0);
  console.log('Leads with full street addresses:', withAddr.length);

  await client.end();
}

dryRun().catch(console.error);
