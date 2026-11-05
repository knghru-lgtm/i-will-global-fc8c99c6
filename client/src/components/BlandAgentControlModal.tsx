import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';

interface BlandAgentControlModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BlandAgentControlModal: React.FC<BlandAgentControlModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<any>(null);
  const [recentCalls, setRecentCalls] = useState<any[]>([]);
  const [directory, setDirectory] = useState<any[]>([]);
  const [directorySearch, setDirectorySearch] = useState<string>('');
  const [showDirectory, setShowDirectory] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [activating, setActivating] = useState<boolean>(false);
  const [togglingWarmTransfer, setTogglingWarmTransfer] = useState<boolean>(false);
  const [quickPhone, setQuickPhone] = useState<string>('4803345557');
  const [prospectName, setProspectName] = useState<string>('Medicare Beneficiary');
  const [preferredApptType, setPreferredApptType] = useState<'telephone' | 'in_person' | 'video'>('telephone');
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const loadState = async () => {
    setLoading(true);
    try {
      const [cfgRes, callsRes, dirRes] = await Promise.all([
        api.get('/bland/config').catch(() => null),
        api.get('/bland/recent-calls').catch(() => ({ calls: [] })),
        api.get('/bland/directory').catch(() => ({ directory: [] })),
      ]);
      if (cfgRes) setConfig(cfgRes);
      if (callsRes?.calls) setRecentCalls(callsRes.calls);
      if (dirRes?.directory) setDirectory(dirRes.directory);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setStatusMsg('');
      setErrorMsg('');
      return;
    }
    loadState();
  }, [isOpen]);

  if (!isOpen) return null;

  const isOnWarmTransfer = Boolean(config?.is_on_warm_transfer);
  const isCampaignActive = Boolean(config?.is_campaign_active);

  const handleToggleWarmTransferMode = async (nextVal: boolean) => {
    setTogglingWarmTransfer(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await api.post('/bland/warm-transfer-mode', {
        on_warm_transfer: nextVal,
        reason: nextVal
          ? 'King Amen Ra is on a Warm Transfer call — AI selects ONLY Telephone, In-Person, or Video appointments and continues making calls'
          : undefined,
      });
      setConfig((prev: any) => ({
        ...(prev || {}),
        is_on_warm_transfer: Boolean(res.is_on_warm_transfer),
        operating_mode: res.operating_mode,
      }));
      setStatusMsg(res.message);
      window.dispatchEvent(new CustomEvent('iwg-bland-status-changed'));
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update Warm Transfer mode');
    } finally {
      setTogglingWarmTransfer(false);
    }
  };

  const handleActivateCampaign = async (dialSpecificPhone?: boolean) => {
    setActivating(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await api.post('/bland/activate', {
        phone: dialSpecificPhone && quickPhone.trim() ? quickPhone.trim() : undefined,
        prospect_name: dialSpecificPhone && prospectName.trim() ? prospectName.trim() : undefined,
        on_warm_transfer: isOnWarmTransfer,
        preferred_appointment_type: preferredApptType,
        continue_queue: true,
      });
      setConfig((prev: any) => ({
        ...(prev || {}),
        enabled: true,
        is_campaign_active: true,
        is_on_warm_transfer: Boolean(res.is_on_warm_transfer),
        operating_mode: res.operating_mode,
      }));
      setStatusMsg(res.message || 'Bland Agent AI activated and making calls!');
      window.dispatchEvent(new CustomEvent('iwg-bland-status-changed'));
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to activate Bland Agent AI');
    } finally {
      setActivating(false);
    }
  };

  const handleStopCampaign = async () => {
    setActivating(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await api.post('/bland/deactivate', {});
      setConfig((prev: any) => ({
        ...(prev || {}),
        is_campaign_active: false,
      }));
      setStatusMsg(res.message || 'Bland Agent AI autonomous queue stopped.');
      window.dispatchEvent(new CustomEvent('iwg-bland-status-changed'));
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to stop campaign');
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '720px',
          width: '94%',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: '16px',
          border: '2px solid #8b5cf6',
          background: 'var(--bg-card)',
          padding: '1.75rem',
          boxShadow: '0 16px 48px rgba(139, 92, 246, 0.35)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.6rem',
                boxShadow: '0 4px 14px rgba(139, 92, 246, 0.4)',
              }}
            >
              🤖
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
                  Bland Agent AI Command Center
                </h2>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '2px 10px',
                    borderRadius: '999px',
                    background: isCampaignActive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.15)',
                    border: `1px solid ${isCampaignActive ? '#10b981' : '#64748b'}`,
                    color: isCampaignActive ? '#34d399' : '#cbd5e1',
                  }}
                >
                  {isCampaignActive ? '● ACTIVE & MAKING CALLS' : '● STANDBY'}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                Agent ID: <code style={{ color: '#c084fc' }}>fc8c99c6-88c3-435d-952b-8c93c2db17a6</code> · Outbound Line: <strong style={{ color: '#e2e8f0' }}>+1 (520) 841-5736</strong> · Broker Line: <strong style={{ color: '#ffd88a' }}>+1 (602) 456-9681</strong>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Status / Error Alerts */}
        {statusMsg && (
          <div style={{ padding: '0.8rem 1rem', background: 'rgba(16, 185, 129, 0.14)', border: '1.5px solid #10b981', borderRadius: '10px', color: '#6ee7b7', fontSize: '0.86rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>✅</span> <span>{statusMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div style={{ padding: '0.8rem 1rem', background: 'rgba(239, 68, 68, 0.15)', border: '1.5px solid #ef4444', borderRadius: '10px', color: '#fca5a5', fontSize: '0.86rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚠️</span> <span>{errorMsg}</span>
          </div>
        )}

        {/* 1. WARM TRANSFER STATUS & APPOINTMENT-ONLY MODE SWITCH */}
        <div
          style={{
            background: isOnWarmTransfer
              ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(124, 58, 237, 0.18))'
              : 'rgba(255, 255, 255, 0.03)',
            border: isOnWarmTransfer ? '2px solid #f59e0b' : '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '1.1rem 1.25rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '240px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: '1rem', color: isOnWarmTransfer ? '#fbbf24' : '#f1f5f9' }}>
                <span>{isOnWarmTransfer ? '🔥' : '📞'}</span>
                <span>
                  {isOnWarmTransfer
                    ? 'I Am Currently On a Warm Transfer Call (Active)'
                    : 'Warm Transfer Status: Available for Live Transfer'}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginTop: '0.35rem', lineHeight: 1.45 }}>
                {isOnWarmTransfer ? (
                  <>
                    <strong>Agent AI Behavior:</strong> Sarah knows you are on a warm transfer call. She will <strong>NOT interrupt your line</strong>, will <strong>ONLY select Telephone, In-Person, or Video appointments</strong>, and will <strong>continue making calls</strong> through the queue!
                  </>
                ) : (
                  <>
                    <strong>Agent AI Behavior:</strong> When you are on a warm transfer call, toggle this ON (or initiate any transfer in the CRM) so Sarah automatically switches to booking <strong>Telephone, In-Person, or Video appointments only</strong> while continuing to make calls.
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={togglingWarmTransfer || loading}
              onClick={() => handleToggleWarmTransferMode(!isOnWarmTransfer)}
              style={{
                padding: '0.7rem 1.15rem',
                borderRadius: '10px',
                fontWeight: 800,
                fontSize: '0.86rem',
                cursor: 'pointer',
                border: isOnWarmTransfer ? '1.5px solid #10b981' : '1.5px solid #f59e0b',
                background: isOnWarmTransfer
                  ? 'rgba(16, 185, 129, 0.2)'
                  : 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: isOnWarmTransfer ? '#6ee7b7' : '#0b132b',
                boxShadow: isOnWarmTransfer ? 'none' : '0 4px 14px rgba(245, 158, 11, 0.35)',
                whiteSpace: 'nowrap',
              }}
            >
              {togglingWarmTransfer
                ? 'Updating...'
                : isOnWarmTransfer
                ? '✅ Warm Transfer Done (Resume Live Transfers)'
                : '🔥 Mark: I Am On a Warm Transfer Call'}
            </button>
          </div>

          {/* Strictly Allowed Appointment Types Pill Bar */}
          <div style={{ marginTop: '0.9rem', paddingTop: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1' }}>
              Allowed Appointment Types (Strictly Enforced by AI):
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {[
                { id: 'telephone', label: '📞 Telephone Appointment (30m)' },
                { id: 'in_person', label: '🤝 In-Person Appointment (60m)' },
                { id: 'video', label: '💻 Video Appointment (30m)' },
              ].map((t) => {
                const active = preferredApptType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPreferredApptType(t.id as any)}
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '0.3rem 0.7rem',
                      borderRadius: '999px',
                      cursor: 'pointer',
                      background: active ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.06)',
                      border: active ? '1.5px solid #c084fc' : '1px solid rgba(255,255,255,0.15)',
                      color: active ? '#f3e8ff' : '#cbd5e1',
                    }}
                  >
                    {t.label} {active ? '✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 2. ACTIVATE BLAND AGENT AI (QUEUE DIALER + IMMEDIATE NUMBER DIAL) */}
        <div
          style={{
            background: 'rgba(139, 92, 246, 0.08)',
            border: '1.5px solid rgba(139, 92, 246, 0.35)',
            borderRadius: '12px',
            padding: '1.25rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ fontWeight: 800, fontSize: '1rem', color: '#e9d5ff', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🚀</span>
            <span>Activate Bland Agent AI to Begin Making Calls</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', display: 'block', marginBottom: '0.3rem' }}>
                Direct / First Phone Number to Call
              </label>
              <input
                type="text"
                value={quickPhone}
                onChange={(e) => setQuickPhone(e.target.value)}
                placeholder="4803345557"
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  borderRadius: '8px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  color: '#fff',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', display: 'block', marginBottom: '0.3rem' }}>
                Beneficiary / Prospect Name
              </label>
              <input
                type="text"
                value={prospectName}
                onChange={(e) => setProspectName(e.target.value)}
                placeholder="Medicare Beneficiary"
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  borderRadius: '8px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  color: '#fff',
                  fontSize: '0.9rem',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={activating}
              onClick={() => handleActivateCampaign(true)}
              style={{
                flex: 1,
                minWidth: '230px',
                padding: '0.8rem 1.2rem',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg, #7c3aed, #9333ea)',
                color: '#fff',
                fontWeight: 800,
                fontSize: '0.92rem',
                cursor: activating ? 'not-allowed' : 'pointer',
                boxShadow: '0 6px 20px rgba(139, 92, 246, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <span>📞</span>
              <span>
                {activating
                  ? 'Activating & Dialing...'
                  : `Call ${quickPhone || 'Number'} Now & Continue Making Calls`}
              </span>
            </button>

            <button
              type="button"
              disabled={activating}
              onClick={() => handleActivateCampaign(false)}
              style={{
                flex: 1,
                minWidth: '220px',
                padding: '0.8rem 1.2rem',
                borderRadius: '10px',
                border: '1.5px solid #10b981',
                background: 'linear-gradient(135deg, #059669, #10b981)',
                color: '#fff',
                fontWeight: 800,
                fontSize: '0.92rem',
                cursor: activating ? 'not-allowed' : 'pointer',
                boxShadow: '0 6px 20px rgba(16, 185, 129, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <span>🚀</span>
              <span>Activate AI Lead Queue Dialer</span>
            </button>

            {isCampaignActive && (
              <button
                type="button"
                disabled={activating}
                onClick={handleStopCampaign}
                style={{
                  padding: '0.8rem 1rem',
                  borderRadius: '10px',
                  border: '1.5px solid #ef4444',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#fca5a5',
                  fontWeight: 800,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                }}
              >
                ⏹ Stop Queue
              </button>
            )}
          </div>
        </div>

        {/* 2.5 ACTIVE UNIFIED OUTBOUND SCRIPT & AUTOMATIC AI WHISPER FOR ALL */}
        <div
          style={{
            background: 'rgba(200, 150, 62, 0.08)',
            border: '1.5px solid rgba(200, 150, 62, 0.45)',
            borderRadius: '12px',
            padding: '1rem 1.2rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
            <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#ffd88a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span>📜</span>
              <span>Unified Outbound Script (2027 Medicare Changes) & Automatic AI Whisper</span>
            </div>
            <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', color: '#a7f3d0', fontWeight: 800 }}>
              🤖 Auto-Whisper Enabled for All
            </span>
          </div>
          <div style={{ fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.5, background: 'rgba(5, 16, 57, 0.65)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid rgba(200, 150, 62, 0.3)' }}>
            <div><strong>Opening:</strong> "Hello <em>[Prospect Name]</em>, this is <em>[Caller Name / Sarah]</em> calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"</div>
            <div style={{ marginTop: '0.3rem' }}><strong>Ultra-Clean 2027 Value Hook:</strong> "We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your Medicare options and protect your benefits, <strong>would you like to know about the upcoming changes for 2027?</strong>"</div>
            <div style={{ marginTop: '0.3rem', color: '#6ee7b7', fontSize: '0.78rem' }}>
              <strong>VIP Concierge Automatic AI Whisper for All:</strong> Sarah AI automatically whispers the private briefing to King Amen Ra and any of the 42 directory members before bridging the call.
            </div>
          </div>
        </div>

        {/* 3. INBOUND AI RECEPTIONIST, 6-PRODUCT FUNNEL & TEAM DIRECTORY TRANSFER */}
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.07)',
            border: '1.5px solid rgba(16, 185, 129, 0.35)',
            borderRadius: '12px',
            padding: '1.15rem 1.25rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.98rem', color: '#6ee7b7', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>🎧</span>
                <span>Inbound AI Receptionist, 6-Product Funnel & Directory Transfer (+1 520-841-5736)</span>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', color: '#a7f3d0' }}>
                  {directory.length || 42} Directory Members Active
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginTop: '0.3rem', lineHeight: 1.45 }}>
                <strong>Inbound Greeting:</strong> <em>"Thank you for calling IWG Insurance and Financial Services, how may I direct your call?"</em>
                <br />
                Sarah funnels callers to our <strong>6 Product Lines</strong> (<strong>Medicare 2027 Changes</strong>, <strong>Individual & Family Health</strong>, <strong>Group Health 1–50+</strong>, <strong>Investment Grade Life / IUL</strong>, <strong>Asset-Based Long Term Care</strong>, and <strong>Term Life with Living Benefits</strong>) or immediately executes an <strong>Automatic AI Whisper Transfer</strong> to anyone on the <strong>I Will Global Team Directory</strong>.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDirectory((v) => !v)}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid rgba(16, 185, 129, 0.5)',
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#a7f3d0',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {showDirectory ? 'Hide Directory ▲' : 'View Directory ▼'}
            </button>
          </div>

          {showDirectory && (
            <div style={{ marginTop: '0.85rem' }}>
              <input
                type="text"
                value={directorySearch}
                onChange={(e) => setDirectorySearch(e.target.value)}
                placeholder="Search directory by name, role, or phone (e.g., King Amen Ra, Aneesha, Robert Chen, Kamille)..."
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '8px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  color: '#fff',
                  fontSize: '0.82rem',
                  marginBottom: '0.65rem',
                }}
              />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                  gap: '0.45rem',
                  maxHeight: '190px',
                  overflowY: 'auto',
                  paddingRight: '0.25rem',
                }}
              >
                {directory
                  .filter((d: any) => {
                    const q = directorySearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      String(d.name || '').toLowerCase().includes(q) ||
                      String(d.role || '').toLowerCase().includes(q) ||
                      String(d.phone || '').toLowerCase().includes(q) ||
                      String(d.department || '').toLowerCase().includes(q)
                    );
                  })
                  .map((d: any) => (
                    <div
                      key={d.name}
                      style={{
                        padding: '0.45rem 0.65rem',
                        borderRadius: '8px',
                        background: 'var(--bg-surface)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        fontSize: '0.76rem',
                      }}
                    >
                      <div style={{ fontWeight: 800, color: '#f8fafc', display: 'flex', justifyContent: 'space-between', gap: '0.3rem' }}>
                        <span>{d.name}</span>
                        <span style={{ color: '#6ee7b7', fontFamily: 'monospace', fontSize: '0.72rem' }}>{d.phone}</span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginTop: '0.15rem' }}>{d.role}</div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* 4. RECENT BLAND AI CALLS */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#cbd5e1' }}>
              Recent Bland Agent AI Calls
            </span>
            <button
              type="button"
              onClick={loadState}
              style={{ background: 'none', border: 'none', color: '#c084fc', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
            >
              ↻ Refresh
            </button>
          </div>
          {recentCalls.length === 0 ? (
            <div style={{ padding: '0.9rem', borderRadius: '8px', background: 'var(--bg-surface)', color: '#94a3b8', fontSize: '0.82rem', textAlign: 'center' }}>
              No recent Bland AI calls logged yet in this session. Click <strong>Call Now</strong> or <strong>Activate AI Lead Queue Dialer</strong> above to begin!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '180px', overflowY: 'auto' }}>
              {recentCalls.map((c: any) => (
                <div
                  key={c.id}
                  style={{
                    padding: '0.55rem 0.8rem',
                    borderRadius: '8px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.8rem',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong style={{ color: '#f1f5f9' }}>{c.subject}</strong>
                    <span style={{ color: '#94a3b8', marginLeft: '0.5rem' }}>{c.phone}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {c.meta?.appointment_type && (
                      <span style={{ background: 'rgba(139, 92, 246, 0.2)', color: '#d8b4fe', padding: '1px 7px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700 }}>
                        Appt: {c.meta.appointment_type}
                      </span>
                    )}
                    <span style={{ color: '#34d399', fontWeight: 700 }}>{c.disposition || c.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

