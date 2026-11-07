import React, { useState, useEffect } from 'react';
import { api, openGoogleVoiceWindow } from '../lib/api';

interface BlandVoice {
  id: string;
  name: string;
  gender: string;
  description: string;
  accent: string;
  is_recommended?: boolean;
}

interface BlandCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    state?: string;
    interest?: string;
    dob?: string;
  } | null;
  onCallDispatched?: (result: any) => void;
}

export const BlandCallModal: React.FC<BlandCallModalProps> = ({ isOpen, onClose, lead, onCallDispatched }) => {
  const [voices, setVoices] = useState<BlandVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('maya');
  const [transferNumber, setTransferNumber] = useState<string>('+16024569681');
  const [pathwayId, setPathwayId] = useState<string>('fc8c99c6-88c3-435d-952b-8c93c2db17a6');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [onWarmTransfer, setOnWarmTransfer] = useState<boolean>(false);
  const [isCampaignActive, setIsCampaignActive] = useState<boolean>(false);
  const [preferredAppointmentType, setPreferredAppointmentType] = useState<'telephone' | 'in_person' | 'video'>('telephone');
  const [loading, setLoading] = useState<boolean>(false);
  const [calling, setCalling] = useState<boolean>(false);
  const [stopping, setStopping] = useState<boolean>(false);
  const [callResult, setCallResult] = useState<any>(null);
  const [stopMessage, setStopMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!isOpen) {
      setCallResult(null);
      setStopMessage('');
      setError('');
      return;
    }

    setLoading(true);
    Promise.all([
      api.get('/bland/voices').catch(() => ({ voices: [] })),
      api.get('/bland/config').catch(() => null),
    ]).then(([voicesRes, configRes]) => {
      if (voicesRes?.voices) setVoices(voicesRes.voices);
      if (configRes) {
        if (configRes.default_voice) setSelectedVoice(configRes.default_voice);
        if (configRes.transfer_phone_number) setTransferNumber(configRes.transfer_phone_number);
        if (configRes.pathway_id) setPathwayId(configRes.pathway_id);
        if (configRes.prompt_template) setCustomPrompt(configRes.prompt_template);
        if (configRes.is_on_warm_transfer !== undefined) setOnWarmTransfer(Boolean(configRes.is_on_warm_transfer));
        if (configRes.is_campaign_active !== undefined) setIsCampaignActive(Boolean(configRes.is_campaign_active));
      }
    }).finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen || !lead) return null;

  const prospectName = `${lead.first_name} ${lead.last_name}`.trim();

  const handleToggleWarmTransfer = async (nextVal: boolean) => {
    setOnWarmTransfer(nextVal);
    try {
      await api.post('/bland/warm-transfer-mode', {
        on_warm_transfer: nextVal,
      });
      window.dispatchEvent(new CustomEvent('iwg-bland-status-changed'));
    } catch { /* ignore */ }
  };

  const handleStartOutboundCalls = async (continueQueue: boolean) => {
    setError('');
    setStopMessage('');
    setCalling(true);
    try {
      const res = continueQueue
        ? await api.post('/bland/activate', {
            lead_id: lead.id,
            phone: lead.phone,
            prospect_name: prospectName,
            voice: selectedVoice,
            on_warm_transfer: onWarmTransfer,
            preferred_appointment_type: preferredAppointmentType,
            continue_queue: true,
          })
        : await api.post('/bland/call', {
            lead_id: lead.id,
            phone: lead.phone,
            prospect_name: prospectName,
            voice: selectedVoice,
            pathway_id: pathwayId,
            custom_prompt: customPrompt || undefined,
            transfer_number: transferNumber,
            on_warm_transfer: onWarmTransfer,
            preferred_appointment_type: preferredAppointmentType,
          });

      const activeCallId = res.call_id || res.dispatched?.[0]?.call_id || null;
      setIsCampaignActive(Boolean(continueQueue || res.is_campaign_active));
      setCallResult({
        ...res,
        call_id: activeCallId,
      });
      if (lead?.phone) {
        openGoogleVoiceWindow(lead.phone);
      }
      window.dispatchEvent(
        new CustomEvent('iwg-open-sarah-voice', {
          detail: {
            mode: 'outbound',
            lead_id: lead.id,
            prospect_name: prospectName,
            phone: lead.phone,
            state: lead.state || 'AZ',
            on_warm_transfer: onWarmTransfer,
          },
        })
      );
      window.dispatchEvent(new CustomEvent('iwg-bland-status-changed'));
      if (onCallDispatched) onCallDispatched(res);
    } catch (err: any) {
      setError(err.message || 'Failed to start Sarah Outbound Caller calls');
    } finally {
      setCalling(false);
    }
  };

  const handleStopOutboundCalls = async () => {
    setError('');
    setStopping(true);
    try {
      const activeCallId = callResult?.call_id || undefined;
      const res = await api.post('/bland/stop', {
        call_id: activeCallId,
        stop_all: true,
      });
      setIsCampaignActive(false);
      setCallResult(null);
      setStopMessage(res.message || '🛑 All Sarah Outbound Caller calls and queue dialing have been stopped.');
      window.dispatchEvent(new CustomEvent('iwg-bland-status-changed'));
      if (onCallDispatched) onCallDispatched(res);
    } catch (err: any) {
      setError(err.message || 'Failed to stop Sarah Outbound Caller calls');
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '680px', width: '94%', borderRadius: '16px', border: '1.5px solid #8b5cf6', background: 'var(--bg-card)', padding: '1.75rem', boxShadow: '0 10px 40px rgba(139, 92, 246, 0.25)' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.8rem' }}>📞</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#c084fc' }}>
                  Sarah Outbound Call Control (480) 331-9455
                </h2>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    padding: '2px 9px',
                    borderRadius: '999px',
                    background: isCampaignActive || callResult ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.15)',
                    border: `1px solid ${isCampaignActive || callResult ? '#10b981' : '#64748b'}`,
                    color: isCampaignActive || callResult ? '#34d399' : '#cbd5e1',
                  }}
                >
                  {isCampaignActive || callResult ? '● ACTIVE & CALLING' : '● STANDBY'}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Activate Sarah Outbound Caller via Google Voice on (480) 331-9455
              </div>
            </div>
          </div>
          <button onClick={onClose} className="btn-close" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        {/* Instant Start / Stop Control Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
            background: 'rgba(139, 92, 246, 0.1)',
            border: '1.5px solid rgba(139, 92, 246, 0.35)',
            borderRadius: '12px',
            padding: '0.85rem 1rem',
            marginBottom: '1rem',
          }}
        >
          <div style={{ fontSize: '0.83rem', color: '#e2e8f0', fontWeight: 700 }}>
            ⚡ Quick Outbound Controls: Start or Stop Sarah Outbound Calling Anytime
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={calling || stopping || loading}
              onClick={() => handleStartOutboundCalls(true)}
              style={{
                padding: '0.5rem 0.95rem',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #059669, #10b981)',
                border: '1px solid #10b981',
                color: '#fff',
                fontWeight: 800,
                fontSize: '0.82rem',
                cursor: calling ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
              }}
            >
              <span>▶</span>
              <span>{calling ? 'Starting...' : 'Activate & Start Outbound Calls'}</span>
            </button>
            <button
              type="button"
              disabled={stopping}
              onClick={handleStopOutboundCalls}
              style={{
                padding: '0.5rem 0.95rem',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1.5px solid #ef4444',
                color: '#fca5a5',
                fontWeight: 800,
                fontSize: '0.82rem',
                cursor: stopping ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <span>⏹</span>
              <span>{stopping ? 'Stopping...' : 'Stop Outbound Calls'}</span>
            </button>
          </div>
        </div>

        {/* Lead Summary Pill */}
        <div style={{ background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.25)', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f1f5f9' }}>{prospectName}</div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              📞 {lead.phone} {lead.state ? `• State: ${lead.state}` : ''} {lead.interest ? `• Interest: ${lead.interest}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', color: '#38bdf8', padding: '2px 8px', borderRadius: '12px', fontFamily: 'monospace' }} title={`Google Voice Line: (480) 331-9455`}>
              Line: (480) 331-9455
            </span>
            <span style={{ fontSize: '0.74rem', background: '#8b5cf6', color: '#fff', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
              Target Beneficiary
            </span>
          </div>
        </div>

        {/* Warm Transfer Mode & Appointment Type Selector */}
        <div
          style={{
            background: onWarmTransfer ? 'rgba(245, 158, 11, 0.14)' : 'rgba(255, 255, 255, 0.03)',
            border: onWarmTransfer ? '1.5px solid #f59e0b' : '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '0.85rem 1rem',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 800, fontSize: '0.86rem', color: onWarmTransfer ? '#fbbf24' : '#e2e8f0' }}>
              <input
                type="checkbox"
                checked={onWarmTransfer}
                onChange={(e) => handleToggleWarmTransfer(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#f59e0b', cursor: 'pointer' }}
              />
              <span>🔥 I Am On a Warm Transfer Call (Book Appt Only & Continue Calling)</span>
            </label>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: onWarmTransfer ? '#fcd34d' : '#34d399' }}>
              {onWarmTransfer ? 'APPOINTMENT-ONLY MODE' : 'LIVE TRANSFER + APPT MODE'}
            </span>
          </div>
          <div style={{ fontSize: '0.76rem', color: '#cbd5e1', marginTop: '0.35rem' }}>
            {onWarmTransfer
              ? 'Agent knows you are on a warm transfer call — she will ONLY select Telephone, In-Person, or Video appointments and continue making calls.'
              : 'Agent will warm-transfer qualified prospects to +16024569681 with Automatic AI Whisper or book Telephone, In-Person, or Video appointments.'}
          </div>
          <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8' }}>Appointment Type:</span>
            {[
              { id: 'telephone', label: '📞 Telephone (30m)' },
              { id: 'in_person', label: '🤝 In-Person (60m)' },
              { id: 'video', label: '💻 Video (30m)' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPreferredAppointmentType(t.id as any)}
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  padding: '0.25rem 0.65rem',
                  borderRadius: '999px',
                  cursor: 'pointer',
                  background: preferredAppointmentType === t.id ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.06)',
                  border: preferredAppointmentType === t.id ? '1.5px solid #c084fc' : '1px solid rgba(255,255,255,0.15)',
                  color: preferredAppointmentType === t.id ? '#f3e8ff' : '#cbd5e1',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {stopMessage && (
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(245, 158, 11, 0.15)', border: '1.5px solid #f59e0b', borderRadius: '8px', color: '#fde68a', fontSize: '0.85rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🛑</span> <span>{stopMessage}</span>
          </div>
        )}

        {error && (
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', color: '#fca5a5', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚠️</span> <span>{error}</span>
          </div>
        )}

        {callResult ? (
          <div style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1.5px solid #10b981', borderRadius: '12px', padding: '1.25rem', textAlign: 'center', margin: '1rem 0' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📞✨</div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#34d399', margin: '0 0 0.35rem 0' }}>
              Google Voice + Sarah Outbound Call Active!
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#e2e8f0', margin: '0 0 0.8rem 0' }}>
              {callResult.message || `Dialing ${prospectName} (${lead.phone})...`}
            </p>
            {callResult.call_id && (
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '6px', fontFamily: 'monospace' }}>
                Call ID: <strong>{callResult.call_id}</strong>
              </div>
            )}
            <div style={{ marginTop: '1.2rem', display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={stopping}
                onClick={handleStopOutboundCalls}
                style={{
                  padding: '0.6rem 1.3rem',
                  borderRadius: '8px',
                  fontWeight: 800,
                  background: '#ef4444',
                  border: 'none',
                  color: '#fff',
                  cursor: stopping ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.35)',
                }}
              >
                <span>⏹</span>
                <span>{stopping ? 'Stopping Call...' : 'Stop Call & Halt Outbound Queue'}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn-primary"
                style={{ padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: 700, background: '#10b981', border: 'none', color: '#fff', cursor: 'pointer' }}
              >
                Keep Calling & Close
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Form */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#cbd5e1', display: 'block', marginBottom: '0.35rem' }}>
                  AI Voice Persona
                </label>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  disabled={loading || calling}
                  style={{ width: '100%', padding: '0.65rem 0.8rem', borderRadius: '8px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.88rem' }}
                >
                  {voices.length > 0 ? (
                    voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.gender}, {v.accent}) {v.is_recommended ? '★ Recommended' : ''}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="maya">Maya (Warm & Senior-Friendly ★ Recommended)</option>
                      <option value="nat">Nat (Conversational Female)</option>
                      <option value="josh">Josh (Friendly Male)</option>
                      <option value="florence">Florence (Calm Healthcare)</option>
                      <option value="florin">Florin (Bilingual US/ES)</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#cbd5e1', display: 'block', marginBottom: '0.35rem' }}>
                  Live Warm Transfer Line
                </label>
                <input
                  type="text"
                  value={transferNumber}
                  onChange={(e) => setTransferNumber(e.target.value)}
                  disabled={loading || calling}
                  placeholder="+16024569681"
                  style={{ width: '100%', padding: '0.65rem 0.8rem', borderRadius: '8px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.88rem' }}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleStopOutboundCalls}
                disabled={stopping || calling}
                style={{
                  padding: '0.65rem 1.15rem',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.16)',
                  border: '1.5px solid #ef4444',
                  color: '#fca5a5',
                  cursor: stopping ? 'not-allowed' : 'pointer',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                }}
              >
                ⏹ Stop All Outbound Calls
              </button>

              <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={calling}
                  style={{ padding: '0.65rem 1.1rem', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleStartOutboundCalls(false)}
                  disabled={calling || loading}
                  style={{
                    padding: '0.65rem 1.15rem',
                    borderRadius: '8px',
                    background: 'rgba(139, 92, 246, 0.25)',
                    border: '1.5px solid #a855f7',
                    color: '#e9d5ff',
                    cursor: calling ? 'not-allowed' : 'pointer',
                    fontWeight: 700,
                    fontSize: '0.86rem',
                  }}
                >
                  📞 Call This Lead Only
                </button>
                <button
                  type="button"
                  onClick={() => handleStartOutboundCalls(true)}
                  disabled={calling || loading}
                  style={{
                    padding: '0.65rem 1.35rem',
                    borderRadius: '8px',
                    background: calling ? '#6d28d9' : 'linear-gradient(135deg, #7c3aed, #9333ea)',
                    border: 'none',
                    color: '#fff',
                    cursor: calling ? 'not-allowed' : 'pointer',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    boxShadow: '0 4px 14px rgba(139, 92, 246, 0.4)',
                  }}
                >
                  <span>🤖</span>
                  <span>{calling ? 'Starting Outbound Calls...' : 'Start Outbound Calls (Lead + Queue)'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
