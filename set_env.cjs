const { execSync } = require('child_process');
execSync('npx vercel env add VITE_API_URL production', {
  input: 'https://tea-db60p2navr4c73abq5ig.onrender.com',
  env: { ...process.env, NODE_OPTIONS: '--use-system-ca' },
  stdio: ['pipe', 'inherit', 'inherit']
});
