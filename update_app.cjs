const fs = require('fs');
let c = fs.readFileSync('client/src/App.tsx', 'utf8');

c = c.replace('const LoginPage: React.FC = () => {', 'const LoginPage: React.FC = () => { const [isRegistering, setIsRegistering] = React.useState(false); const [name, setName] = React.useState("");');

c = c.replace('await login(email, password);', `
      if (isRegistering) {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');
      }
      await login(email, password);
`);

c = c.replace(
  '<form onSubmit={handleSubmit} style={{ display: \'flex\', flexDirection: \'column\', gap: \'1rem\' }}>',
  '<form onSubmit={handleSubmit} style={{ display: \'flex\', flexDirection: \'column\', gap: \'1rem\' }}>\n{isRegistering && (<div><label style={{ fontSize: \'0.85rem\', fontWeight: 600, display: \'block\', marginBottom: \'0.35rem\', color: \'#cbd5e1\' }}>Full Name</label><input type="text" required value={name} onChange={(e) => setName(e.target.value)} style={{ width: \'100%\', padding: \'0.75rem\', borderRadius: \'8px\', backgroundColor: \'#1b2a59\', border: \'1px solid #243566\', color: \'#fff\', fontSize: \'0.9rem\' }} /></div>)}'
);

c = c.replace(
  "{loading ? 'Signing In...' : 'Sign In with @iwillglobal.com'}",
  "{loading ? 'Please Wait...' : isRegistering ? 'Register Account' : 'Sign In with @iwillglobal.com'}"
);

c = c.replace(
  '</form>',
  '</form><div style={{ marginTop: \'1rem\', textAlign: \'center\' }}><button type="button" onClick={() => { setIsRegistering(!isRegistering); setError(\'\'); }} style={{ background: \'none\', border: \'none\', color: \'#60a5fa\', fontSize: \'0.85rem\', cursor: \'pointer\', textDecoration: \'underline\' }}>{isRegistering ? \'Already have an account? Sign in\' : \'New agent? Register your @iwillglobal.com email\'}</button></div>'
);

fs.writeFileSync('client/src/App.tsx', c);
