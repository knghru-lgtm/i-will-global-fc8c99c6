const { Client } = require('pg');
const xlsx = require('xlsx');

async function testMatch() {
  const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_m6vHUV0eKqRD@ep-withered-base-b4fiirpw.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require' });
  await client.connect();

  const backupLeads = await client.query("SELECT id, first_name, last_name, phone, owner_id FROM leads_backup_20261024 WHERE first_name != 'Prospect'");
  console.log('Real leads in backup:', backupLeads.rows.length);

  const wb = xlsx.readFile('C:/Users/knghr/Downloads/IWG_2026_Prospects_10k_Part_1_FINAL.xlsx');
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const phoneToAddr = new Map();
  for (const r of rows) {
    const raw = String(r.Mobile || r.Phone || '').replace(/\D/g, '');
    if (raw.length >= 10) {
      const p10 = raw.slice(-10);
      phoneToAddr.set(p10, {
        addr: String(r['Address 1'] || '').trim(),
        city: String(r.City || '').trim(),
        state: String(r.State || 'AZ').trim(),
        zip: String(r.Zip || '').trim(),
        dob: String(r.DOB || '').trim(),
        email: String(r.Email || '').trim()
      });
    }
  }

  let matched = 0;
  for (const b of backupLeads.rows) {
    const p10 = String(b.phone || '').replace(/\D/g, '').slice(-10);
    if (phoneToAddr.has(p10)) matched++;
  }
  console.log('Matched phones between backup real leads and Part 1 Final:', matched, 'out of', backupLeads.rows.length);
  await client.end();
}

testMatch().catch(console.error);
