const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_m6vHUV0eKqRD@ep-withered-base-b4fiirpw.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require' });
client.connect().then(() => {
  const hash = bcrypt.hashSync('heru5464', 10);
  return client.query("UPDATE users SET password_hash=$1 WHERE email='king@iwillglobal.com'", [hash]);
}).then(() => {
  console.log('Password successfully reset to heru5464');
  client.end();
}).catch(console.error);
