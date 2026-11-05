import React, { useState, useEffect } from 'react';
import { api, googleVoiceWebUrl, googleVoiceAppUrl, openGoogleVoiceWindow } from '../lib/api';
import { useAuth } from '../lib/auth';

interface WarmTransferModalProps {
  isOpen: boolean;
  contact?: { id: string; name: string; phone: string; email?: string; address?: string; type: 'lead' | 'client'; state?: string; notes?: string };
  callId?: string;
  onClose: () => void;
  onTransferComplete?: (res: any) => void;
}

type TransferStep = 'select' | 'ringing' | 'threeway' | 'connected';

export const WarmTransferModal: React.FC<WarmTransferModalProps> = ({
  isOpen,
  contact,
  callId,
  onClose,
  onTransferComplete,
}) => {
  const { user } = useAuth();
  const [activeContact, setActiveContact] = useState<any>(contact || null);
  const [recentLeads, setRecentLeads] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [transferStep, setTransferStep] = useState<TransferStep>('select');
  const [transferId, setTransferId] = useState<string>('');
  const [briefingNotes, setBriefingNotes] = useState<string>(contact?.notes || '');
  const [dispositionId, setDispositionId] = useState<string>('warm_transfer_success');
  const [error, setError] = useState<string>('');

  // 3-Way Conference state
  const [threeWayTimerSec, setThreeWayTimerSec] = useState<number>(0);
  const [isThreeWayLive, setIsThreeWayLive] = useState<boolean>(false);
  const [schedulerDropped, setSchedulerDropped] = useState<boolean>(false);
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [copiedWhisperScript, setCopiedWhisperScript] = useState<boolean>(false);
  const [kingPickedUp, setKingPickedUp] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    if (contact && contact.id) {
      setActiveContact(contact);
      if (contact.notes) setBriefingNotes(contact.notes);
    } else {
      let found: any = null;
      try {
        const stored = sessionStorage.getItem('iwg_last_active_prospect');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.id) {
            found = parsed;
            setActiveContact(parsed);
            if (parsed.notes) setBriefingNotes(parsed.notes);
          }
        }
      } catch (e) {}

      api.get('/records/leads?limit=30&sort=updated_at:desc')
        .then((res) => {
          const list = res.rows || [];
          setRecentLeads(list);
          if (!found && list.length > 0) {
            const first = list[0];
            const cObj = {
              id: first.id,
              name: `${first.first_name} ${first.last_name}`,
              phone: first.phone || '',
              type: 'lead',
              state: first.state || 'AZ',
              notes: first.notes || '',
            };
            setActiveContact(cObj);
            if (first.notes) setBriefingNotes(first.notes);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, contact]);

  const contactState = activeContact?.state || 'AZ';
  const contactName = activeContact?.name || 'Prospect';
  const contactFirstName = (activeContact?.name || 'Prospect').split(' ')[0];

  const [autoAiWhisper, setAutoAiWhisper] = useState<boolean>(true);
  const [aiWhisperStatus, setAiWhisperStatus] = useState<string>('');

  const speakAiWhisper = (textToSpeak: string) => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 1.02;
        utterance.pitch = 1.05;
        window.speechSynthesis.speak(utterance);
      }
    } catch {
      // ignore if speech synthesis is unavailable
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError('');
    setKingPickedUp(false);
    setAiWhisperStatus('');

    Promise.all([
      api.get(`/appointments/available-agents?state=${encodeURIComponent(contactState)}`).catch(() => []),
      api.get('/bland/directory').catch(() => ({ directory: [] })),
    ])
      .then(([res, dirRes]) => {
        const kingMatches = (res || []).filter((a: any) =>
          a.id === '3afbca01-76cd-4fa9-91cc-f3a1a4821276' ||
          a.id === 'u_principal' ||
          a.email?.toLowerCase() === 'king@iwillglobal.com' ||
          a.name?.toLowerCase().includes('king amen ra') ||
          a.name?.toLowerCase().startsWith('king')
        );

        const kingAgent = kingMatches[0] || {
          id: '3afbca01-76cd-4fa9-91cc-f3a1a4821276',
          name: 'King Amen Ra',
          email: 'king@iwillglobal.com',
          phone: '(602) 456-9681',
          role: 'admin',
          title: 'Principal & Broker of Record',
          npn: '16094432',
          states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'],
          is_available: true,
          is_principal: true,
        };

        const dirList = (dirRes?.directory || [])
          .filter((d: any) => !String(d.name || '').toLowerCase().includes('king amen ra'))
          .map((d: any, idx: number) => ({
            id: `dir_${idx}_${d.name.replace(/\s+/g, '_').toLowerCase()}`,
            name: d.name,
            phone: d.phone || d.e164,
            title: d.role,
            department: d.department,
            is_available: true,
            is_principal: false,
          }));

        setAgents([kingAgent, ...dirList]);
        setSelectedAgentId(kingAgent.id);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isOpen, contactState]);

  // 3-Way Conference Timer
  useEffect(() => {
    let interval: any = null;
    if (isThreeWayLive && (transferStep === 'threeway' || transferStep === 'connected')) {
      interval = setInterval(() => {
        setThreeWayTimerSec((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isThreeWayLive, transferStep]);

  if (!isOpen) return null;

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  const whisperBriefingText = `Hi ${selectedAgent?.name || 'King Amen Ra'}, this is Sarah AI whispering automatically on behalf of ${user?.name || 'Sarah'} with the Medicare Helpline powered by IWG Insurance and Financial Services. I have ${contactName} from ${contactState} on hold on Line 1 asking about the 2027 Medicare changes and plan review${briefingNotes ? ` (${briefingNotes})` : ''}. Merging the call automatically now so you can take over!`;

  const mergeIntroText = `Thank you so much for holding, ${contactFirstName}! I now have ${selectedAgent?.name || 'King Amen Ra'} with IWG Insurance and Financial Services right here on the line with both of us. ${selectedAgent?.name || 'King'}, Sarah AI has automatically whispered a briefing on ${contactName}'s 2027 coverage review in ${contactState}, so I will step back and let you two take it from here!`;

  const handleInitiateTransfer = async () => {
    if (!activeContact || !activeContact.id) {
      setError('Please select a prospect or lead to transfer.');
      return;
    }
    if (!selectedAgentId) {
      setError('Please select an available recipient.');
      return;
    }

    setSubmitting(true);
    setError('');

    const agentPhone = selectedAgent?.phone || '6024569681';
    const dialUrl = googleVoiceWebUrl(agentPhone, user?.email);

    // Safari-compliant pre-open: opens window during synchronous user click gesture
    let preOpenedWindow: Window | null = null;
    try {
      preOpenedWindow = window.open('about:blank', '_blank');
    } catch (e) {}

    // AUTOMATIC AI WHISPER: Immediately trigger Sarah AI to whisper the briefing for all callers!
    if (autoAiWhisper) {
      speakAiWhisper(whisperBriefingText);
      setAiWhisperStatus(`🤖 Sarah AI is automatically whispering the briefing to ${selectedAgent?.name || 'King Amen Ra'}...`);
      api.post('/bland/whisper-transfer', {
        recipient_name: selectedAgent?.name || 'King Amen Ra',
        recipient_phone: agentPhone,
        prospect_name: contactName,
        prospect_phone: activeContact.phone || '',
        state: contactState,
        notes: briefingNotes,
      }).catch(() => {});
    }

    try {
      const res = await api.post('/calls/transfer/initiate', {
        call_id: callId,
        related_type: activeContact.type || 'lead',
        related_id: activeContact.id,
        target_agent_id: selectedAgentId,
        target_agent_name: selectedAgent?.name || 'King Amen Ra',
        target_agent_phone: agentPhone,
        notes: briefingNotes,
        prospect_data: {
          first_name: (activeContact.name || 'Prospect').split(' ')[0],
          last_name: (activeContact.name || 'Prospect').split(' ').slice(1).join(' ') || 'Prospect',
          phone: activeContact.phone || '',
          state: contactState,
        },
      });

      setTransferId(res.transfer_id);
      setTransferStep('ringing');

      if (preOpenedWindow && !preOpenedWindow.closed) {
        preOpenedWindow.location.href = dialUrl;
      } else {
        openGoogleVoiceWindow(agentPhone, user?.email);
      }
    } catch (err: any) {
      if (preOpenedWindow && !preOpenedWindow.closed) {
        preOpenedWindow.close();
      }
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartThreeWay = async () => {
    setKingPickedUp(true);
    setTransferStep('threeway');
    setIsThreeWayLive(true);
    if (autoAiWhisper) {
      speakAiWhisper(mergeIntroText);
      setAiWhisperStatus(`🤖 Sarah AI automatically announced the 3-way merge introduction with ${selectedAgent?.name || 'King Amen Ra'}!`);
    }
    try {
      if (transferId) {
        await api.post('/calls/transfer/3way-connect', { transfer_id: transferId, call_picked_up_by_king: true });
      }
    } catch (err) {}
  };

  const handleCopyWhisperScript = () => {
    navigator.clipboard.writeText(whisperBriefingText);
    setCopiedWhisperScript(true);
    setTimeout(() => setCopiedWhisperScript(false), 2500);
  };

  const handleCopyScript = () => {
    navigator.clipboard.writeText(mergeIntroText);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  // EXIT CALL WITHOUT DROPPING OR DISCONNECTING AGENT & PROSPECT
  const handleExitCallKeepConnected = async () => {
    let currentTransferId = transferId;
    setSubmitting(true);
    setSchedulerDropped(true);
    setError('');

    // Schedulers only receive credit if call is picked up by King!
    if (!kingPickedUp && transferStep === 'ringing') {
      const confirmExitWithoutCredit = window.confirm(
        'King Amen Ra has not picked up the call yet.\n\nWarm transfer lead credit ($25) is ONLY awarded when King answers and picks up the call.\n\nDo you want to exit without credit?'
      );
      if (!confirmExitWithoutCredit) {
        setSubmitting(false);
        setSchedulerDropped(false);
        return;
      }
    }

    // If transfer hasn't been created yet, auto-initiate first so it's logged
    if (!currentTransferId && activeContact?.id && (selectedAgentId || agents[0]?.id)) {
      const targetId = selectedAgentId || agents[0]?.id || '3afbca01-76cd-4fa9-91cc-f3a1a4821276';
      try {
        const initRes = await api.post('/calls/transfer/initiate', {
          call_id: callId,
          related_type: activeContact.type || 'lead',
          related_id: activeContact.id,
          target_agent_id: targetId,
          notes: briefingNotes,
          prospect_data: {
            first_name: (activeContact.name || 'Prospect').split(' ')[0],
            last_name: (activeContact.name || 'Prospect').split(' ').slice(1).join(' ') || 'Prospect',
            phone: activeContact.phone || '',
            state: contactState,
          },
        });
        currentTransferId = initRes.transfer_id;
        setTransferId(initRes.transfer_id);
      } catch (e: any) {
        // Fallback: continue if possible
      }
    }

    try {
      if (currentTransferId) {
        if (kingPickedUp) {
          await api.post('/calls/transfer/3way-drop', { transfer_id: currentTransferId });
        }
        const res = await api.post('/calls/transfer/complete', {
          transfer_id: currentTransferId,
          disposition_id: kingPickedUp ? 'warm_transfer_success' : 'warm_transfer_failed',
          call_picked_up_by_king: kingPickedUp,
          notes: `${briefingNotes ? briefingNotes + ' | ' : ''}Warm Transfer 3-Way Handoff: Scheduler exited call; ${kingPickedUp ? 'King picked up & Prospect connected on live consultation' : 'Call exited before King answered'}.`,
          three_way_duration_sec: threeWayTimerSec,
          scheduler_dropped: true,
        });
        if (onTransferComplete) onTransferComplete(res);
      } else {
        // Quick disposition fallback on current lead
        const res = await api.post('/calls/quick-disposition', {
          related_type: activeContact?.type || 'lead',
          related_id: activeContact?.id,
          disposition_id: kingPickedUp ? 'warm_transfer_success' : 'warm_transfer_failed',
          notes: `Warm Transfer Handoff: Scheduler exited call; ${kingPickedUp ? 'King picked up call' : 'King did not answer'}.`,
        });
        if (onTransferComplete) onTransferComplete(res);
      }

      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteTransfer = async () => {
    if (!transferId) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await api.post('/calls/transfer/complete', {
        transfer_id: transferId,
        disposition_id: dispositionId,
        call_picked_up_by_king: kingPickedUp || dispositionId === 'warm_transfer_success',
        notes: briefingNotes,
        three_way_duration_sec: threeWayTimerSec,
        scheduler_dropped: schedulerDropped || true,
      });

      if (onTransferComplete) onTransferComplete(res);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="slideover-overlay" onClick={onClose}>
      <div
        className="slideover-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '680px', maxWidth: '96vw', backgroundColor: '#051039', color: '#fff' }}
      >
        {/* Header */}
        <div className="slideover-header" style={{ borderBottom: '1px solid #1f2e5c', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.25rem', color: '#c8963e', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>⚡ 3-Way Warm Transfer</span>
              <span className="badge badge-gold" style={{ fontSize: '0.72rem', letterSpacing: '0.5px' }}>3-WAY CONFERENCE CALL</span>
            </div>
            <div style={{ fontSize: '0.84rem', color: '#94a3b8', marginTop: '2px' }}>
              Connecting <strong>Agent</strong>, <strong>Scheduler</strong>, and <strong>Prospect ({contactName})</strong> on the same call
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-accent"
              onClick={handleExitCallKeepConnected}
              disabled={submitting}
              style={{
                fontSize: '0.78rem',
                fontWeight: 800,
                padding: '0.35rem 0.75rem',
                boxShadow: '0 2px 8px rgba(200, 150, 62, 0.3)',
              }}
              title="Exit call in CRM while keeping Agent and Prospect connected on phone"
            >
              <span>🚪</span> <span>Exit Call (Keep Connected)</span>
            </button>
            <button className="btn btn-secondary" onClick={onClose} style={{ padding: '0.3rem 0.6rem' }}>✕</button>
          </div>
        </div>

        {/* 4-Step Progress Breadcrumb */}
        <div style={{ display: 'flex', background: '#0a163b', borderBottom: '1px solid #1f2e5c', padding: '0.5rem 1rem', gap: '0.5rem', overflowX: 'auto' }}>
          {[
            { key: 'select', num: '1', label: 'Select Agent' },
            { key: 'ringing', num: '2', label: 'Dial & Merge' },
            { key: 'threeway', num: '3', label: '🟢 Live 3-Way Call' },
            { key: 'connected', num: '4', label: 'Complete & Credit' },
          ].map((s) => {
            const isActive = transferStep === s.key;
            return (
              <div
                key={s.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  fontWeight: isActive ? 800 : 600,
                  color: isActive ? '#ffd88a' : '#64748b',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  background: isActive ? 'rgba(200, 150, 62, 0.15)' : 'transparent',
                  border: isActive ? '1px solid rgba(200, 150, 62, 0.4)' : '1px solid transparent',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ width: '16px', height: '16px', borderRadius: '50%', background: isActive ? '#c8963e' : '#1e293b', color: isActive ? '#051039' : '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 800 }}>
                  {s.num}
                </span>
                <span>{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="slideover-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.25rem' }}>
          {error && (
            <div style={{ padding: '0.75rem', backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: '8px', fontSize: '0.85rem' }}>
              ⚠️ {error}
            </div>
          )}

          {/* STEP 1: Select Licensed Agent */}
          {transferStep === 'select' && (
            <>
              {/* Prospect Information Bar with Change Option */}
              <div style={{ background: '#0a163b', border: '1px solid #1f2e5c', padding: '0.85rem 1rem', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Prospect on Current Call (Line 1):</div>
                  <div style={{ fontWeight: 800, fontSize: '1rem', color: '#ffd88a', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '2px' }}>
                    <span>👤 {activeContact?.name || 'Select Prospect'}</span>
                    {activeContact?.phone && <span style={{ fontSize: '0.85rem', color: '#38bdf8', fontWeight: 600 }}>📞 {activeContact.phone}</span>}
                    <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>{contactState}</span>
                  </div>
                </div>
                {recentLeads.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Switch:</label>
                    <select
                      className="form-control"
                      style={{ width: 'auto', minWidth: '190px', padding: '0.35rem 0.6rem', fontSize: '0.8rem', background: '#051039', color: '#ffd88a', borderColor: 'var(--accent)' }}
                      value={activeContact?.id || ''}
                      onChange={(e) => {
                        const found = recentLeads.find(l => l.id === e.target.value);
                        if (found) {
                          const newContact = {
                            id: found.id,
                            name: `${found.first_name} ${found.last_name}`,
                            phone: found.phone || '',
                            type: 'lead',
                            state: found.state || 'AZ',
                            notes: found.notes || '',
                          };
                          setActiveContact(newContact);
                          if (found.notes) setBriefingNotes(found.notes);
                          try { sessionStorage.setItem('iwg_last_active_prospect', JSON.stringify(newContact)); } catch (err) {}
                        }
                      }}
                    >
                      <option value="">Switch Prospect ({recentLeads.length} available)...</option>
                      {recentLeads.map(l => (
                        <option key={l.id} value={l.id}>
                          {l.first_name} {l.last_name} ({l.state || 'AZ'} · {l.phone || 'No phone'})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* 3-Way Conference How It Works */}
              <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', padding: '0.85rem', borderRadius: '10px', fontSize: '0.84rem', color: '#cbd5e1' }}>
                <strong style={{ color: '#60a5fa' }}>👥 How 3-Way Warm Transfer Works:</strong>
                <ol style={{ margin: '0.35rem 0 0 1.2rem', padding: 0, lineHeight: '1.45' }}>
                  <li>You place the prospect on hold while calling the licensed agent on Line 2.</li>
                  <li>Brief the agent on the prospect's Medicare needs.</li>
                  <li>Click <strong>"Merge calls"</strong> in Google Voice to connect Agent, Scheduler & Prospect together on the same 3-way line.</li>
                  <li>Introduce the prospect to the agent, exit safely without dropping their call, and receive your <strong>$25 lead credit</strong>!</li>
                </ol>
              </div>

              {/* Automatic AI Whisper Banner & Toggle */}
              <div style={{ background: 'rgba(16, 185, 129, 0.14)', border: '1.5px solid #10b981', padding: '0.85rem 1rem', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>🤖</span>
                    <span>Automatic AI Whisper Enabled for All Transfers</span>
                    <span style={{ fontSize: '0.7rem', padding: '2px 7px', borderRadius: '10px', background: '#10b981', color: '#051039', fontWeight: 800 }}>
                      AUTO-WHISPER ON
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#cbd5e1', marginTop: '0.2rem' }}>
                    Sarah AI automatically speaks and dispatches the private whisper briefing for King Amen Ra and all 42 I Will Global directory members before merging.
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700, color: '#a7f3d0' }}>
                  <input
                    type="checkbox"
                    checked={autoAiWhisper}
                    onChange={(e) => setAutoAiWhisper(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: '#10b981' }}
                  />
                  <span>Allow AI to Whisper for All</span>
                </label>
              </div>

              {/* Agents List - King Amen Ra + 42 Directory Members */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <label style={{ fontWeight: 800, fontSize: '0.92rem', margin: 0, color: '#ffd88a' }}>
                    👑 Select Transfer Recipient (King Amen Ra or Team Directory):
                  </label>
                  <span className="badge badge-gold" style={{ fontSize: '0.72rem', letterSpacing: '0.5px' }}>
                    AI WHISPER FOR ALL ({agents.length || 1} AVAILABLE)
                  </span>
                </div>

                {loading ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>Loading Principal Broker King Amen Ra & Team Directory...</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {agents.length > 1 && (
                      <select
                        value={selectedAgentId || ''}
                        onChange={(e) => setSelectedAgentId(String(e.target.value))}
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '8px',
                          backgroundColor: '#0e1838',
                          border: '1.5px solid #c8963e',
                          color: '#ffd88a',
                          fontWeight: 700,
                          fontSize: '0.88rem',
                        }}
                      >
                        {agents.map((ag) => (
                          <option key={ag.id} value={ag.id}>
                            {ag.is_principal ? '👑 ' : '👤 '}
                            {ag.name} — {ag.phone} ({ag.title || ag.specialty || 'Directory Member'})
                          </option>
                        ))}
                      </select>
                    )}

                    {selectedAgent && (
                      <div
                        key={selectedAgent.id}
                        style={{
                          padding: '1rem 1.15rem',
                          borderRadius: '10px',
                          border: '2px solid #c8963e',
                          backgroundColor: '#16245c',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          boxShadow: '0 4px 15px rgba(200, 150, 62, 0.25)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                          <div
                            style={{
                              width: '44px',
                              height: '44px',
                              borderRadius: '50%',
                              backgroundColor: '#c8963e',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '1.4rem',
                              color: '#051039',
                              fontWeight: 800,
                            }}
                          >
                            {selectedAgent.is_principal ? '👑' : '🤖'}
                          </div>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <span>{selectedAgent.name}</span>
                              <span style={{ fontSize: '0.72rem', padding: '1px 8px', borderRadius: '10px', background: '#c8963e', color: '#051039', fontWeight: 800 }}>
                                {selectedAgent.is_principal ? 'Principal Broker' : (selectedAgent.title || selectedAgent.specialty || 'Directory Member')}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.82rem', color: '#ffd88a', marginTop: '2px' }}>
                              Direct Line: <strong>{selectedAgent.phone || '(602) 456-9681'}</strong> · NPN: {selectedAgent.npn || '16094432'}
                            </div>
                            <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: '2px' }}>
                              🤖 Automatic AI Whisper Briefing Enabled · Licensed in: {selectedAgent.licensed_states || 'AZ, CA, NV, TX, FL, NM, CO'}
                            </div>
                          </div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              padding: '0.25rem 0.6rem',
                              borderRadius: '12px',
                              backgroundColor: 'rgba(16,185,129,0.2)',
                              color: '#34d399',
                              fontWeight: 700,
                              border: '1px solid #10b981',
                            }}
                          >
                            ● AI Whisper Ready
                          </span>
                          <div style={{ fontSize: '0.74rem', color: '#ffd88a', marginTop: '0.35rem', fontWeight: 700 }}>
                            $25 Lead Credit on Pickup
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ marginTop: '0.65rem', padding: '0.65rem 0.85rem', borderRadius: '6px', background: 'rgba(200, 150, 62, 0.12)', border: '1px solid rgba(200, 150, 62, 0.35)', fontSize: '0.8rem', color: '#ffd88a', lineHeight: '1.4' }}>
                  ℹ️ <strong>Automatic AI Whisper Rule:</strong> Outbound Medicare warm transfers default to <strong>King Amen Ra (602) 456-9681</strong>, and AI automatic whisper is enabled for King and all 42 I Will Global directory members.
                </div>
              </div>

              {/* Briefing Notes */}
              <div>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.35rem', color: '#cbd5e1' }}>
                  Scheduler Briefing Notes for {selectedAgent?.name || 'King Amen Ra'} (Included in AI Automatic Whisper):
                </label>
                <textarea
                  rows={2}
                  placeholder="Summarize prospect doctors, medications, current carrier, or 2027 Medicare questions..."
                  value={briefingNotes}
                  onChange={(e) => setBriefingNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    backgroundColor: '#111c3a',
                    border: '1px solid #243566',
                    color: '#fff',
                    fontSize: '0.88rem',
                  }}
                />
              </div>

              {/* Initiate 3-Way Transfer Button */}
              <button
                className="btn btn-primary"
                onClick={handleInitiateTransfer}
                disabled={submitting || !selectedAgentId}
                style={{ width: '100%', padding: '0.85rem', fontWeight: 800, fontSize: '0.95rem' }}
              >
                {submitting
                  ? `Calling ${selectedAgent?.name || 'King Amen Ra'} & Running AI Whisper...`
                  : `⚡ Call ${selectedAgent?.name || 'King Amen Ra'} & Auto-Whisper (${selectedAgent?.phone || '(602) 456-9681'})`}
              </button>
            </>
          )}

          {/* STEP 2: Ringing Agent & Merge Instructions */}
          {transferStep === 'ringing' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center', padding: '0.5rem 0' }}>
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(200,150,62,0.2)',
                  border: '2px solid #c8963e',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.8rem',
                  margin: '0 auto',
                }}
              >
                📞
              </div>

              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#c8963e', margin: 0 }}>
                  Calling King Amen Ra: {selectedAgent?.phone || '(602) 456-9681'}
                </h3>
                <div style={{ fontSize: '0.9rem', color: '#60a5fa', fontWeight: 700, marginTop: '0.25rem' }}>
                  Line 2 Target: King Amen Ra (Principal Broker)
                </div>
                <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginTop: '0.25rem' }}>
                  Line 1: Prospect <strong>{contactName}</strong> is on hold. Line 2: Ringing King Amen Ra.
                </div>
              </div>

              {/* Status Banner: Credit only if King picks up */}
              <div style={{ background: kingPickedUp ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)', border: `1.5px solid ${kingPickedUp ? '#10b981' : '#f59e0b'}`, borderRadius: '10px', padding: '0.85rem', textAlign: 'left' }}>
                <div style={{ fontWeight: 800, fontSize: '0.88rem', color: kingPickedUp ? '#34d399' : '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>{kingPickedUp ? '✅' : '⏳'}</span>
                  <span>{kingPickedUp ? 'King Picked Up Call!' : 'Waiting for King Amen Ra to Pick Up Call'}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#e2e8f0', marginTop: '0.3rem', lineHeight: '1.4' }}>
                  {kingPickedUp
                    ? 'King has answered. You can now bridge the call into 3-way conference and receive your $25 credit upon hand-off.'
                    : '⚠️ Outbound schedulers ONLY receive $25 credit if King Amen Ra answers and picks up the call. Do not exit until King answers.'}
                </div>
              </div>

              {/* Action Buttons to Call King */}
              <div style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid #3b82f6', borderRadius: '10px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  Call initiated via Google Voice. If not auto-dialed, click below:
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <a
                    href={googleVoiceWebUrl(selectedAgent?.phone || '6024569681', user?.email)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary"
                    style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
                  >
                    <span>🌐</span> <span>Dial King {selectedAgent?.phone || '(602) 456-9681'} (Web)</span>
                  </a>
                  <a
                    href={googleVoiceAppUrl(selectedAgent?.phone || '6024569681')}
                    className="btn btn-accent"
                    style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
                  >
                    <span>📲</span> <span>GV App</span>
                  </a>
                  <a
                    href={`tel:${(selectedAgent?.phone || '6024569681').replace(/\D/g, '')}`}
                    className="btn btn-secondary"
                    style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
                  >
                    <span>📱</span> <span>Direct Dial Line</span>
                  </a>
                </div>
              </div>

              {aiWhisperStatus && (
                <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1.5px solid #10b981', borderRadius: '10px', padding: '0.75rem', fontSize: '0.84rem', color: '#a7f3d0', fontWeight: 700, textAlign: 'left' }}>
                  {aiWhisperStatus}
                </div>
              )}

              {/* Whisper Transfer Briefing Script Box (Line 2 to Recipient) */}
              <div style={{ background: '#0e1838', border: '1.5px solid #c8963e', borderRadius: '10px', padding: '1rem', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#ffd88a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>🤖</span> <span>Step 1: Automatic AI Whisper Briefing to {selectedAgent?.name || 'King Amen Ra'} (Before Merging):</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => speakAiWhisper(whisperBriefingText)}
                      className="btn btn-primary"
                      style={{ padding: '0.2rem 0.65rem', fontSize: '0.74rem', fontWeight: 800, background: '#10b981', borderColor: '#059669' }}
                    >
                      🔊 AI Speak Whisper Now
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyWhisperScript}
                      className="btn btn-secondary"
                      style={{ padding: '0.2rem 0.55rem', fontSize: '0.74rem', fontWeight: 700 }}
                    >
                      {copiedWhisperScript ? '✅ Whisper Copied!' : '📋 Copy Whisper Script'}
                    </button>
                  </div>
                </div>
                <div style={{ background: '#051039', border: '1px solid #1f2e5c', padding: '0.75rem', borderRadius: '6px', fontSize: '0.86rem', lineHeight: 1.5, color: '#e2e8f0', fontStyle: 'italic' }}>
                  "{whisperBriefingText}"
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem', color: '#93c5fd', marginTop: '0.6rem' }}>
                  <div><strong>Step 2 (Merge Calls):</strong> Once Sarah AI completes the automatic whisper briefing to {selectedAgent?.name || 'King Amen Ra'}, click/tap <strong>"Merge calls"</strong> in Google Voice or your phone.</div>
                  <div><strong>Step 3 (3-Way AI Introduction):</strong> Click the green button below so Sarah AI automatically speaks the 3-way merge introduction and hands off the call!</div>
                </div>
              </div>

              {/* Safe Drop-off / Hand-off Box */}
              <div style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid #10b981', borderRadius: '10px', padding: '0.85rem', textAlign: 'left', fontSize: '0.82rem' }}>
                <strong style={{ color: '#34d399' }}>🛡️ Ready to Exit and Leave King & Prospect Connected?</strong>
                <div style={{ color: '#cbd5e1', marginTop: '0.25rem', lineHeight: '1.4' }}>
                  Once King answers and you've made the introduction, in Google Voice tap <strong>Transfer ➔ Transfer Now</strong>. Then click below to exit this dialer screen and advance to your next prospect without dropping their call!
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={handleExitCallKeepConnected}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    marginTop: '0.65rem',
                    padding: '0.75rem',
                    fontWeight: 800,
                    fontSize: '0.92rem',
                    backgroundColor: '#10b981',
                    borderColor: '#059669',
                    color: '#fff',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>🚪</span>
                  <span>Exit Call (Keep King & Prospect Connected) → Next Lead</span>
                </button>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'column' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={handleStartThreeWay}
                  style={{
                    width: '100%',
                    padding: '0.9rem',
                    fontWeight: 900,
                    fontSize: '0.98rem',
                    backgroundColor: '#10b981',
                    borderColor: '#059669',
                    color: '#fff',
                    boxShadow: '0 4px 15px rgba(16, 185, 129, 0.35)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <span>🟢</span>
                  <span>King Picked Up Call → Merge & Enter Live 3-Way Conference</span>
                </button>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setKingPickedUp(false);
                      handleExitCallKeepConnected();
                    }}
                    style={{ flex: 1, padding: '0.75rem', fontSize: '0.82rem', color: '#f87171' }}
                    title="Exit without credit if King did not answer"
                  >
                    ⚠️ King Did Not Answer / Dropped
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setTransferStep('select')}
                    style={{ flex: 1, padding: '0.75rem', fontSize: '0.82rem' }}
                  >
                    Cancel / Back
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: LIVE 3-WAY CONFERENCE */}
          {transferStep === 'threeway' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Live Status Header with Timer */}
              <div style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid #10b981', padding: '0.85rem 1rem', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#10b981', boxShadow: '0 0 8px #10b981' }}></span>
                  <span style={{ fontWeight: 800, color: '#34d399', fontSize: '0.98rem' }}>
                    LIVE 3-WAY CONFERENCE CONNECTED
                  </span>
                </div>
                <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.1rem', color: '#ffd88a', background: '#051039', padding: '0.2rem 0.6rem', borderRadius: '6px', border: '1px solid #c8963e' }}>
                  ⏱️ {formatTimer(threeWayTimerSec)}
                </div>
              </div>

              {/* Prominent Exit Without Dropping Card */}
              <div style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(6, 78, 59, 0.4))', border: '1.5px solid #10b981', borderRadius: '10px', padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>🚪</span>
                    <span>Ready to Leave Call & Move to Next Prospect?</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#e2e8f0', marginTop: '0.2rem' }}>
                    Leaves Agent and Prospect talking on the live call, awards your <strong>$25 lead credit</strong>, and loads your next prospect.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={handleExitCallKeepConnected}
                  disabled={submitting}
                  style={{
                    padding: '0.6rem 1.1rem',
                    fontWeight: 900,
                    fontSize: '0.88rem',
                    backgroundColor: '#10b981',
                    borderColor: '#059669',
                    color: '#fff',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>🚪</span>
                  <span>Exit Call (Keep Connected) →</span>
                </button>
              </div>

              {/* 3-Party Visual Connection Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem' }}>
                {/* 1. Prospect */}
                <div style={{ background: '#0a163b', border: '1.5px solid #38bdf8', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem' }}>👤</div>
                  <div style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>Prospect (Line 1)</div>
                  <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#fff', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {contactName}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{activeContact?.phone || contactState}</div>
                  <span style={{ display: 'inline-block', marginTop: '4px', fontSize: '0.68rem', padding: '1px 6px', borderRadius: '10px', background: 'rgba(56,189,248,0.2)', color: '#38bdf8', fontWeight: 700 }}>
                    ● On 3-Way Call
                  </span>
                </div>

                {/* 2. Scheduler */}
                <div style={{ background: '#0a163b', border: schedulerDropped ? '1.5px solid #64748b' : '1.5px solid #c8963e', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem' }}>🎧</div>
                  <div style={{ fontSize: '0.72rem', color: '#c8963e', fontWeight: 700, textTransform: 'uppercase' }}>Scheduler (You)</div>
                  <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#ffd88a', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user?.name || 'Scheduler'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Facilitating Hand-Off</div>
                  <span style={{ display: 'inline-block', marginTop: '4px', fontSize: '0.68rem', padding: '1px 6px', borderRadius: '10px', background: schedulerDropped ? 'rgba(100,116,139,0.2)' : 'rgba(200,150,62,0.2)', color: schedulerDropped ? '#94a3b8' : '#ffd88a', fontWeight: 700 }}>
                    {schedulerDropped ? '👋 Dropped Off Line' : '● Speaking / Active'}
                  </span>
                </div>

                {/* 3. Licensed Agent */}
                <div style={{ background: '#0a163b', border: '1.5px solid #10b981', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem' }}>🛡️</div>
                  <div style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 700, textTransform: 'uppercase' }}>Licensed Agent</div>
                  <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#fff', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedAgent?.name || 'Agent'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{selectedAgent?.phone || '(602) 456-9681'}</div>
                  <span style={{ display: 'inline-block', marginTop: '4px', fontSize: '0.68rem', padding: '1px 6px', borderRadius: '10px', background: 'rgba(16,185,129,0.2)', color: '#34d399', fontWeight: 700 }}>
                    ● On 3-Way Call
                  </span>
                </div>
              </div>

              {/* 3-Way Introduction Script Box */}
              <div style={{ background: '#0e1838', border: '1.5px solid #c8963e', borderRadius: '10px', padding: '1rem', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#ffd88a', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span>📜</span> <span>3-Way Warm Hand-Off Script (Say This on the 3-Way Call):</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyScript}
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.55rem', fontSize: '0.74rem', fontWeight: 700 }}
                  >
                    {copiedScript ? '✅ Copied!' : '📋 Copy Script'}
                  </button>
                </div>
                <div style={{ background: '#051039', border: '1px solid #1f2e5c', padding: '0.85rem', borderRadius: '6px', fontSize: '0.9rem', lineHeight: '1.5', color: '#e2e8f0', fontStyle: 'italic' }}>
                  "Hi <strong>{contactFirstName}</strong>, thank you so much for holding! I have <strong>{selectedAgent?.name || 'our licensed agent'}</strong>, our licensed Medicare specialist for <strong>{contactState}</strong>, right here on the line with both of us.
                  <br /><br />
                  <strong>{selectedAgent?.name || 'Agent'}</strong>, this is <strong>{contactName}</strong>—they are looking for guidance on their Medicare options in <strong>{contactState}</strong>, and I've briefed you on their background. I will let you two take it from here!"
                </div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.74rem', color: '#94a3b8' }}>
                  🛡️ <strong>CMS Compliance Check:</strong> Once introduced, the licensed agent will deliver the TPMO disclaimer and take over the enrollment consultation.
                </div>
              </div>

              {/* Google Voice Safe Disconnect Instruction Box */}
              <div style={{ background: '#111c3a', border: '1px solid #243566', borderRadius: '10px', padding: '0.85rem', fontSize: '0.82rem', color: '#e2e8f0' }}>
                <strong style={{ color: '#60a5fa' }}>💡 Google Voice Disconnect Tip:</strong>
                <div style={{ color: '#94a3b8', marginTop: '0.2rem', lineHeight: '1.4' }}>
                  In Google Voice, use <strong>Transfer ➔ Ask first ➔ Transfer now</strong> (or tap <strong>Complete Transfer</strong>) so your line drops automatically without hanging up on the prospect and agent!
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={handleExitCallKeepConnected}
                  disabled={submitting}
                  style={{
                    flex: 2,
                    padding: '0.85rem',
                    fontWeight: 900,
                    fontSize: '0.95rem',
                    backgroundColor: '#10b981',
                    borderColor: '#059669',
                    color: '#fff',
                    boxShadow: '0 4px 15px rgba(16, 185, 129, 0.35)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>🚪</span>
                  <span>Exit Call (Keep Agent & Prospect Connected) → Next Lead</span>
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setDispositionId('warm_transfer_failed');
                    setTransferStep('connected');
                  }}
                  style={{ flex: 1, padding: '0.85rem', fontSize: '0.85rem' }}
                >
                  ⚠️ Call Dropped
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Complete Hand-Off & Award Credit */}
          {transferStep === 'connected' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', padding: '1rem', borderRadius: '10px' }}>
                <div style={{ fontWeight: 800, color: '#34d399', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>🤝 3-Way Warm Transfer Summary</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: '#ffd88a' }}>⏱️ Duration: {formatTimer(threeWayTimerSec)}</span>
                </div>
                <div style={{ fontSize: '0.84rem', color: '#e2e8f0', marginTop: '0.35rem', lineHeight: '1.45' }}>
                  Scheduler <strong>{user?.name}</strong> successfully introduced prospect <strong>{contactName}</strong> to licensed agent <strong>{selectedAgent?.name}</strong> on a 3-way conference call.
                </div>
              </div>

              <div>
                <label style={{ fontWeight: 700, fontSize: '0.88rem', display: 'block', marginBottom: '0.4rem', color: '#c8963e' }}>
                  Select Warm Transfer Final Disposition:
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {[
                    { id: 'warm_transfer_success', label: '✅ 3-Way Warm Transfer Complete — Handoff to Licensed Agent', desc: 'Prospect converted to Lead, owner assigned to agent, original scheduler awarded $25 credit' },
                    { id: 'app_submitted', label: '🏆 Policy Application Submitted on 3-Way ($25 Bonus for Scheduler)', desc: 'Licensed agent completed enrollment directly during 3-way warm transfer' },
                    { id: 'warm_transfer_failed', label: '⚠️ 3-Way Transfer Failed / Line Dropped', desc: 'Fallback to standard appointment booking' },
                  ].map((d) => (
                    <label
                      key={d.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.6rem',
                        background: dispositionId === d.id ? '#16245c' : '#0e1838',
                        border: dispositionId === d.id ? '2px solid #c8963e' : '1px solid #1f2e5c',
                        padding: '0.75rem',
                        borderRadius: '8px',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="radio"
                        name="disp"
                        checked={dispositionId === d.id}
                        onChange={() => setDispositionId(d.id)}
                        style={{ marginTop: '0.2rem' }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#fff' }}>{d.label}</div>
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{d.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Final Notes */}
              <div>
                <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: '0.35rem', color: '#cbd5e1' }}>
                  Additional Hand-Off Notes:
                </label>
                <textarea
                  rows={2}
                  placeholder="Notes from 3-way conference call..."
                  value={briefingNotes}
                  onChange={(e) => setBriefingNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem',
                    borderRadius: '8px',
                    backgroundColor: '#111c3a',
                    border: '1px solid #243566',
                    color: '#fff',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              <button
                className="btn btn-primary"
                onClick={handleCompleteTransfer}
                disabled={submitting}
                style={{ width: '100%', padding: '0.85rem', fontWeight: 800, fontSize: '0.95rem' }}
              >
                {submitting ? 'Completing Hand-Off...' : '🎉 Complete 3-Way Warm Transfer & Award $25 Scheduler Credit'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
