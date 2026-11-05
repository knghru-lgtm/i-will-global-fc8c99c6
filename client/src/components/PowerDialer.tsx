import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, formatPhone, googleVoiceWebUrl, googleVoiceAppUrl, telDialUrl, getStoredGvSlot, setStoredGvSlot, isSafariBrowser, isAppleDevice, copyToClipboard, type GvAccountSlot } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CallPanel } from './CallPanel';
import { OutboundScriptModal } from './OutboundScriptModal';
import { WarmTransferModal } from './WarmTransferModal';
import { BlandCallModal } from './BlandCallModal';

export const PowerDialer: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const prevPathRef = useRef(location.pathname);
  const [queue, setQueue] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeCallContact, setActiveCallContact] = useState<any>(null);
  const [isScriptOpen, setIsScriptOpen] = useState<boolean>(false);
  const [isWarmTransferOpen, setIsWarmTransferOpen] = useState<boolean>(false);
  const [isBlandModalOpen, setIsBlandModalOpen] = useState<boolean>(false);
  const [popupBlocked, setPopupBlocked] = useState<boolean>(false);
  const [gvSlot, setGvSlot] = useState<GvAccountSlot>(getStoredGvSlot());
  const [copiedPhone, setCopiedPhone] = useState<boolean>(false);

  const handleSelectGvSlot = (slot: GvAccountSlot) => {
    setGvSlot(slot);
    setStoredGvSlot(slot);
  };

  const handleCopyPhone = (num?: string) => {
    if (!num) return;
    const digits = num.replace(/\D/g, '');
    const toCopy = digits.length === 10 ? `+1${digits}` : num;
    copyToClipboard(toCopy);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const handleExitToDashboard = () => {
    onClose();
    navigate('/dashboard');
  };

  const handleExitToLeads = () => {
    onClose();
    navigate('/leads');
  };

  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      prevPathRef.current = location.pathname;
      if (isOpen) {
        onClose();
      }
    }
  }, [location.pathname, isOpen, onClose]);

  // Handle Escape key to exit dialer
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !activeCallContact && !isScriptOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeCallContact, isScriptOpen, onClose]);

  // Handle 's' / 'S' or Alt+S (outside inputs) to toggle lead script
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      const isInput = activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable;
      if (isInput) return;

      if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setIsScriptOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    api.get('/calls/queue?limit=50')
      .then((res) => {
        setQueue(res.rows || []);
        setCurrentIndex(0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen]);

  const [undispositionedLeadId, setUndispositionedLeadId] = useState<string | null>(null);
  const [dispositionError, setDispositionError] = useState<string>('');
  const [trunkCalling, setTrunkCalling] = useState<boolean>(false);
  const [trunkCallMsg, setTrunkCallMsg] = useState<string>('');

  if (!isOpen) return null;

  const currentLead = queue[currentIndex];
  const isLiveCallActive = Boolean(
    trunkCallMsg ||
    (undispositionedLeadId && currentLead && undispositionedLeadId === currentLead.id)
  );

  const triggerCall = (lead: any) => {
    if (!lead) return;
    setUndispositionedLeadId(lead.id);
    setDispositionError('');
    setActiveCallContact({
      id: lead.id,
      name: `${lead.first_name} ${lead.last_name}`,
      phone: lead.phone,
      email: lead.email,
      address: lead.address,
      city: lead.city,
      zip: lead.zip,
      type: 'lead',
      state: lead.state,
      status: lead.status,
    });
  };

  const handleNext = () => {
    if (undispositionedLeadId && currentLead && undispositionedLeadId === currentLead.id) {
      setDispositionError(`⚠️ Call Incomplete: You must select a disposition for ${currentLead.first_name} ${currentLead.last_name} before going to the next prospect.`);
      if (!activeCallContact) {
        triggerCall(currentLead);
      }
      return;
    }
    setDispositionError('');
    setPopupBlocked(false);
    if (currentIndex < queue.length - 1) setCurrentIndex((i) => i + 1);
  };

  const handlePrev = () => {
    if (undispositionedLeadId && currentLead && undispositionedLeadId === currentLead.id) {
      setDispositionError(`⚠️ Call Incomplete: You must select a disposition for the current prospect before switching.`);
      return;
    }
    setDispositionError('');
    setPopupBlocked(false);
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };

  const handleQuickDisposition = async (lead: any, dispositionId: string) => {
    try {
      await api.post('/calls/quick-disposition', {
        related_type: 'lead',
        related_id: lead.id,
        disposition_id: dispositionId,
        notes: `Quick dispositioned in Power Dialer: ${dispositionId}`,
        duration_sec: 30,
      });
      setUndispositionedLeadId(null);
      setDispositionError('');
      if (currentIndex < queue.length - 1) {
        setCurrentIndex((i) => i + 1);
      }
    } catch (err: any) {
      alert(`Failed to save disposition: ${err.message}`);
    }
  };

  return (
    <div className="slideover-overlay" onClick={onClose}>
      <div className="slideover-panel" onClick={(e) => e.stopPropagation()} style={{ width: '600px' }}>
        <div className="slideover-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.4rem' }}>⚡</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: '1.15rem' }}>Power Dialer Queue</span>
                <span style={{ fontSize: '0.7rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.35)', borderRadius: '12px', padding: '0.12rem 0.5rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span>🛡️</span> {user?.caller_id_name || 'Medicare Helpline by IWG'}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>
                {queue.length ? `Lead ${currentIndex + 1} of ${queue.length}` : 'Empty queue'}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#38bdf8', marginTop: '0.15rem' }}>
                Caller: <strong>{user?.name || 'JaKeeta Sullivan'}</strong> · Google Voice Line: <strong>{user?.phone || '(602) 456-2760'}</strong> · <span style={{ color: '#94a3b8' }}>CNAM:</span> <strong style={{ color: '#6ee7b7' }}>{user?.cnam || 'MEDICARE BY IWG'}</strong>
                <span style={{ fontSize: '0.68rem', color: '#a7f3d0', background: 'rgba(5, 150, 105, 0.2)', border: '1px solid rgba(5, 150, 105, 0.4)', borderRadius: '4px', padding: '0.1rem 0.35rem', marginLeft: '0.35rem' }} title="Verified with Free Caller Registry to eliminate Spam Concern flags">
                  ✓ Anti-Spam Whitelist Active
                </span>
                {isSafariBrowser() && (
                  <span style={{ fontSize: '0.7rem', color: '#fcd34d', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '4px', padding: '0.1rem 0.35rem', marginLeft: '0.4rem' }}>
                    🍎 Safari Mode
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.3rem', fontSize: '0.72rem', flexWrap: 'wrap' }}>
                <span style={{ color: '#94a3b8' }}>Dialer Slot:</span>
                {(['0', '1', 'email', 'default'] as GvAccountSlot[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleSelectGvSlot(s)}
                    style={{
                      background: gvSlot === s ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                      color: gvSlot === s ? '#0b132b' : '#cbd5e1',
                      border: '1px solid ' + (gvSlot === s ? 'var(--accent)' : 'rgba(255,255,255,0.15)'),
                      borderRadius: '4px',
                      padding: '0.12rem 0.45rem',
                      fontSize: '0.7rem',
                      fontWeight: gvSlot === s ? 750 : 500,
                      cursor: 'pointer',
                    }}
                    title={
                      s === '0' ? 'Primary Google Account (/u/0/)' :
                      s === '1' ? 'Secondary Google Account (/u/1/)' :
                      s === 'email' ? `Target Work Email (${user?.email || 'email'})` :
                      'Active Browser Session Default'
                    }
                  >
                    {s === '0' ? 'Acct 0' : s === '1' ? 'Acct 1' : s === 'email' ? 'By Email' : 'Default'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToDashboard}
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              title="Exit dialer and return to Dashboard"
            >
              <span>🏠</span> <span>Dashboard</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToLeads}
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              title="Exit dialer and return to Leads Workflow"
            >
              <span>📋</span> <span>Leads</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsScriptOpen((prev) => !prev)}
              style={{
                padding: '0.35rem 0.7rem',
                fontSize: '0.8rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                backgroundColor: isScriptOpen ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.06)',
                borderColor: isScriptOpen ? '#3b82f6' : '#243566',
                color: isScriptOpen ? '#93c5fd' : '#fff',
              }}
              title={isScriptOpen ? 'Close script view and return to lead (Esc)' : 'Open Outbound Call Script (Press S)'}
            >
              <span>📜</span> <span>{isScriptOpen ? '← Lead (Hide Script)' : 'Lead Script'}</span>
            </button>
            {isLiveCallActive ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsWarmTransferOpen(true)}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)',
                  backgroundColor: 'rgba(200, 150, 62, 0.15)',
                }}
                title="Initiate Live 3-Way Warm Transfer (Agent + Scheduler + Prospect)"
              >
                <span>⚡</span> <span>3-Way Transfer</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                disabled
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  borderColor: 'rgba(255,255,255,0.1)',
                  color: '#64748b',
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  cursor: 'not-allowed',
                  opacity: 0.6,
                }}
                title="Only available once connected on a live call with prospect"
              >
                <span>🔒</span> <span>3-Way Transfer</span>
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={onClose}
              style={{
                padding: '0.4rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
              title="Exit and close Power Dialer (Esc)"
            >
              <span>🚪</span> <span>Exit Dialer</span>
            </button>
          </div>
        </div>

        <div className="slideover-body">
          {loading && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Building dial queue...</div>}

          {!loading && !currentLead && (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🎉</div>
              <div style={{ fontWeight: 700, fontSize: '1.2rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                Queue Finished!
              </div>
              <p style={{ maxWidth: '400px', margin: '0 auto 1.5rem', lineHeight: 1.5 }}>
                No more leads to dial in this list. Great work powering through your queue!
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleExitToDashboard}
                  style={{ padding: '0.65rem 1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <span>🏠</span> <span>Exit to Dashboard</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleExitToLeads}
                  style={{ padding: '0.65rem 1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <span>📋</span> <span>Exit to Leads</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                  style={{ padding: '0.65rem 1.25rem', fontWeight: 600 }}
                >
                  🚪 Close Dialer
                </button>
              </div>
            </div>
          )}

          {!loading && currentLead && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Lead Card */}
              <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div>
                    <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                      👤 {currentLead.first_name} {currentLead.last_name}
                    </h3>
                    <div style={{ fontSize: '0.95rem', color: 'var(--accent)', fontWeight: 700, marginTop: '0.25rem' }}>
                      📞 {formatPhone(currentLead.phone)}
                    </div>
                    <div style={{ fontSize: '0.86rem', color: '#e2e8f0', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ color: 'var(--accent)' }}>📍</span>
                      <strong style={{ color: '#ffd88a' }}>Address:</strong>
                      <span>
                        {currentLead.address ? `${currentLead.address}, ` : ''}{currentLead.city || ''}, {currentLead.state || 'AZ'} {currentLead.zip || ''}
                      </span>
                    </div>
                  </div>
                  <span className="badge badge-gold" style={{ fontSize: '0.85rem' }}>
                    Score {currentLead.score} / 100
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  <div>Source: <strong style={{ color: 'var(--text-main)' }}>{currentLead.source || 'Direct'}</strong></div>
                  <div>Status: <strong style={{ color: 'var(--text-main)' }}>{currentLead.status}</strong></div>
                  <div>Interest: <strong style={{ color: 'var(--text-main)' }}>{currentLead.interest || 'Medicare'}</strong></div>
                  <div>Attempts: <strong style={{ color: 'var(--text-main)' }}>{currentLead.attempts || 0}</strong></div>
                </div>

                {currentLead.score_reason && (
                  <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'var(--bg-input)', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--accent)' }}>
                    💡 {currentLead.score_reason}
                  </div>
                )}
              </div>

              {/* Callable Hours check */}
              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  backgroundColor: currentLead.callable_now ? 'var(--success-bg)' : 'var(--warning-bg)',
                  color: currentLead.callable_now ? 'var(--success)' : 'var(--warning)',
                  border: `1px solid ${currentLead.callable_now ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
                }}
              >
                {currentLead.callable_now
                  ? '✅ Within TCPA calling hours (8am–9pm local recipient time)'
                  : '⚠️ Outside TCPA calling hours — manager override required'}
              </div>

              {/* Dedicated Live Warm Transfer Card */}
              <div
                style={{
                  background: isLiveCallActive
                    ? 'linear-gradient(135deg, rgba(200, 150, 62, 0.22), rgba(5, 16, 57, 0.95))'
                    : 'rgba(255, 255, 255, 0.03)',
                  border: isLiveCallActive
                    ? '1.5px solid var(--accent)'
                    : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  padding: '0.9rem 1.1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem', color: isLiveCallActive ? 'var(--accent)' : '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>{isLiveCallActive ? '⚡' : '🔒'}</span>
                    <span>{isLiveCallActive ? 'Live Warm Transfer to Licensed Specialist' : 'Warm Transfer (Locked - Connect Call First)'}</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: isLiveCallActive ? '#e2e8f0' : '#64748b', marginTop: '0.2rem' }}>
                    {isLiveCallActive
                      ? `Connect ${currentLead.first_name} ${currentLead.last_name} live to King Amen Ra at (602) 456-9681 ($25 scheduler credit)`
                      : `Only available once connected on a live call with ${currentLead.first_name}. Dial below to connect first.`}
                  </div>
                </div>
                {isLiveCallActive ? (
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => setIsWarmTransferOpen(true)}
                    style={{
                      fontWeight: 800,
                      padding: '0.6rem 1rem',
                      fontSize: '0.88rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      boxShadow: '0 4px 15px rgba(212, 160, 76, 0.35)',
                    }}
                    title="Initiate live 3-way warm transfer handoff to King Amen Ra at (602) 456-9681"
                  >
                    <span>⚡</span>
                    <span>3-Way Warm Transfer → King (602) 456-9681</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    style={{
                      fontWeight: 700,
                      padding: '0.6rem 1rem',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: '#64748b',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '6px',
                      cursor: 'not-allowed',
                      opacity: 0.65,
                    }}
                    title="Only available once connected on a live call with prospect. Dial below to connect."
                  >
                    <span>🔒</span>
                    <span>Warm Transfer (Locked)</span>
                  </button>
                )}
              </div>

              {/* Disposition Required Alert Banner */}
              {undispositionedLeadId === currentLead?.id && (
                <div style={{
                  background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(217, 119, 6, 0.25))',
                  border: '1.5px solid #f59e0b',
                  borderRadius: '10px',
                  padding: '0.85rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#fcd34d', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span>⚠️</span>
                        <span>Disposition Required Before Next Prospect</span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#fef3c7', marginTop: '0.15rem' }}>
                        A call was placed for <strong>{currentLead.first_name} {currentLead.last_name}</strong>. Choose an outcome to complete and advance:
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => triggerCall(currentLead)}
                      style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', fontWeight: 800 }}
                    >
                      📋 Full Notes & Booking
                    </button>
                  </div>

                  {/* Voicemail Prohibition Directive */}
                  <div
                    style={{
                      padding: '0.45rem 0.7rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      border: '1.5px solid #ef4444',
                      color: '#fca5a5',
                      fontSize: '0.74rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      lineHeight: 1.35,
                    }}
                  >
                    <span style={{ fontSize: '1.1rem' }}>🚫</span>
                    <div>
                      <strong style={{ color: '#fff' }}>SCHEDULER DIRECTIVE — DO NOT LEAVE VOICEMAILS:</strong> If an answering machine or voicemail picks up, <strong>hang up immediately</strong> & click <strong>📵 No Answer</strong>. Do not leave a voicemail.
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid rgba(245, 158, 11, 0.3)' }}>
                    {[
                      { id: 'warm_transfer_success', label: '🤝 Warm Transfer Connected ($25 Credit)', highlight: true },
                      { id: 'non_english', label: '🌐 Non-English (Reassign to Kamila)', highlight: true, isBlue: true },
                      { id: 'no_answer', label: '📵 No Answer' },
                      { id: 'busy', label: '⛔ Busy / Line Busy' },
                      { id: 'not_interested', label: '👎 Not Interested' },
                      { id: 'callback', label: '⏰ Callback Req' },
                      { id: 'interested', label: '👍 Interested' },
                    ].map((d: any) => (
                      <button
                        key={d.id}
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleQuickDisposition(currentLead, d.id)}
                        style={{
                          fontSize: '0.78rem',
                          padding: '0.35rem 0.65rem',
                          fontWeight: d.highlight ? 850 : 750,
                          background: d.isBlue ? 'rgba(2, 132, 199, 0.35)' : d.highlight ? 'rgba(200, 150, 62, 0.35)' : 'rgba(0,0,0,0.35)',
                          color: d.isBlue ? '#7dd3fc' : d.highlight ? '#ffd88a' : '#fff',
                          border: d.isBlue ? '1.5px solid #0284c7' : d.highlight ? '1.5px solid #c8963e' : '1px solid rgba(255,255,255,0.25)',
                          cursor: 'pointer',
                        }}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Disposition Error Banner */}
              {dispositionError && (
                <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 750, border: '1px solid #ef4444' }}>
                  {dispositionError}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" onClick={handlePrev} disabled={currentIndex === 0} style={{ padding: '0.65rem 0.65rem' }}>
                  ◄ Prev
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsScriptOpen((prev) => !prev)}
                  style={{
                    padding: '0.65rem 0.75rem',
                    fontWeight: isScriptOpen ? 800 : 600,
                    borderColor: isScriptOpen ? '#3b82f6' : undefined,
                    color: isScriptOpen ? '#93c5fd' : undefined,
                    backgroundColor: isScriptOpen ? 'rgba(59,130,246,0.15)' : undefined,
                  }}
                  title={isScriptOpen ? 'Close Script view and return to lead (Esc)' : 'Open Outbound Call Script (Press S)'}
                >
                  📜 {isScriptOpen ? 'Script (Active)' : 'Script'}
                </button>
                {currentLead?.phone && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!currentLead) return;
                      triggerCall(currentLead);
                      try {
                        setTrunkCalling(true);
                        const res = await api.post('/telephony/dial', {
                          to_phone: currentLead.phone,
                          lead_id: currentLead.id,
                          caller_name: 'Medicare Helpline by IWG',
                        });
                        setTrunkCallMsg(res.message || `Verified Call Active (Attestation: Level-A · ${res.caller_name || 'Medicare Helpline by IWG'})`);
                      } catch (err: any) {
                        alert(err.message || 'Trunk dial failed');
                      } finally {
                        setTrunkCalling(false);
                      }
                    }}
                    className="btn btn-primary"
                    style={{
                      flex: 2,
                      minWidth: '170px',
                      padding: '0.65rem 0.9rem',
                      fontWeight: 800,
                      background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                      borderColor: '#10b981',
                      color: '#fff',
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem',
                      cursor: 'pointer',
                    }}
                    title="Dial via Enterprise Trunk with STIR/SHAKEN Level-A Attestation (Displays 'Medicare Helpline by IWG' with blue verified badge, zero spam risk)"
                  >
                    <span>⚡</span> <span>{trunkCalling ? 'Connecting...' : 'Verified Call (Level-A ✓)'}</span>
                  </button>
                )}
                <a
                  href={currentLead?.phone ? googleVoiceWebUrl(currentLead.phone, gvSlot === 'email' ? user?.email : gvSlot) : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                  onClick={() => triggerCall(currentLead)}
                  style={{
                    padding: '0.65rem 0.85rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                  }}
                  title="Direct click opens Google Voice in new tab (bypasses Safari popup restrictions)"
                >
                  <span>📞</span> <span>Google Voice</span>
                </a>
                {currentLead?.phone && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsBlandModalOpen(true)}
                    style={{
                      padding: '0.65rem 0.85rem',
                      fontWeight: 700,
                      background: 'rgba(139, 92, 246, 0.15)',
                      borderColor: '#8b5cf6',
                      color: '#c084fc',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      cursor: 'pointer',
                    }}
                    title="Hand off this lead to autonomous Bland AI Voice Agent to call, qualify, and set appointment"
                  >
                    <span>🤖</span> <span>Bland AI</span>
                  </button>
                )}
                {currentLead?.phone && (
                  <a
                    href={googleVoiceAppUrl(currentLead.phone)}
                    className="btn btn-accent"
                    onClick={() => {
                      const num = currentLead.phone;
                      const digits = num.replace(/\D/g, '');
                      copyToClipboard(digits.length === 10 ? `+1${digits}` : num);
                      setCopiedPhone(true);
                      setTimeout(() => setCopiedPhone(false), 2500);
                      triggerCall(currentLead);
                    }}
                    style={{
                      padding: '0.65rem 0.85rem',
                      fontWeight: 800,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      textDecoration: 'none',
                      boxShadow: '0 3px 12px rgba(200, 150, 62, 0.4)',
                    }}
                    title="Open installed Google Voice mobile or desktop app (copies phone number and starts call session)"
                  >
                    <span>📲</span> <span>GV App</span>
                  </a>
                )}
                {currentLead?.phone && (
                  <a
                    href={googleVoiceWebUrl(currentLead.phone, gvSlot === 'email' ? user?.email : gvSlot)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-accent"
                    onClick={() => triggerCall(currentLead)}
                    style={{ padding: '0.65rem 0.8rem', fontWeight: 750, display: 'inline-flex', alignItems: 'center', gap: '0.3rem', textDecoration: 'none' }}
                    title="Directly open Google Voice tab for this lead"
                  >
                    <span>🌐</span> <span>Open Tab</span>
                  </a>
                )}
                {currentLead?.phone && (
                  <a
                    href={telDialUrl(currentLead.phone)}
                    className="btn btn-secondary"
                    onClick={() => triggerCall(currentLead)}
                    style={{ padding: '0.65rem 0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem', textDecoration: 'none' }}
                    title={isAppleDevice() ? "Direct Call via Mac FaceTime / iPhone Calling" : "Dial via default system/app dialer"}
                  >
                    <span>📱</span> <span>{isAppleDevice() ? 'Mac/iPhone Call' : 'Tel'}</span>
                  </a>
                )}
                {currentLead?.phone && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleCopyPhone(currentLead.phone)}
                    style={{ padding: '0.65rem 0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                    title="Copy 10-digit phone to clipboard"
                  >
                    <span>📋</span> <span>{copiedPhone ? 'Copied!' : 'Copy'}</span>
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={handleNext}
                  disabled={currentIndex === queue.length - 1}
                  style={{
                    padding: '0.65rem 0.65rem',
                    borderColor: undispositionedLeadId === currentLead?.id ? '#f59e0b' : undefined,
                    color: undispositionedLeadId === currentLead?.id ? '#fcd34d' : undefined,
                    fontWeight: undispositionedLeadId === currentLead?.id ? 800 : undefined,
                  }}
                  title={undispositionedLeadId === currentLead?.id ? "Must disposition call before advancing to next prospect" : "Skip to next prospect"}
                >
                  {undispositionedLeadId === currentLead?.id ? '⚠️ Must Disposition' : 'Skip ►'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                  style={{
                    padding: '0.65rem 0.75rem',
                    fontWeight: 700,
                    borderColor: 'rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                  }}
                  title="Exit Power Dialer session"
                >
                  🚪 Exit
                </button>
              </div>

              {trunkCallMsg && (
                <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', borderRadius: '8px', padding: '0.65rem 0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '0.82rem', color: '#6ee7b7', fontWeight: 600 }}>
                    ⚡ {trunkCallMsg}
                  </div>
                  <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.25)', color: '#a7f3d0', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 700 }}>
                    STIR/SHAKEN Level-A Verified ✓
                  </span>
                </div>
              )}

              {/* Popup Blocked Warning Alert with Direct Unblockable Link */}
              {popupBlocked && currentLead && (
                <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', borderRadius: '8px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '0.85rem', color: '#fca5a5' }}>
                    ⚠️ Browser blocked Google Voice pop-up tab. Click below:
                  </div>
                  <a
                    href={googleVoiceWebUrl(currentLead.phone, gvSlot === 'email' ? user?.email : gvSlot)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-accent"
                    style={{ fontWeight: 800, padding: '0.45rem 0.85rem', fontSize: '0.84rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    onClick={() => setPopupBlocked(false)}
                  >
                    <span>🌐</span> <span>Open Google Voice ↗</span>
                  </a>
                </div>
              )}

              {/* Primary Wide Exit Button Directly on Card */}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={onClose}
                  style={{
                    flex: 1,
                    padding: '0.8rem 1rem',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    border: '1.5px solid #ef4444',
                    color: '#fca5a5',
                    fontWeight: 800,
                    fontSize: '0.92rem',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.2)',
                  }}
                  title="Exit Power Dialer and return to page"
                >
                  <span>🚪</span>
                  <span>Exit Dialer & Return to Page</span>
                </button>
              </div>

              {/* Bottom Exit Dialer Bar */}
              <div
                style={{
                  marginTop: '0.5rem',
                  paddingTop: '0.85rem',
                  borderTop: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.6rem',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Done dialing for now? (Press <kbd style={{ padding: '0.1rem 0.35rem', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.75rem' }}>Esc</kbd> to exit)
                </span>
                <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleExitToDashboard}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem', fontWeight: 600 }}
                    title="Exit dialer and return to Dashboard"
                  >
                    🏠 Dashboard
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleExitToLeads}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem', fontWeight: 600 }}
                    title="Exit dialer and return to Leads Workflow"
                  >
                    📋 Leads
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onClose}
                    style={{
                      fontSize: '0.8rem',
                      padding: '0.35rem 0.7rem',
                      fontWeight: 700,
                      borderColor: 'rgba(239, 68, 68, 0.4)',
                      color: '#f87171',
                    }}
                    title="Exit and close Power Dialer"
                  >
                    🚪 Exit Dialer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <OutboundScriptModal
        clientName={currentLead ? `${currentLead.first_name} ${currentLead.last_name}` : undefined}
        clientAddress={currentLead ? `${currentLead.address ? currentLead.address + ', ' : ''}${currentLead.city || ''}, ${currentLead.state || 'AZ'} ${currentLead.zip || ''}` : undefined}
        isOpen={isScriptOpen}
        isLiveCall={isLiveCallActive}
        onClose={() => setIsScriptOpen(false)}
        onExitDialer={onClose}
      />

      <WarmTransferModal
        isOpen={isWarmTransferOpen}
        contact={currentLead ? {
          id: currentLead.id,
          name: `${currentLead.first_name} ${currentLead.last_name}`,
          phone: currentLead.phone,
          type: 'lead',
          state: currentLead.state,
          notes: currentLead.notes,
        } : undefined}
        onClose={() => setIsWarmTransferOpen(false)}
        onTransferComplete={() => {
          setUndispositionedLeadId(null);
          setDispositionError('');
          if (currentIndex < queue.length - 1) {
            setCurrentIndex((i) => i + 1);
          }
        }}
      />

      {activeCallContact && (
        <CallPanel
          contact={activeCallContact}
          onClose={() => setActiveCallContact(null)}
          onExitDialer={() => {
            setActiveCallContact(null);
            onClose();
          }}
          onCallCompleted={() => {
            setUndispositionedLeadId(null);
            setDispositionError('');
            // Auto advance to next in queue
            if (currentIndex < queue.length - 1) {
              setCurrentIndex((i) => i + 1);
            }
          }}
        />
      )}

      {isBlandModalOpen && currentLead && (
        <BlandCallModal
          isOpen={isBlandModalOpen}
          lead={currentLead}
          onClose={() => setIsBlandModalOpen(false)}
          onCallDispatched={() => {
            setUndispositionedLeadId(currentLead.id);
            if (currentIndex < queue.length - 1) {
              setCurrentIndex((i) => i + 1);
            }
          }}
        />
      )}
    </div>
  );
};
