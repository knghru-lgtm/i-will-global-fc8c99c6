import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

export const PublicSOAPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [soa, setSoa] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [signerName, setSignerName] = useState('');
  const [relationship] = useState('Self');
  const [submitting, setSubmitting] = useState(false);
  const [signedSuccess, setSignedSuccess] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/soa/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error('Scope of Appointment form not found or link expired');
        return res.json();
      })
      .then((data) => {
        setSoa(data);
        if (data.status === 'Signed') setSignedSuccess(true);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signerName.trim()) { setError('Please type your full legal name'); return; }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch(`/api/public/soa/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer_name: signerName, relationship }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sign form');
      setSignedSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Loading Scope of Appointment form...</div>;
  if (error && !soa) return <div style={{ textAlign: 'center', padding: '3rem', color: '#ef4444' }}>⚠️ {error}</div>;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0b132b', color: '#f1f5f9', display: 'flex', justifyContent: 'center', padding: '2rem 1rem' }}>
      <div style={{ width: '100%', maxWidth: '640px', backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '16px', padding: '2rem', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', height: 'fit-content' }}>
        {/* Header */}
        <div style={{ borderBottom: '1px solid #243566', paddingBottom: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#16245c', border: '1px solid #c8963e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c8963e', fontWeight: 700, fontSize: '1.2rem' }}>
            IWG
          </div>
          <div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Scope of Appointment Confirmation</h1>
            <div style={{ color: '#c8963e', fontSize: '0.85rem', fontWeight: 600 }}>I Will Global Insurance Agency</div>
          </div>
        </div>

        {signedSuccess ? (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#10b981', marginBottom: '0.5rem' }}>Scope of Appointment Confirmed!</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.95rem' }}>
              Thank you, <strong>{soa.signer_name || signerName}</strong>. Your confirmation has been securely logged with your agent <strong>{soa.agent_name || 'I Will Global Specialist'}</strong>.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSign} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {error && (
              <div style={{ padding: '0.75rem', backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', fontSize: '0.88rem' }}>
                ⚠️ {error}
              </div>
            )}

            <div style={{ background: '#16244d', padding: '1rem', borderRadius: '10px', fontSize: '0.88rem', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, color: '#c8963e', marginBottom: '0.5rem' }}>Medicare Required Disclosure</div>
              The Centers for Medicare & Medicaid Services (CMS) requires agents to document the scope of a marketing appointment prior to discussing Medicare Advantage or Prescription Drug Plans. By signing below, you agree to discuss the product types indicated.
            </div>

            <div>
              <label style={{ fontWeight: 600, fontSize: '0.88rem', display: 'block', marginBottom: '0.5rem', color: '#c8963e' }}>
                Products to be Discussed:
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.88rem' }}>
                {(soa.products || ['Medicare Advantage (Part C)', 'Prescription Drug Plan (Part D)', 'Medicare Supplement (Medigap)']).map((p: string) => (
                  <div key={p} style={{ background: '#1b2a59', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                    ✔ {p}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontWeight: 600, fontSize: '0.88rem', display: 'block', marginBottom: '0.35rem' }}>
                Beneficiary Full Name *
              </label>
              <input
                type="text"
                required
                placeholder="Type your full legal name to e-sign"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', backgroundColor: '#1b2a59', border: '1px solid #243566', color: '#fff', fontSize: '0.95rem' }}
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !signerName}
              style={{ width: '100%', padding: '0.85rem', borderRadius: '8px', background: 'linear-gradient(135deg, #c8963e, #e0ac53)', color: '#051039', fontWeight: 700, fontSize: '1rem', border: 'none', cursor: 'pointer', marginTop: '0.5rem' }}
            >
              {submitting ? 'Submitting Signature...' : '✍️ Confirm & E-Sign Scope of Appointment'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
