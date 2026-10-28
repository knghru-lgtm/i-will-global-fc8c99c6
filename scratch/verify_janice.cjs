const { Client } = require('pg');

async function testJaniceView() {
  const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_m6vHUV0eKqRD@ep-withered-base-b4fiirpw.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require' });
  await client.connect();

  const res = await client.query(`
    SELECT id, first_name, last_name, phone, address, city, state, zip, score
    FROM leads
    WHERE owner_id = 'u_sch_jvanado'
    ORDER BY score DESC, created_at DESC
    LIMIT 10
  `);

  console.log('Janice top 10 leads in CRM:');
  console.table(res.rows);

  const missingName = await client.query(`
    SELECT count(*)::int AS c FROM leads
    WHERE owner_id = 'u_sch_jvanado'
      AND (first_name IS NULL OR first_name = '' OR first_name ILIKE '%prospect%')
  `);
  console.log('Janice leads with missing or placeholder names:', missingName.rows[0].c);

  const missingAddr = await client.query(`
    SELECT count(*)::int AS c FROM leads
    WHERE owner_id = 'u_sch_jvanado'
      AND (address IS NULL OR trim(address) = '')
  `);
  console.log('Janice leads with missing addresses:', missingAddr.rows[0].c);

  await client.end();
}

testJaniceView().catch(console.error);
