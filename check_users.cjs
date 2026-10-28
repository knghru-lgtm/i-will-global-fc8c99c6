const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_m6vHUV0eKqRD@ep-withered-base-b4fiirpw.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require' });
client.connect().then(() => {
  return client.query('SELECT email, role FROM users');
}).then(res => {
  console.log(res.rows);
  client.end();
}).catch(console.error);
