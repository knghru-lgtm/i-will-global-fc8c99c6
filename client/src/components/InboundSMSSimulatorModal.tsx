import React, { useState } from 'react';
import { api } from '../lib/api';

interface InboundSMSSimulatorModalProps {
  defaultPhone?: string;
  onClose: () => void;
  onProcessed?: (res: any) => void;
}

export const InboundSMSSimulatorModal: React.FC<InboundSMSSimulatorModalProps> = ({ defaultPhone = '(480) 555-0183', onClose, onProcessed }) => {
  const [phone, setPhone] = useState<string>(defaultPhone);
  const [text, setText] = useState<string>('YES');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string>('');

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await api.post('/public/sms/inbound', { phone, text });
      setResponse(res);
      if (onProcessed) onProcessed(res);
    } catch (err: any) {
      setError(err.message || 'SMS processing error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: '520px', width: '90%' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--accent)', fontSize: '1.15rem' }}>
              📱 Customer SMS Reply Simulator
            </h3>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Test how customer "YES" / "Y" SMS reply awards scheduler lead credit!
            </div>
          </div>
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: '0.2rem 0.5rem' }}>✕</button>
        </div>

        {response ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ background: response.confirmed ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${response.confirmed ? '#10b981' : '#ef4444'}`, padding: '1rem', borderRadius: '10px' }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: response.confirmed ? '#10b981' : '#ef4444', marginBottom: '0.4rem' }}>
                {response.confirmed ? '🎉 Customer Confirmed & Scheduler Credited!' : '❌ Appointment Cancelled'}
              </div>
              <div style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>
                {response.details || response.message}
              </div>
              {response.credited_scheduler_name && (
                <div style={{ marginTop: '0.5rem', fontWeight: 700, color: 'var(--accent)', fontSize: '0.9rem' }}>
                  🏅 Credited Scheduler: {response.credited_scheduler_name}
                </div>
              )}
            </div>

            <div style={{ background: 'var(--bg-surface)', padding: '0.85rem', borderRadius: '8px' }}>
              <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                Automated SMS Reply Sent Back to Customer:
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--accent)', fontStyle: 'italic' }}>
                "{response.customer_message}"
              </div>
            </div>

            <button className="btn btn-primary" onClick={() => setResponse(null)} style={{ padding: '0.6rem' }}>
              Test Another Reply
            </button>
          </div>
        ) : (
          <form onSubmit={handleSimulate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {error && (
              <div style={{ padding: '0.6rem', backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: '6px', fontSize: '0.85rem' }}>
                ⚠️ {error}
              </div>
            )}

            <div>
              <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                Customer Phone Number
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(480) 555-0183"
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                }}
              />
            </div>

            <div>
              <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                Simulated Customer Text Reply *
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setText('YES')} style={{ flex: 1, padding: '0.35rem', fontSize: '0.82rem' }}>"YES"</button>
                <button type="button" className="btn btn-secondary" onClick={() => setText('Y')} style={{ flex: 1, padding: '0.35rem', fontSize: '0.82rem' }}>"Y"</button>
                <button type="button" className="btn btn-secondary" onClick={() => setText('confirm')} style={{ flex: 1, padding: '0.35rem', fontSize: '0.82rem' }}>"confirm"</button>
                <button type="button" className="btn btn-secondary" onClick={() => setText('CANCEL')} style={{ flex: 1, padding: '0.35rem', fontSize: '0.82rem', color: '#ef4444' }}>"CANCEL"</button>
              </div>
              <input
                type="text"
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="YES or Y"
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  fontWeight: 700,
                }}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ padding: '0.75rem', fontWeight: 700 }}>
              {submitting ? 'Processing SMS...' : '📱 Simulate Inbound Customer Reply'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
