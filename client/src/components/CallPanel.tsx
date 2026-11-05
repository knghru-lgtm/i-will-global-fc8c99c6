import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, googleVoiceWebUrl, googleVoiceAppUrl, telDialUrl, formatPhone, getStoredGvSlot, setStoredGvSlot, isSafariBrowser, isAppleDevice, copyToClipboard, type GvAccountSlot } from '../lib/api';
import { useAuth } from '../lib/auth';
import { WarmTransferModal } from './WarmTransferModal';
import { BookAppointmentModal } from './BookAppointmentModal';

interface CallPanelProps {
  contact: {
    id: string;
    name: string;
    phone: string;
    email?: string;
    address?: string;
    city?: string;
    zip?: string;
    type: 'lead' | 'client';
    state?: string;
    status?: string;
  };
  onClose: () => void;
  onCallCompleted?: (res: any) => void;
  onExitDialer?: () => void;
}

export const CallPanel: React.FC<CallPanelProps> = ({ contact, onClose, onCallCompleted, onExitDialer }) => {
  const { user, tpmo, isScheduler } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [callData, setCallData] = useState<any>(null);

  // Prospect details editable on call
  const [contactPhone, setContactPhone] = useState<string>(contact.phone || '');
  const [contactEmail, setContactEmail] = useState<string>(contact.email || '');
  const [isEditingContact, setIsEditingContact] = useState<boolean>(false);
  const [gvSlot, setGvSlot] = useState<GvAccountSlot>(getStoredGvSlot());
  const [copiedPhone, setCopiedPhone] = useState<boolean>(false);
  const [trunkCalling, setTrunkCalling] = useState<boolean>(false);
  const [trunkCallMsg, setTrunkCallMsg] = useState<string>('');

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

  const handleExitDialer = () => {
    onClose();
    if (onExitDialer) onExitDialer();
  };

  const handleDirectClose = () => {
    if (!selectedDisp) {
      setError('⚠️ Call Disposition Required: Schedulers must select a call outcome below (e.g., No Answer, Busy, Appointment Set, Non-English) before leaving this prospect.');
      setTab('call');
      return;
    }
    handleCompleteCall();
  };

  const handleExitToDashboard = async () => {
    if (!selectedDisp) {
      setError('⚠️ Call Disposition Required: You must select a disposition for this prospect before exiting to Dashboard.');
      setTab('call');
      return;
    }
    const ok = await handleCompleteCall();
    if (ok) {
      if (onExitDialer) onExitDialer();
      navigate('/dashboard');
    }
  };

  const handleExitToWorkflow = async () => {
    if (!selectedDisp) {
      setError('⚠️ Call Disposition Required: You must select a disposition for this prospect before exiting to Workflow.');
      setTab('call');
      return;
    }
    const ok = await handleCompleteCall();
    if (ok) {
      if (onExitDialer) onExitDialer();
      navigate('/leads');
    }
  };

  const handleCancelMisdial = async () => {
    if (window.confirm(`Did you misdial or wish to cancel this call for ${contact.name}? This will record the call as Misdial / Cancelled.`)) {
      try {
        if (callData?.call?.id) {
          await api.post(`/calls/${callData.call.id}/complete`, {
            disposition_id: 'busy',
            notes: 'Misdial / call cancelled by user',
            duration_sec: durationSec || 5,
          });
        }
        setTimerActive(false);
        setIsCallConnected(false);
        setIsDialing(false);
        if (onCallCompleted) onCallCompleted({ cancelled: true });
        onClose();
      } catch (e: any) {
        onClose();
      }
    } else {
      setError('⚠️ Please select a disposition below to complete the call.');
    }
  };
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [selectedDisp, setSelectedDisp] = useState<string>('');
  const [dispCategory, setDispCategory] = useState<'all' | 'outcome' | 'connected' | 'not_connected'>('all');
  const [dispSearch, setDispSearch] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [tpmoGiven, setTpmoGiven] = useState<boolean>(false);
  const [callbackAt, setCallbackAt] = useState<string>('');
  const [appointmentAt, setAppointmentAt] = useState<string>('');
  const [assignedAgentId, setAssignedAgentId] = useState<string>('u_principal');
  const [availableAgents, setAvailableAgents] = useState<any[]>([]);
  const [durationSec, setDurationSec] = useState<number>(0);
  const [timerActive, setTimerActive] = useState<boolean>(false);
  const [isCallConnected, setIsCallConnected] = useState<boolean>(false);
  const [isDialing, setIsDialing] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [tab, setTab] = useState<'call' | 'script'>('call');
  const [isWarmTransferOpen, setIsWarmTransferOpen] = useState<boolean>(false);
  const [isBookApptOpen, setIsBookApptOpen] = useState<boolean>(false);
  const [popupBlocked, setPopupBlocked] = useState<boolean>(false);
  const isLiveCallConnected = isCallConnected || Boolean(trunkCallMsg) || (timerActive && durationSec > 0);

  // Scope of Appointment (SOA) product selection
  const [soaProducts, setSoaProducts] = useState<string[]>([
    'Medicare Advantage (Part C)',
    'Prescription Drug Plan (Part D)',
    'Medicare Supplement (Medigap)',
  ]);

  // Policy submission fields
  const [policyData, setPolicyData] = useState({
    carrier: 'UnitedHealthcare',
    plan_name: '',
    plan_type: 'MAPD',
    plan_id: '',
    effective_date: '2027-01-01',
    premium: '0',
  });

  useEffect(() => {
    try {
      sessionStorage.setItem('iwg_last_active_prospect', JSON.stringify(contact));
    } catch (e) {}

    // Start call on server to check compliance & acquire dial links
    api.post('/calls/start', { related_type: contact.type, related_id: contact.id, override: true })
      .then((res) => {
        setCallData(res);
        // Do not activate timer or mark live call connected on mount until scheduler is actually connected with prospect
      })
      .catch((err) => setError(err.message));

    // Load available dispositions
    api.get('/records/dispositions?sort=sort:asc')
      .then((res) => {
        const filtered = isScheduler ? res.rows.filter((d: any) => !d.licensed_only && d.id !== 'voicemail') : res.rows;
        setDispositions(filtered);
      })
      .catch(() => {});

    // Load available agents for scheduling assignment
    api.get(`/appointments/available-agents?state=${encodeURIComponent(contact.state || 'AZ')}`)
      .then((res) => {
        setAvailableAgents(res || []);
        if (res && res.length > 0) {
          const king = res.find((a: any) => a.is_principal || a.id === 'u_principal');
          if (king) setAssignedAgentId(king.id);
        }
      })
      .catch(() => {});
  }, [contact, isScheduler]);

  useEffect(() => {
    let interval: any;
    if (timerActive) {
      interval = setInterval(() => setDurationSec((d) => d + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [timerActive]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if inside input / textarea
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (e.key === 'Escape' && !isWarmTransferOpen && !isBookApptOpen) {
        if (tab === 'script') {
          e.preventDefault();
          setTab('call'); // Toggle out of script back to lead without leaving the lead!
          return;
        } else {
          handleDirectClose();
        }
      }

      // Keyboard shortcut: Alt+S or 's' (outside input) to toggle script in/out without leaving lead
      if (!isWarmTransferOpen && !isBookApptOpen && !isInput && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        setTab((prev) => (prev === 'script' ? 'call' : 'script'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isWarmTransferOpen, isBookApptOpen, onClose, tab, location.pathname]);

  const handleCompleteCall = async (): Promise<boolean> => {
    if (!selectedDisp) {
      setError('⚠️ Please select a call disposition.');
      setTab('call');
      return false;
    }
    const dispObj = dispositions.find((d) => d.id === selectedDisp);
    if (dispObj?.automation?.needs_callback_time && !callbackAt) {
      setError('Please select a callback date and time.');
      return false;
    }
    if (dispObj?.automation?.needs_appointment && !appointmentAt) {
      setError('Please select an appointment date and time.');
      return false;
    }

    setSubmitting(true);
    setError('');

    try {
      const payload: any = {
        disposition_id: selectedDisp,
        notes,
        duration_sec: durationSec,
        tpmo_given: tpmoGiven,
        callback_at: callbackAt || null,
        appointment_at: appointmentAt || null,
        agent_id: assignedAgentId || null,
      };

      if (dispObj?.automation?.send_soa || dispObj?.automation?.soa_signed) {
        payload.soa_products = soaProducts;
      }

      if (dispObj?.automation?.create_policy) {
        payload.policy = {
          ...policyData,
          premium: Number(policyData.premium) || 0,
        };
      }

      const res = await api.post(`/calls/${callData.call.id}/complete`, payload);
      setTimerActive(false);
      setIsCallConnected(false);
      setIsDialing(false);
      if (onCallCompleted) onCallCompleted(res);
      onClose();
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleExitCallKeepConnected = async () => {
    setSubmitting(true);
    setError('');

    try {
      const callId = callData?.call?.id;
      const agentId = assignedAgentId || 'u_principal';

      const payload: any = {
        disposition_id: 'warm_transfer_success',
        notes: `${notes ? notes + ' | ' : ''}Warm Transfer 3-Way Handoff: Scheduler exited call while Licensed Agent and Prospect remained connected.`,
        duration_sec: durationSec,
        agent_id: agentId,
      };

      let res: any = null;
      if (callId) {
        res = await api.post(`/calls/${callId}/complete`, payload);
      } else {
        res = await api.post('/calls/quick-disposition', {
          related_type: contact.type || 'lead',
          related_id: contact.id,
          disposition_id: 'warm_transfer_success',
          notes: payload.notes,
        });
      }

      setTimerActive(false);
      setIsCallConnected(false);
      setIsDialing(false);
      setSelectedDisp('warm_transfer_success');
      if (onCallCompleted) onCallCompleted(res);
      onClose();
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="slideover-overlay" onClick={tab === 'script' ? () => setTab('call') : handleDirectClose}>
      <div className="slideover-panel" onClick={(e) => e.stopPropagation()}>
        <div className="slideover-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Calling {contact.name}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600 }}>
              {formatPhone(contact.phone)} · {contact.state || 'AZ'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent)', marginRight: '0.25rem' }}>
              ⏱️ {formatTimer(durationSec)}
            </span>
            <span style={{ fontSize: '0.74rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: selectedDisp ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: selectedDisp ? '#34d399' : '#fcd34d', border: `1px solid ${selectedDisp ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`, fontWeight: 700 }}>
              {selectedDisp ? '✅ Disposition Ready' : '⚠️ Disposition Required'}
            </span>
            <button
              type="button"
              className={`btn ${tab === 'script' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab((prev) => (prev === 'script' ? 'call' : 'script'))}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                borderColor: 'var(--accent)',
                color: tab === 'script' ? '#0b132b' : 'var(--accent)',
                backgroundColor: tab === 'script' ? 'var(--accent)' : 'rgba(200, 150, 62, 0.15)',
              }}
              title={tab === 'script' ? "Return to Lead Details & Dialer (Esc or Alt+S)" : "Open Lead Script without leaving lead (Alt+S)"}
            >
              <span>📜</span> <span>{tab === 'script' ? '← Back to Lead' : 'Lead Script'}</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (!isLiveCallConnected) {
                  alert('⚠️ Live Call Required: Warm Transfer is only available once you are connected on a live call with the prospect. Please connect the call first.');
                  return;
                }
                setIsWarmTransferOpen(true);
              }}
              disabled={!isLiveCallConnected}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                borderColor: isLiveCallConnected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.15)',
                color: isLiveCallConnected ? 'var(--accent)' : '#64748b',
                backgroundColor: isLiveCallConnected ? 'rgba(200, 150, 62, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                cursor: isLiveCallConnected ? 'pointer' : 'not-allowed',
                opacity: isLiveCallConnected ? 1 : 0.6,
              }}
              title={isLiveCallConnected ? "Initiate Live 3-Way Warm Transfer (Agent + Scheduler + Prospect)" : "🔒 Warm Transfer Locked: Only available once connected on a live call with prospect"}
            >
              <span>{isLiveCallConnected ? '⚡' : '🔒'}</span> <span>3-Way Transfer</span>
            </button>
            <button
              type="button"
              className="btn btn-accent"
              onClick={handleExitCallKeepConnected}
              disabled={submitting}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                boxShadow: '0 2px 8px rgba(200, 150, 62, 0.35)',
              }}
              title="Exit call without disconnecting Agent and Prospect (Awards $25 credit & advances)"
            >
              <span>🚪</span> <span>Exit (Keep Connected)</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToDashboard}
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              title="Exit and return to Dashboard"
            >
              <span>🏠</span> <span>Dashboard</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToWorkflow}
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              title="Exit and return to Leads Workflow"
            >
              <span>📋</span> <span>Workflow</span>
            </button>
            {onExitDialer ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleExitDialer}
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}
                title="Exit Dialer queue completely"
              >
                <span>🚪</span> <span>Exit Dialer</span>
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={tab === 'script' ? () => setTab('call') : handleDirectClose}
              style={{ padding: '0.35rem 0.6rem', fontWeight: 700 }}
              title={tab === 'script' ? "Close script and return to lead" : "Close call modal"}
            >
              ✕
            </button>
          </div>
        </div>

        <div className="slideover-body">
          {error && (
            <div style={{ padding: '0.75rem', backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: '8px', fontSize: '0.85rem' }}>
              ⚠️ {error}
            </div>
          )}

          {/* Quick Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            <button
              className={`btn ${tab === 'call' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('call')}
              style={{ flex: 1, padding: '0.4rem', fontWeight: tab === 'call' ? 800 : 600 }}
            >
              📞 Lead Details & Dialer
            </button>
            <button
              className={`btn ${tab === 'script' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('script')}
              style={{ flex: 1, padding: '0.4rem', fontWeight: tab === 'script' ? 800 : 600 }}
            >
              📜 Lead Script
            </button>
          </div>

          {tab === 'script' ? (
            <div style={{ fontSize: '0.86rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Quick Exit Script Action Bar */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.65rem 0.85rem',
                  background: 'rgba(200,150,62,0.12)',
                  border: '1px solid var(--accent)',
                  borderRadius: '8px',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent)' }}>
                  📜 Lead Script Active · Stay on call with {contact.name}:
                </span>
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setTab('call')}
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    title="Toggle back to lead details and dialer (Esc)"
                  >
                    <span>←</span> <span>Back to Lead & Dialer</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleExitToDashboard}
                    style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem', fontWeight: 600 }}
                  >
                    🏠 Dashboard
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleExitToWorkflow}
                    style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem', fontWeight: 600 }}
                  >
                    📋 Leads Workflow
                  </button>
                </div>
              </div>

              <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: '0.8rem' }}>
                <strong>🛡️ CMS / TPMO Disclaimer:</strong> "{tpmo}"
              </div>

              {/* Step 1: Sarah Unified Opening Greeting & 2027 Changes Question */}
              <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '10px', borderLeft: '4px solid var(--accent)' }}>
                <div style={{ fontWeight: 800, color: 'var(--accent)', marginBottom: '0.4rem', fontSize: '0.92rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <span>Step 1: Unified Opening Greeting & 2027 Changes Script</span>
                  <span className="badge badge-gold" style={{ fontSize: '0.68rem' }}>AUTO AI WHISPER FOR ALL</span>
                </div>
                <p style={{ margin: '0 0 0.5rem', lineHeight: 1.5, fontWeight: 700, color: '#fff' }}>
                  "Hello <strong>{contact.name || 'Beneficiary'}</strong>, this is <strong>{user?.name || 'Sarah'}</strong> calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"
                </p>
                <p style={{ margin: '0 0 0.5rem', lineHeight: 1.5, fontWeight: 700, color: '#f8fafc' }}>
                  "We are a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. To give you the most accurate information about Medicare plans."
                </p>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 800, color: '#6ee7b7', fontSize: '0.96rem', lineHeight: 1.5 }}>
                  "Would you like to know about the changes for 2027?"
                </p>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: '#e0ac53', lineHeight: 1.5 }}>
                  "For 2027, Part A has a $0 premium ($1,788 hospital deductible), Part B is $209.50/month ($292 deductible, uncapped 20% coinsurance), and Part D caps out-of-pocket drug costs at $2,400/year ($35 insulin, $0 adult vaccines). We compare Medigap Plan G, Plan N, and Medicare Advantage side-by-side. Would you like a personalized plan comparison or quote with our Principal Broker, <strong>King Amen Ra</strong>?"
                </p>

                <div style={{ background: 'rgba(59,130,246,0.12)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #3b82f6', marginTop: '0.5rem' }}>
                  <p style={{ margin: '0 0 0.4rem', fontWeight: 700, color: '#60a5fa' }}>
                    👉 Path A — Automatic AI Whisper Warm Transfer (Enabled for All Callers & All Directory Members):
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ color: '#10b981', fontWeight: 700 }}>• AI Automatically Whispers Briefing for You:</span>
                      <button
                        type="button"
                        className="btn btn-accent"
                        onClick={() => setIsWarmTransferOpen(true)}
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.35rem', boxShadow: '0 2px 8px rgba(212, 160, 76, 0.3)' }}
                        title="Launch Automatic AI Whisper Warm Transfer to King Amen Ra or any Directory Member"
                      >
                        🤖 Auto AI Whisper Transfer → (602) 456-9681
                      </button>
                    </div>
                    <div style={{ paddingLeft: '0.65rem', color: '#cbd5e1', lineHeight: 1.45, fontStyle: 'italic' }}>
                      <strong>Say to Prospect:</strong> "I am connecting you right now directly with King Amen Ra, our Principal Broker and Licensed Senior Advisor. Please stay on the line for just a moment while our AI whispers a quick briefing to him and bridges your call."<br />
                      <strong>🤖 Automatic AI Whisper (Spoken by Sarah AI):</strong> "Hi King Amen Ra, this is Sarah AI whispering automatically on behalf of {user?.name || 'Sarah'} with the Medicare Helpline powered by IWG Insurance and Financial Services. I have {contact.name || 'our prospect'} on hold asking about the 2027 Medicare changes and plan review. Merging the call automatically now so you can take over!"
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 2: Path B — When King is on a Warm Transfer Call (Or Prospect Prefers to Schedule) */}
              <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '10px', borderLeft: '4px solid #10b981' }}>
                <div style={{ fontWeight: 700, color: '#34d399', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                  Step 2: When King Amen Ra is on a Warm Transfer Call (Book Telephone, In-Person, or Video Only)
                </div>
                <p style={{ margin: '0 0 0.5rem', lineHeight: 1.5 }}>
                  👉 "King Amen Ra, our Principal Broker and Licensed Senior Advisor, is currently on a live warm transfer call helping another client right now, so I will get you scheduled right on his calendar. Would you prefer a <strong>Telephone appointment (30 minutes)</strong>, an <strong>In-Person appointment (60 minutes)</strong>, or a <strong>Video appointment (30 minutes)</strong> with King Amen Ra?"
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIsBookApptOpen(true)}
                  style={{ width: '100%', padding: '0.65rem', fontWeight: 800, marginTop: '0.35rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}
                >
                  📅 Book Telephone, In-Person, or Video Appointment Now
                </button>
              </div>

              {/* Step 3: Confirmation & Agent Handoff */}
              <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '10px', borderLeft: '4px solid #3b82f6' }}>
                <div style={{ fontWeight: 700, color: '#60a5fa', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                  Step 3: Confirm Appointment & Continue Calling
                </div>
                <p style={{ margin: 0, lineHeight: 1.5 }}>
                  "Wonderful! I have your <strong>[Telephone / In-Person / Video]</strong> appointment confirmed with Principal Broker <strong>King Amen Ra</strong> on our calendar. I am sending you a quick confirmation text right now—please reply <strong>YES</strong> to hold that time, and have your doctors and prescription list handy!"
                </p>
              </div>

              {/* Step 4: Sarah Rebuttals */}
              <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '10px', borderLeft: '4px solid #f59e0b' }}>
                <div style={{ fontWeight: 700, color: '#f59e0b', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                  Step 4: Sarah's Fiduciary Rebuttals
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  <strong>"I'm happy with my plan":</strong> "Staying right where you are may be the best choice! Because we are a 100% free fiduciary advisory representing 104+ carriers with zero broker fees, our review simply verifies your doctors and prescriptions are covered at the lowest cost for 2027."
                </div>
              </div>

              {/* Bottom Script Exit & Workflow Bar */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.85rem',
                  background: 'var(--bg-surface)',
                  borderRadius: '10px',
                  borderTop: '1px solid var(--border-color)',
                  flexWrap: 'wrap',
                  gap: '0.6rem',
                }}
              >
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setTab('call')}
                  style={{ flex: 1, padding: '0.6rem', fontWeight: 800, minWidth: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                  title="Toggle back to lead details and dialer (Esc)"
                >
                  <span>←</span> <span>Return to Lead Details & Dialer</span>
                </button>
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleExitToDashboard}
                    style={{ padding: '0.6rem 0.85rem', fontWeight: 600 }}
                  >
                    🏠 Exit to Dashboard
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleExitToWorkflow}
                    style={{ padding: '0.6rem 0.85rem', fontWeight: 600 }}
                  >
                    📋 Exit to Workflow
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Prospect Contact Details & Verification Bar */}
              <div style={{ background: '#0e1d44', border: '1.5px solid var(--accent)', borderRadius: '10px', padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>👤</span>
                    <strong style={{ fontSize: '0.98rem', color: '#fff' }}>{contact.name}</strong>
                    <span style={{ fontSize: '0.74rem', background: 'rgba(200, 150, 62, 0.2)', color: 'var(--accent)', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 700 }}>
                      {contact.state || 'AZ'} · {contact.type?.toUpperCase()}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsEditingContact(!isEditingContact)}
                    style={{ fontSize: '0.74rem', padding: '0.2rem 0.55rem', fontWeight: 600 }}
                  >
                    {isEditingContact ? '✕ Close Edit' : '✏️ Verify / Edit Phone & Email'}
                  </button>
                </div>

                {isEditingContact ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.3rem', background: 'rgba(0,0,0,0.25)', padding: '0.6rem', borderRadius: '6px' }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Mobile Phone</label>
                      <input
                        type="text"
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        placeholder="Phone..."
                        style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.82rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Email Address</label>
                      <input
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="Email..."
                        style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.82rem' }}
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.82rem', color: '#cbd5e1' }}>
                    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                      <span>📱 <strong>{contactPhone ? formatPhone(contactPhone) : '(No Phone)'}</strong></span>
                      <span>📧 <strong>{contactEmail || 'No email on file'}</strong></span>
                    </div>
                    {(contact.address || contact.city) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#e2e8f0', fontSize: '0.82rem', background: 'rgba(255,255,255,0.04)', padding: '0.3rem 0.5rem', borderRadius: '4px' }}>
                        <span style={{ color: 'var(--accent)' }}>📍</span>
                        <strong style={{ color: '#ffd88a' }}>Address:</strong>
                        <span>
                          {contact.address ? `${contact.address}, ` : ''}
                          {contact.city ? `${contact.city}, ` : ''}
                          {contact.state || 'AZ'}
                          {contact.zip ? ` ${contact.zip}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Direct Schedule Appointment & Put on Calendar Card */}
              <div style={{ background: 'linear-gradient(135deg, rgba(200, 150, 62, 0.2), rgba(5, 16, 57, 0.85))', border: '1.5px solid var(--accent)', padding: '0.9rem 1.1rem', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>📅</span>
                    <span>Schedule Appointment & Assign Agent</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#cbd5e1', marginTop: '0.15rem' }}>
                    Pre-fills prospect's phone & email, picks slot, and puts directly on calendar.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => setIsBookApptOpen(true)}
                  style={{ fontWeight: 800, padding: '0.55rem 1rem', fontSize: '0.88rem', boxShadow: '0 4px 15px rgba(212, 160, 76, 0.35)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <span>📅</span>
                  <span>Put on Calendar</span>
                </button>
              </div>

              {/* Dial & Warm Transfer Action Area */}
              <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 750, fontSize: '0.92rem' }}>Google Voice Outbound Dialer</div>
                      <span style={{ fontSize: '0.7rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.35)', borderRadius: '12px', padding: '0.12rem 0.5rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        <span>🛡️</span> {user?.caller_id_name || 'Medicare Helpline by IWG'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#38bdf8', marginTop: '0.2rem' }}>
                      Caller: <strong>{user?.name || 'JaKeeta Sullivan'}</strong> · Outbound Line: <strong>{user?.phone || '(602) 456-2760'}</strong> · <span style={{ color: '#94a3b8' }}>CNAM:</span> <strong style={{ color: '#6ee7b7' }}>{user?.cnam || 'MEDICARE BY IWG'}</strong>
                      <span style={{ fontSize: '0.68rem', color: '#a7f3d0', background: 'rgba(5, 150, 105, 0.2)', border: '1px solid rgba(5, 150, 105, 0.4)', borderRadius: '4px', padding: '0.1rem 0.35rem', marginLeft: '0.35rem' }} title="Verified with Free Caller Registry (AT&T, Verizon, T-Mobile) to eliminate Spam Concern flags">
                        ✓ Anti-Spam Whitelist Active
                      </span>
                      {isSafariBrowser() && (
                        <span style={{ fontSize: '0.7rem', color: '#fcd34d', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '4px', padding: '0.1rem 0.35rem', marginLeft: '0.4rem' }}>
                          🍎 Safari Mode
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem', fontSize: '0.72rem', flexWrap: 'wrap' }}>
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
                  <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {(contactPhone || contact.phone) && (
                      <button
                        type="button"
                        onClick={async () => {
                          const targetNum = contactPhone || contact.phone;
                          if (!targetNum) return;
                          try {
                            setTrunkCalling(true);
                            const res = await api.post('/telephony/dial', {
                              to_phone: targetNum,
                              lead_id: contact.id,
                              caller_name: 'Medicare Helpline by IWG',
                            });
                            setTrunkCallMsg(res.message || `Verified Call Active (Attestation: Level-A · ${res.caller_name || 'Medicare Helpline by IWG'})`);
                            setIsCallConnected(true);
                            setTimerActive(true);
                            setIsDialing(false);
                          } catch (err: any) {
                            alert(err.message || 'Trunk dial failed');
                          } finally {
                            setTrunkCalling(false);
                          }
                        }}
                        className="btn btn-primary"
                        style={{
                          background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                          borderColor: '#10b981',
                          color: '#fff',
                          fontWeight: 800,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
                        }}
                        title="Place outbound call via Enterprise Trunk with STIR/SHAKEN Level-A Attestation (Displays 'Medicare Helpline by IWG' with blue verified badge, zero spam risk)"
                      >
                        <span>⚡</span> <span>{trunkCalling ? 'Connecting...' : 'Verified Call (Level-A ✓)'}</span>
                      </button>
                    )}
                    {(contactPhone || contact.phone) && (
                      <a
                        href={googleVoiceWebUrl(contactPhone || contact.phone, gvSlot === 'email' ? user?.email : gvSlot)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setIsDialing(true)}
                        className="btn btn-secondary"
                        style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}
                        title={`Open Google Voice for ${formatPhone(contactPhone || contact.phone)} in new tab`}
                      >
                        <span>📞</span> <span>Google Voice</span>
                      </a>
                    )}
                    {(contactPhone || contact.phone) && (
                      <a
                        href={googleVoiceAppUrl(contactPhone || contact.phone)}
                        className="btn btn-accent"
                        onClick={() => {
                          setIsDialing(true);
                          const num = contactPhone || contact.phone;
                          const digits = num.replace(/\D/g, '');
                          copyToClipboard(digits.length === 10 ? `+1${digits}` : num);
                          setCopiedPhone(true);
                          setTimeout(() => setCopiedPhone(false), 2500);
                        }}
                        style={{
                          fontWeight: 800,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          textDecoration: 'none',
                          boxShadow: '0 3px 12px rgba(200, 150, 62, 0.4)',
                        }}
                        title="Open installed Google Voice mobile or desktop app directly (automatically copies phone number)"
                      >
                        <span>📲</span> <span>GV App</span>
                      </a>
                    )}
                    {(contactPhone || contact.phone) && (
                      <a
                        href={telDialUrl(contactPhone || contact.phone)}
                        onClick={() => setIsDialing(true)}
                        className="btn btn-secondary"
                        style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
                        title={isAppleDevice() ? "Direct Call via Mac FaceTime / iPhone Calling" : "Dial via default system dialer or phone app"}
                      >
                        <span>📱</span> <span>{isAppleDevice() ? 'Mac/iPhone Call' : 'Tel'}</span>
                      </a>
                    )}
                    {(contactPhone || contact.phone) && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleCopyPhone(contactPhone || contact.phone)}
                        style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        title="Copy 10-digit number to clipboard"
                      >
                        <span>📋</span> <span>{copiedPhone ? 'Copied!' : 'Copy'}</span>
                      </button>
                    )}
                  </div>
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

                {popupBlocked && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', borderRadius: '8px', padding: '0.65rem 0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.82rem', color: '#fca5a5' }}>
                      ⚠️ Browser blocked Google Voice pop-up tab. Click below:
                    </div>
                    <a
                      href={googleVoiceWebUrl(contactPhone || contact.phone, gvSlot === 'email' ? user?.email : gvSlot)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-accent"
                      style={{ fontWeight: 800, padding: '0.4rem 0.8rem', fontSize: '0.82rem', textDecoration: 'none' }}
                      onClick={() => setPopupBlocked(false)}
                    >
                      Open Google Voice ↗
                    </a>
                  </div>
                )}

                {isDialing && !isLiveCallConnected && (
                  <div style={{ background: 'rgba(59, 130, 246, 0.15)', border: '1px solid #3b82f6', borderRadius: '8px', padding: '0.65rem 0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.82rem', color: '#93c5fd' }}>
                      📞 <strong>Dialing prospect...</strong> Once the prospect answers, click <strong>"Mark Call Connected"</strong> to start talk timer & unlock Warm Transfer.
                    </div>
                    <button
                      type="button"
                      className="btn btn-accent"
                      onClick={() => {
                        setIsCallConnected(true);
                        setTimerActive(true);
                        setIsDialing(false);
                      }}
                      style={{ fontWeight: 800, padding: '0.35rem 0.75rem', fontSize: '0.8rem', boxShadow: '0 2px 8px rgba(212, 160, 76, 0.3)' }}
                    >
                      ▶ Mark Call Connected
                    </button>
                  </div>
                )}

                <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: isLiveCallConnected ? 'var(--accent)' : '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>{isLiveCallConnected ? '⚡' : '🔒'}</span>
                      <span>{isLiveCallConnected ? 'Live Warm Transfer → Agent at (480) 331-9455' : 'Warm Transfer (Locked - Connect Call First)'}</span>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: isLiveCallConnected ? '#cbd5e1' : '#64748b' }}>
                      {isLiveCallConnected
                        ? 'Call active! Connect prospect live to state-licensed specialist line (480) 331-9455 ($25 scheduler credit)'
                        : 'Only available once connected on a live call with prospect. Dial above and mark call connected first.'}
                    </div>
                  </div>
                  {isLiveCallConnected ? (
                    <button
                      type="button"
                      className="btn btn-accent"
                      onClick={() => setIsWarmTransferOpen(true)}
                      style={{
                        fontWeight: 800,
                        padding: '0.55rem 1rem',
                        fontSize: '0.88rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        boxShadow: '0 4px 15px rgba(212, 160, 76, 0.35)',
                      }}
                      title="Live Warm Transfer to Agent at (480) 331-9455"
                    >
                      <span>⚡</span>
                      <span>Warm Transfer → (480) 331-9455</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      style={{
                        fontWeight: 700,
                        padding: '0.55rem 1rem',
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
                      title="Warm transfer unlocks automatically once the call is connected"
                    >
                      <span>🔒</span>
                      <span>Warm Transfer (Locked)</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Scheduler Directive: Do Not Leave Voicemail Policy */}
              {isScheduler && (
                <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1.5px solid #ef4444', borderRadius: '8px', padding: '0.65rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#fca5a5', fontSize: '0.82rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>🚫</span>
                  <div>
                    <strong style={{ color: '#fff' }}>SCHEDULER DIRECTIVE — DO NOT LEAVE VOICEMAILS:</strong> If an answering machine or voicemail picks up, <strong>hang up immediately</strong> and disposition as <strong>"No Answer"</strong>. Leaving voicemails is prohibited and decreases connection rates.
                  </div>
                </div>
              )}

              {/* Call Timer & Adjustment Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)', padding: '0.65rem 0.9rem', borderRadius: '8px', border: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                  <span>⏱️ <strong>Duration:</strong></span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent)', fontSize: '0.95rem' }}>{formatTimer(durationSec)}</span>
                  {isLiveCallConnected ? (
                    <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.4)', padding: '0.12rem 0.45rem', borderRadius: '4px', fontWeight: 700 }}>
                      ● Live Call Active
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCallConnected(true);
                        setTimerActive(true);
                        setIsDialing(false);
                      }}
                      style={{ fontSize: '0.72rem', background: 'rgba(200, 150, 62, 0.18)', color: '#ffd88a', border: '1px solid #c8963e', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 700, cursor: 'pointer' }}
                      title="Click once connected on live call to start timer and unlock warm transfer"
                    >
                      ▶ Mark Call Connected
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => { setIsCallConnected(true); setTimerActive(true); setIsDialing(false); setDurationSec((d) => Math.max(0, d + 30)); }} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>+30s</button>
                  <button type="button" className="btn btn-secondary" onClick={() => { setIsCallConnected(true); setTimerActive(true); setIsDialing(false); setDurationSec((d) => Math.max(0, d + 60)); }} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>+1m</button>
                  <button type="button" className="btn btn-secondary" onClick={() => { setIsCallConnected(true); setTimerActive(true); setIsDialing(false); setDurationSec((d) => Math.max(0, d + 300)); }} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>+5m</button>
                </div>
              </div>

              {/* TPMO Disclaimer Check */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', background: 'var(--bg-surface)', padding: '0.75rem', borderRadius: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={tpmoGiven} onChange={(e) => setTpmoGiven(e.target.checked)} style={{ marginTop: '0.2rem' }} />
                <span style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                  <strong>TPMO Disclaimer Given Verbal Confirmation:</strong> Read required Medicare disclosure before discussing benefits.
                </span>
              </label>

              {/* Call Notes & Quick Note Chips */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label style={{ fontWeight: 600, fontSize: '0.85rem', margin: 0 }}>Call Notes</label>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Click chip to insert quick note</div>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                  {[
                    'Non-English / Spanish speaker',
                    'Turning 65 review requested',
                    'Doctor & prescription check needed',
                    'Callback requested tomorrow',
                    'Busy / call back later',
                    'Happy with current plan',
                    'Not interested at this time',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setNotes((prev) => (prev ? `${prev}\n• ${chip}` : `• ${chip}`))}
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '12px',
                        padding: '0.2rem 0.55rem',
                        fontSize: '0.72rem',
                        color: 'var(--text-main)',
                        cursor: 'pointer',
                      }}
                    >
                      + {chip}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={3}
                  placeholder="Record customer preferences, doctors, medications, or questions..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                    fontSize: '0.88rem',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Disposition Selector with Categories & Search */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <label style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--accent)', margin: 0 }}>
                    Required Call Disposition *
                  </label>
                  <input
                    type="text"
                    placeholder="Search dispositions..."
                    value={dispSearch}
                    onChange={(e) => setDispSearch(e.target.value)}
                    style={{
                      padding: '0.3rem 0.6rem',
                      borderRadius: '6px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-main)',
                      fontSize: '0.78rem',
                      width: '170px',
                    }}
                  />
                </div>

                {/* Category Filter Tabs */}
                <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', paddingBottom: '0.2rem' }}>
                  {[
                    { id: 'all', label: `All (${dispositions.length})` },
                    { id: 'outcome', label: `🏆 Outcomes (${dispositions.filter((d) => d.category === 'outcome').length})` },
                    { id: 'connected', label: `📞 Connected (${dispositions.filter((d) => d.category === 'connected').length})` },
                    { id: 'not_connected', label: `📵 Not Connected (${dispositions.filter((d) => d.category === 'not_connected').length})` },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setDispCategory(cat.id as any)}
                      style={{
                        padding: '0.3rem 0.65rem',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        border: '1px solid',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        background: dispCategory === cat.id ? 'var(--accent)' : 'var(--bg-surface)',
                        color: dispCategory === cat.id ? '#fff' : 'var(--text-muted)',
                        borderColor: dispCategory === cat.id ? 'var(--accent)' : 'var(--border-color)',
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Filtered Dispositions Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem', maxHeight: '200px', overflowY: 'auto' }}>
                  {dispositions
                    .filter((d) => dispCategory === 'all' || d.category === dispCategory)
                    .filter((d) => !dispSearch.trim() || d.label.toLowerCase().includes(dispSearch.toLowerCase()))
                    .map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className="btn"
                        onClick={() => setSelectedDisp(d.id)}
                        style={{
                          justifyContent: 'flex-start',
                          padding: '0.5rem 0.65rem',
                          fontSize: '0.8rem',
                          backgroundColor: selectedDisp === d.id ? 'var(--accent-soft)' : 'var(--bg-surface)',
                          borderColor: selectedDisp === d.id ? 'var(--accent)' : 'var(--border-color)',
                          color: selectedDisp === d.id ? 'var(--accent)' : 'var(--text-main)',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: '1rem', marginRight: '0.35rem' }}>{d.icon}</span>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: selectedDisp === d.id ? 700 : 500 }}>
                          {d.label}
                        </span>
                      </button>
                    ))}
                </div>
              </div>

              {/* Conditional Inputs based on Selected Disposition */}
              {selectedDisp && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>⚡ Automation Details for:</span>
                    <span style={{ color: '#fff' }}>{dispositions.find((d) => d.id === selectedDisp)?.label}</span>
                  </div>

                  {/* Non-English Reassignment Notice */}
                  {selectedDisp === 'non_english' && (
                    <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(2, 132, 199, 0.15)', border: '1.5px solid #0284c7', borderRadius: '8px', color: '#7dd3fc', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '1.3rem' }}>🌐</span>
                      <div>
                        <strong>Automatic Lead Reassignment:</strong> Completing this call will immediately unassign this prospect from your dialer queue and reassign them to <strong>Kamila Martinez</strong> for Spanish/bilingual assistance, creating a high-priority follow-up task and notification.
                      </div>
                    </div>
                  )}

                  {/* 1. Callback requested */}
                  {dispositions.find((d) => d.id === selectedDisp)?.automation?.needs_callback_time && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontWeight: 600, fontSize: '0.82rem', margin: 0 }}>
                          Scheduled Callback Date & Time *
                        </label>
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              const d = new Date();
                              d.setHours(d.getHours() + 1);
                              const tzOffset = d.getTimezoneOffset() * 60000;
                              setCallbackAt(new Date(d.getTime() - tzOffset).toISOString().slice(0, 16));
                            }}
                            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                          >
                            +1h
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              const d = new Date();
                              d.setDate(d.getDate() + 1);
                              d.setHours(10, 0, 0, 0);
                              const tzOffset = d.getTimezoneOffset() * 60000;
                              setCallbackAt(new Date(d.getTime() - tzOffset).toISOString().slice(0, 16));
                            }}
                            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                          >
                            Tmrw 10a
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              const d = new Date();
                              d.setDate(d.getDate() + 1);
                              d.setHours(14, 0, 0, 0);
                              const tzOffset = d.getTimezoneOffset() * 60000;
                              setCallbackAt(new Date(d.getTime() - tzOffset).toISOString().slice(0, 16));
                            }}
                            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                          >
                            Tmrw 2p
                          </button>
                        </div>
                      </div>
                      <input
                        type="datetime-local"
                        value={callbackAt}
                        onChange={(e) => setCallbackAt(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          borderRadius: '6px',
                          backgroundColor: 'var(--bg-input)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-main)',
                          fontSize: '0.85rem',
                        }}
                      />
                    </div>
                  )}

                  {/* 2. Needs Appointment */}
                  {dispositions.find((d) => d.id === selectedDisp)?.automation?.needs_appointment && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontWeight: 600, fontSize: '0.82rem', margin: 0 }}>
                          Appointment Date & Time *
                        </label>
                        <button
                          type="button"
                          className="btn btn-accent"
                          onClick={() => setIsBookApptOpen(true)}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem', fontWeight: 700 }}
                        >
                          📅 Open Slot Picker & Pre-fill Text
                        </button>
                      </div>
                      <input
                        type="datetime-local"
                        value={appointmentAt}
                        onChange={(e) => setAppointmentAt(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          borderRadius: '6px',
                          backgroundColor: 'var(--bg-input)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-main)',
                          fontSize: '0.85rem',
                        }}
                      />

                      <div>
                        <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: '0.25rem', color: 'var(--accent)' }}>
                          Assign State-Licensed Specialist
                        </label>
                        <select
                          value={assignedAgentId}
                          onChange={(e) => setAssignedAgentId(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            borderRadius: '6px',
                            backgroundColor: 'var(--bg-input)',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-main)',
                            fontSize: '0.85rem',
                          }}
                        >
                          <option value="u_principal">👑 King Amen Ra — Principal & Broker of Record</option>
                          {availableAgents
                            .filter((a) => a.id !== 'u_principal')
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} ({a.title || 'Agent'}) — NPN: {a.npn}
                              </option>
                            ))}
                          <option value="">⚡ Auto-Route to Best Available</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* 3. Scope of Appointment (SOA Sent / Signed) */}
                  {(dispositions.find((d) => d.id === selectedDisp)?.automation?.send_soa || dispositions.find((d) => d.id === selectedDisp)?.automation?.soa_signed) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', background: 'rgba(99, 102, 241, 0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid #6366f1' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#818cf8' }}>
                        ✍️ Scope of Appointment (SOA) Product Discussion Scope
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', fontSize: '0.8rem' }}>
                        {[
                          'Medicare Advantage (Part C)',
                          'Prescription Drug Plan (Part D)',
                          'Medicare Supplement (Medigap)',
                          'Dental / Vision / Hearing',
                        ].map((prod) => (
                          <label key={prod} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={soaProducts.includes(prod)}
                              onChange={(e) => {
                                if (e.target.checked) setSoaProducts([...soaProducts, prod]);
                                else setSoaProducts(soaProducts.filter((p) => p !== prod));
                              }}
                            />
                            <span>{prod}</span>
                          </label>
                        ))}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#cbd5e1', marginTop: '0.2rem' }}>
                        CMS Compliance: Check all products beneficiary agreed to discuss.
                      </div>
                    </div>
                  )}

                  {/* 4. Application Submitted / Policy Details */}
                  {dispositions.find((d) => d.id === selectedDisp)?.automation?.create_policy && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid #10b981' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#10b981' }}>
                        🏆 Policy Submission Details (Licensed Only)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                        <div>
                          <label style={{ fontSize: '0.74rem', color: '#cbd5e1', display: 'block', marginBottom: '0.2rem' }}>Carrier *</label>
                          <select
                            value={policyData.carrier}
                            onChange={(e) => setPolicyData({ ...policyData, carrier: e.target.value })}
                            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.8rem' }}
                          >
                            {['UnitedHealthcare', 'Humana', 'Aetna', 'Cigna', 'Wellcare', 'Devoted Health', 'Anthem Blue Cross', 'Mutual of Omaha', 'Other'].map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '0.74rem', color: '#cbd5e1', display: 'block', marginBottom: '0.2rem' }}>Plan Type *</label>
                          <select
                            value={policyData.plan_type}
                            onChange={(e) => setPolicyData({ ...policyData, plan_type: e.target.value })}
                            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.8rem' }}
                          >
                            <option value="MAPD">Medicare Advantage (MAPD)</option>
                            <option value="PDP">Prescription Drug Plan (PDP)</option>
                            <option value="Medigap">Medicare Supplement (Medigap)</option>
                            <option value="Dental/Vision">Dental / Vision / Hearing</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.8fr', gap: '0.45rem' }}>
                        <div>
                          <label style={{ fontSize: '0.74rem', color: '#cbd5e1', display: 'block', marginBottom: '0.2rem' }}>Plan Name</label>
                          <input
                            type="text"
                            placeholder="e.g. Choice PPO"
                            value={policyData.plan_name}
                            onChange={(e) => setPolicyData({ ...policyData, plan_name: e.target.value })}
                            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.8rem' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.74rem', color: '#cbd5e1', display: 'block', marginBottom: '0.2rem' }}>Effective Date</label>
                          <input
                            type="date"
                            value={policyData.effective_date}
                            onChange={(e) => setPolicyData({ ...policyData, effective_date: e.target.value })}
                            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.8rem' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.74rem', color: '#cbd5e1', display: 'block', marginBottom: '0.2rem' }}>Monthly Premium</label>
                          <input
                            type="number"
                            placeholder="0.00"
                            value={policyData.premium}
                            onChange={(e) => setPolicyData({ ...policyData, premium: e.target.value })}
                            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.8rem' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 5. Wrong Number */}
                  {dispositions.find((d) => d.id === selectedDisp)?.automation?.flag_phone_invalid && (
                    <div style={{ fontSize: '0.78rem', color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                      ⚠️ Phone number <strong>{contactPhone}</strong> will be flagged as invalid to remove from dialer lists.
                    </div>
                  )}

                  {/* 6. Do Not Call */}
                  {dispositions.find((d) => d.id === selectedDisp)?.automation?.set_dnc && (
                    <div style={{ fontSize: '0.78rem', color: '#ef4444', background: 'rgba(239, 68, 68, 0.15)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #ef4444', fontWeight: 600 }}>
                      🛑 Prospect will be immediately added to the Internal Do Not Call (DNC) list.
                    </div>
                  )}
                </div>
              )}

              {/* Submit Button */}
              <button
                className="btn btn-primary"
                onClick={handleCompleteCall}
                disabled={submitting || !selectedDisp}
                style={{ width: '100%', padding: '0.85rem', marginTop: '0.35rem', fontWeight: 800, fontSize: '0.95rem' }}
              >
                {submitting ? 'Saving Disposition...' : `Save Disposition & Next Prospect → ${selectedDisp ? (dispositions.find((d) => d.id === selectedDisp)?.label || 'Selected') : '(Select Disposition Above *)'}`}
              </button>

              {/* Call Exit / Cancel Bar */}
              <div
                style={{
                  marginTop: '0.75rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Cancel call or exit dialer?
                </span>
                <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={handleExitCallKeepConnected}
                    disabled={submitting}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', fontWeight: 800, boxShadow: '0 2px 8px rgba(200, 150, 62, 0.35)' }}
                    title="Exit call without disconnecting Agent and Prospect (Awards $25 credit & advances)"
                  >
                    🚪 Exit (Keep Connected)
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCancelMisdial}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', fontWeight: 600 }}
                    title="Cancel call if misdialed and return to queue"
                  >
                    Cancel Call
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleExitDialer}
                    style={{
                      fontSize: '0.8rem',
                      padding: '0.35rem 0.7rem',
                      fontWeight: 700,
                      borderColor: 'rgba(239, 68, 68, 0.4)',
                      color: '#f87171',
                    }}
                    title="Exit dialer session completely"
                  >
                    🚪 Exit Dialer
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <WarmTransferModal
        isOpen={isWarmTransferOpen}
        contact={{ ...contact, phone: contactPhone, email: contactEmail }}
        callId={callData?.call?.id}
        onClose={() => setIsWarmTransferOpen(false)}
        onTransferComplete={(res) => {
          if (onCallCompleted) onCallCompleted(res);
          onClose();
        }}
      />

      {isBookApptOpen && (
        <BookAppointmentModal
          contact={{ ...contact, phone: contactPhone, email: contactEmail }}
          onClose={() => setIsBookApptOpen(false)}
          onScheduled={(res) => {
            setIsBookApptOpen(false);
            setSelectedDisp('appointment_set');
            if (res.appointment?.due_at) {
              setAppointmentAt(new Date(res.appointment.due_at).toISOString().slice(0, 16));
            }
            if (res.assigned_agent?.id) {
              setAssignedAgentId(res.assigned_agent.id);
            }
            alert(`✅ Appointment scheduled & added to agency calendar with ${res.assigned_agent?.name || 'licensed agent'}!`);
            if (onCallCompleted) onCallCompleted(res);
            onClose();
          }}
        />
      )}
    </div>
  );
};
