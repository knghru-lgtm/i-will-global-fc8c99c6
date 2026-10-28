import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, formatPhone } from '../lib/api';
import { useAuth } from '../lib/auth';

interface CopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeContact?: { id: string; name: string; phone: string; email?: string; address?: string; type: 'lead' | 'client'; state?: string; status?: string };
  onExitAndDisposition?: (contact: { id: string; name: string; phone: string; email?: string; address?: string; type: 'lead' | 'client'; state?: string; status?: string }) => void;
}

export const CopilotDrawer: React.FC<CopilotDrawerProps> = ({
  isOpen,
  onClose,
  activeContact,
  onExitAndDisposition,
}) => {
  const { user, isScheduler } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);

  const handleExitToDashboard = () => {
    onClose();
    navigate('/dashboard');
  };

  const handleExitToLeads = () => {
    onClose();
    navigate('/leads');
  };

  // Close Copilot if user navigates to another page
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      prevPathRef.current = location.pathname;
      if (isOpen) {
        onClose();
      }
    }
  }, [location.pathname, isOpen, onClose]);

  const [activeTab, setActiveTab] = useState<'chat' | 'disposition' | 'email' | 'compliance'>('chat');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    { role: 'assistant', content: `Hello ${user?.name?.split(' ')[0]}! I'm **IWG Copilot**. Ask me anything about your leads, turning-65 prospects, pipeline, call stats, or commissions.` }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Active Prospect & Disposition State
  const [selectedProspect, setSelectedProspect] = useState<any>(activeContact || null);
  const [leadsList, setLeadsList] = useState<any[]>([]);
  const [prospectSearch, setProspectSearch] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [selectedDispId, setSelectedDispId] = useState<string>('appointment_set');
  const [dispNotes, setDispNotes] = useState<string>('');
  const [tpmoGiven, setTpmoGiven] = useState<boolean>(false);
  const [callbackAt, setCallbackAt] = useState<string>('');
  const [appointmentAt, setAppointmentAt] = useState<string>('');
  const [submittingDisp, setSubmittingDisp] = useState<boolean>(false);
  const [dispSuccessMsg, setDispSuccessMsg] = useState<string>('');
  const [dispErrorMsg, setDispErrorMsg] = useState<string>('');

  // Email Drafter state
  const [emailName, setEmailName] = useState('');
  const [emailPurpose, setEmailPurpose] = useState('AEP Annual Review');
  const [emailDraft, setEmailDraft] = useState<any>(null);
  const [emailDrafting, setEmailDrafting] = useState(false);

  // Compliance state
  const [complianceText, setComplianceText] = useState('');
  const [complianceResults, setComplianceResults] = useState<any>(null);

  // Handle Escape key to exit Copilot
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPickerOpen) {
          setIsPickerOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPickerOpen, onClose]);

  // Initialize selected prospect from props or session storage
  useEffect(() => {
    if (activeContact) {
      setSelectedProspect(activeContact);
    } else {
      try {
        const stored = sessionStorage.getItem('iwg_last_active_prospect');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.id && parsed.name) {
            setSelectedProspect(parsed);
          }
        }
      } catch (e) {
        // ignore JSON parse error
      }
    }
  }, [activeContact, isOpen]);

  // Load leads and dispositions when drawer opens
  useEffect(() => {
    if (!isOpen) return;

    // Load recent leads for quick selection
    api.get('/records/leads?limit=30&sort=updated_at:desc')
      .then((res) => {
        setLeadsList(res.rows || []);
        if (!selectedProspect && res.rows && res.rows.length > 0) {
          const first = res.rows[0];
          const contactObj = {
            id: first.id,
            name: `${first.first_name} ${first.last_name}`,
            phone: first.phone || '',
            type: 'lead',
            state: first.state || 'AZ',
            status: first.status,
          };
          setSelectedProspect(contactObj);
        }
      })
      .catch(() => {});

    // Load available dispositions
    api.get('/records/dispositions?sort=sort:asc')
      .then((res) => {
        const list = res.rows || [];
        const filtered = isScheduler ? list.filter((d: any) => !d.licensed_only) : list;
        setDispositions(filtered);
      })
      .catch(() => {});
  }, [isOpen, isScheduler]);

  if (!isOpen) return null;

  // Master Exit Copilot and Disposition Prospect action
  const handleExitAndDisposition = (prospectToUse?: any) => {
    const target = prospectToUse || selectedProspect;
    if (!target) {
      // If no prospect is selected, open the picker tab so they can select immediately
      setIsPickerOpen(true);
      setActiveTab('disposition');
      return;
    }

    // Persist active prospect in session
    try {
      sessionStorage.setItem('iwg_last_active_prospect', JSON.stringify(target));
    } catch (e) {}

    // Close copilot drawer
    onClose();

    // Trigger parent disposition flow (e.g. opens CallPanel for this contact)
    if (onExitAndDisposition) {
      onExitAndDisposition(target);
    }
  };

  const handleSelectProspect = (lead: any, exitNow = false) => {
    const contactObj = {
      id: lead.id,
      name: `${lead.first_name} ${lead.last_name}`,
      phone: lead.phone || '',
      email: lead.email || '',
      address: lead.address || '',
      type: 'lead' as const,
      state: lead.state || 'AZ',
      status: lead.status,
    };
    setSelectedProspect(contactObj);
    try {
      sessionStorage.setItem('iwg_last_active_prospect', JSON.stringify(contactObj));
    } catch (e) {}
    setIsPickerOpen(false);

    if (exitNow) {
      handleExitAndDisposition(contactObj);
    }
  };

  const handleSaveQuickDisposition = async () => {
    if (!selectedProspect) {
      setDispErrorMsg('Please select a prospect to disposition.');
      return;
    }
    if (!selectedDispId) {
      setDispErrorMsg('Please choose a disposition.');
      return;
    }

    const dispObj = dispositions.find((d) => d.id === selectedDispId);
    if (dispObj?.automation?.needs_callback_time && !callbackAt) {
      setDispErrorMsg('Please select a callback date and time.');
      return;
    }
    if (dispObj?.automation?.needs_appointment && !appointmentAt) {
      setDispErrorMsg('Please select an appointment date and time.');
      return;
    }

    setSubmittingDisp(true);
    setDispErrorMsg('');
    setDispSuccessMsg('');

    try {
      await api.post('/calls/quick-disposition', {
        related_type: selectedProspect.type || 'lead',
        related_id: selectedProspect.id,
        disposition_id: selectedDispId,
        notes: dispNotes,
        tpmo_given: tpmoGiven,
        callback_at: callbackAt || null,
        appointment_at: appointmentAt || null,
      });

      setDispSuccessMsg(`✅ Successfully dispositioned ${selectedProspect.name} as "${dispObj?.label || selectedDispId}". Automations updated.`);
      
      // Notify CRM pages of lead update
      window.dispatchEvent(new CustomEvent('iwg-lead-updated'));

      // Automatically exit Copilot after short delay so the user sees the confirmation
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setDispErrorMsg(err.message || 'Failed to save disposition.');
    } finally {
      setSubmittingDisp(false);
    }
  };

  const handleSendMessage = async (userText?: string) => {
    const textToSend = userText || input;
    if (!textToSend.trim()) return;

    const newHistory = [...messages, { role: 'user' as const, content: textToSend }];
    setMessages(newHistory);
    if (!userText) setInput('');
    setLoading(true);

    try {
      const res = await api.post('/ai/copilot', { messages: newHistory });
      setMessages([...newHistory, { role: 'assistant', content: res.reply }]);
    } catch (err: any) {
      setMessages([...newHistory, { role: 'assistant', content: `⚠️ Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateEmail = async () => {
    if (!emailName) return;
    setEmailDrafting(true);
    try {
      const res = await api.post('/ai/draft-email', { name: emailName, purpose: emailPurpose });
      setEmailDraft(res);
    } catch (err: any) {
      alert(`Error drafting email: ${err.message}`);
    } finally {
      setEmailDrafting(false);
    }
  };

  const handleRunCompliance = async () => {
    if (!complianceText) return;
    try {
      const res = await api.post('/ai/compliance-check', { text: complianceText });
      setComplianceResults(res);
    } catch (err: any) {
      alert(`Compliance check failed: ${err.message}`);
    }
  };

  // Filter leads based on search term
  const filteredLeads = leadsList.filter((l) => {
    if (!prospectSearch.trim()) return true;
    const q = prospectSearch.toLowerCase();
    const fullName = `${l.first_name} ${l.last_name}`.toLowerCase();
    const phone = (l.phone || '').toLowerCase();
    return fullName.includes(q) || phone.includes(q);
  });

  return (
    <div className="slideover-overlay" onClick={onClose}>
      <div className="slideover-panel" onClick={(e) => e.stopPropagation()} style={{ width: '560px', maxWidth: '95vw' }}>
        {/* Header with Exit & Quick Navigation Controls */}
        <div className="slideover-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.3rem' }}>🤖</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-main)' }}>IWG Copilot (AI)</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Outbound telephony & lead assistant
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {selectedProspect && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleExitAndDisposition()}
                style={{
                  backgroundColor: '#10b981',
                  borderColor: '#10b981',
                  color: '#fff',
                  fontWeight: 750,
                  fontSize: '0.78rem',
                  padding: '0.35rem 0.65rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  boxShadow: '0 2px 8px rgba(16,185,129,0.35)',
                }}
                title="Exit Copilot and immediately disposition this prospect"
              >
                <span>📋</span>
                <span>Exit & Disp</span>
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToDashboard}
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              title="Exit Copilot and return to Dashboard"
            >
              <span>🏠</span> <span>Dashboard</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToLeads}
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              title="Exit Copilot and return to Leads Workflow"
            >
              <span>📋</span> <span>Leads</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{
                padding: '0.35rem 0.6rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                borderColor: 'rgba(239, 68, 68, 0.4)',
                color: '#f87171',
              }}
              title="Exit and close Copilot (Esc)"
            >
              <span>🚪</span> <span>Exit</span>
            </button>
          </div>
        </div>

        {/* Active Prospect Ribbon / Selector */}
        <div
          style={{
            backgroundColor: '#0c1638',
            borderBottom: '1px solid var(--border-color)',
            padding: '0.6rem 1.1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.84rem' }}>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>👤 Prospect:</span>
            {selectedProspect ? (
              <span>
                <strong style={{ color: '#fff' }}>{selectedProspect.name}</strong> ({formatPhone(selectedProspect.phone)} · {selectedProspect.state || 'AZ'})
              </span>
            ) : (
              <span style={{ color: '#ffd88a', fontStyle: 'italic' }}>No prospect selected yet</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsPickerOpen(!isPickerOpen)}
              style={{ padding: '0.25rem 0.55rem', fontSize: '0.76rem', borderColor: 'var(--accent)', color: 'var(--accent)' }}
            >
              {isPickerOpen ? '✕ Close List' : selectedProspect ? '🔄 Change Prospect' : '🔍 Select Prospect'}
            </button>

            {selectedProspect && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleExitAndDisposition()}
                style={{
                  padding: '0.25rem 0.65rem',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  backgroundColor: '#10b981',
                  borderColor: '#10b981',
                  color: '#fff',
                }}
                title="Exit Copilot and open full Call & Disposition panel"
              >
                🚪 Exit & Disposition
              </button>
            )}
          </div>
        </div>

        {/* Prospect Search & Picker Dropdown Popover */}
        {isPickerOpen && (
          <div
            style={{
              backgroundColor: '#111e48',
              borderBottom: '2px solid var(--accent)',
              padding: '0.85rem 1.1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
              maxHeight: '260px',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent)' }}>
                Select Prospect to Disposition or Query:
              </div>
              <input
                type="text"
                placeholder="Search name or phone..."
                value={prospectSearch}
                onChange={(e) => setProspectSearch(e.target.value)}
                style={{
                  padding: '0.35rem 0.6rem',
                  borderRadius: '6px',
                  backgroundColor: '#1b2a59',
                  border: '1px solid var(--border-color)',
                  color: '#fff',
                  fontSize: '0.8rem',
                  width: '200px',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {filteredLeads.slice(0, 15).map((l) => (
                <div
                  key={l.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.45rem 0.6rem',
                    borderRadius: '6px',
                    backgroundColor: selectedProspect?.id === l.id ? 'rgba(200,150,62,0.2)' : 'rgba(255,255,255,0.03)',
                    border: selectedProspect?.id === l.id ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div
                    onClick={() => handleSelectProspect(l, false)}
                    style={{ cursor: 'pointer', flex: 1 }}
                  >
                    <strong style={{ color: '#fff', fontSize: '0.85rem' }}>{l.first_name} {l.last_name}</strong>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginLeft: '0.5rem' }}>
                      {formatPhone(l.phone)} · {l.state || 'AZ'} · {l.status}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleSelectProspect(l, true)}
                    style={{
                      padding: '0.2rem 0.55rem',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      backgroundColor: '#10b981',
                      borderColor: '#10b981',
                      color: '#fff',
                    }}
                  >
                    ⚡ Exit & Disposition
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Selection */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
          <button
            className="btn"
            onClick={() => setActiveTab('chat')}
            style={{
              flex: 1,
              borderRadius: 0,
              borderBottom: activeTab === 'chat' ? '2px solid var(--accent)' : 'none',
              color: activeTab === 'chat' ? 'var(--accent)' : 'var(--text-muted)',
              backgroundColor: 'transparent',
              fontSize: '0.85rem',
              padding: '0.65rem 0.2rem',
              fontWeight: 600,
            }}
          >
            💬 Copilot Q&A
          </button>
          <button
            className="btn"
            onClick={() => setActiveTab('disposition')}
            style={{
              flex: 1,
              borderRadius: 0,
              borderBottom: activeTab === 'disposition' ? '2px solid #10b981' : 'none',
              color: activeTab === 'disposition' ? '#10b981' : 'var(--text-muted)',
              backgroundColor: 'transparent',
              fontSize: '0.85rem',
              padding: '0.65rem 0.2rem',
              fontWeight: 750,
            }}
          >
            📋 Quick Disposition
          </button>
          <button
            className="btn"
            onClick={() => setActiveTab('email')}
            style={{
              flex: 1,
              borderRadius: 0,
              borderBottom: activeTab === 'email' ? '2px solid var(--accent)' : 'none',
              color: activeTab === 'email' ? 'var(--accent)' : 'var(--text-muted)',
              backgroundColor: 'transparent',
              fontSize: '0.85rem',
              padding: '0.65rem 0.2rem',
              fontWeight: 600,
            }}
          >
            ✉️ Email Drafter
          </button>
          <button
            className="btn"
            onClick={() => setActiveTab('compliance')}
            style={{
              flex: 1,
              borderRadius: 0,
              borderBottom: activeTab === 'compliance' ? '2px solid var(--accent)' : 'none',
              color: activeTab === 'compliance' ? 'var(--accent)' : 'var(--text-muted)',
              backgroundColor: 'transparent',
              fontSize: '0.85rem',
              padding: '0.65rem 0.2rem',
              fontWeight: 600,
            }}
          >
            ⚖️ Compliance
          </button>
        </div>

        <div className="slideover-body">
          {/* TAB 1: COPILOT CHAT */}
          {activeTab === 'chat' && (
            <>
              {/* Quick Scheduler Banner: Exit & Disposition */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(11,19,43,0.9))',
                  border: '1px solid rgba(16,185,129,0.4)',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>
                  <span>Working with </span>
                  <strong style={{ color: '#34d399' }}>{selectedProspect ? selectedProspect.name : 'a prospect'}</strong>
                  <span>? Ready to record call outcome?</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleExitAndDisposition()}
                  style={{
                    backgroundColor: '#10b981',
                    borderColor: '#10b981',
                    color: '#fff',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.78rem',
                    fontWeight: 750,
                  }}
                >
                  🚪 Exit & Disposition Now
                </button>
              </div>

              {/* Quick Prompt Pills */}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {[
                  'Who should I call today?',
                  'Turning 65 in 90 days',
                  'Show pipeline summary',
                  'What tasks are overdue?',
                  'My call stats this week',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    className="btn btn-secondary"
                    onClick={() => handleSendMessage(prompt)}
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '12px' }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {/* Message List */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.85rem', paddingRight: '0.3rem' }}>
                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      backgroundColor: m.role === 'user' ? 'var(--accent-soft)' : 'var(--bg-surface)',
                      border: `1px solid ${m.role === 'user' ? 'rgba(200,150,62,0.4)' : 'var(--border-color)'}`,
                      padding: '0.85rem 1rem',
                      borderRadius: '12px',
                      fontSize: '0.88rem',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.content}
                  </div>
                ))}
                {loading && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                    IWG Copilot is analyzing CRM data...
                  </div>
                )}
              </div>

              {/* Input box */}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                <input
                  type="text"
                  placeholder="Ask Copilot a question..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                    fontSize: '0.88rem',
                  }}
                />
                <button className="btn btn-primary" onClick={() => handleSendMessage()} disabled={loading}>
                  Send
                </button>
              </div>
            </>
          )}

          {/* TAB 2: QUICK DISPOSITION (NEW SCHEDULER CAPABILITY) */}
          {activeTab === 'disposition' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {dispSuccessMsg && (
                <div style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid #10b981', color: '#10b981', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  {dispSuccessMsg}
                </div>
              )}

              {dispErrorMsg && (
                <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', color: '#f87171', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  ⚠️ {dispErrorMsg}
                </div>
              )}

              {/* Target Prospect Info Box */}
              <div style={{ background: 'var(--bg-surface)', padding: '0.9rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent)' }}>Prospect to Disposition:</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsPickerOpen(!isPickerOpen)}
                    style={{ fontSize: '0.74rem', padding: '0.2rem 0.5rem' }}
                  >
                    🔍 Change / Search
                  </button>
                </div>
                {selectedProspect ? (
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    {selectedProspect.name} · <span style={{ color: 'var(--accent)' }}>{formatPhone(selectedProspect.phone)}</span> ({selectedProspect.state || 'AZ'})
                  </div>
                ) : (
                  <div style={{ fontSize: '0.85rem', color: '#f87171' }}>
                    No prospect selected. Please select a prospect below.
                  </div>
                )}
              </div>

              {/* Disposition Selection Grid */}
              <div>
                <label style={{ fontWeight: 700, fontSize: '0.88rem', display: 'block', marginBottom: '0.45rem', color: 'var(--text-main)' }}>
                  Select Call Disposition: *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
                  {dispositions.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`btn ${selectedDispId === d.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setSelectedDispId(d.id)}
                      style={{
                        padding: '0.55rem 0.4rem',
                        fontSize: '0.8rem',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        border: selectedDispId === d.id ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                      }}
                    >
                      <span>{d.icon || '📞'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Conditional Callback Date/Time */}
              {dispositions.find((d) => d.id === selectedDispId)?.automation?.needs_callback_time && (
                <div>
                  <label style={{ fontWeight: 600, fontSize: '0.84rem', display: 'block', marginBottom: '0.3rem', color: 'var(--accent)' }}>
                    Callback Date & Time (MST) *
                  </label>
                  <input
                    type="datetime-local"
                    value={callbackAt}
                    onChange={(e) => setCallbackAt(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                  />
                </div>
              )}

              {/* Conditional Appointment Date/Time */}
              {dispositions.find((d) => d.id === selectedDispId)?.automation?.needs_appointment && (
                <div>
                  <label style={{ fontWeight: 600, fontSize: '0.84rem', display: 'block', marginBottom: '0.3rem', color: 'var(--accent)' }}>
                    Appointment Date & Time (MST) *
                  </label>
                  <input
                    type="datetime-local"
                    value={appointmentAt}
                    onChange={(e) => setAppointmentAt(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                  />
                </div>
              )}

              {/* Call Notes */}
              <div>
                <label style={{ fontWeight: 600, fontSize: '0.84rem', display: 'block', marginBottom: '0.3rem' }}>
                  Call Notes & Outcome
                </label>
                <textarea
                  rows={3}
                  placeholder="Record customer preferences, objections handled, or next steps..."
                  value={dispNotes}
                  onChange={(e) => setDispNotes(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: '0.85rem' }}
                />
              </div>

              {/* TPMO Disclaimer verbal checkbox */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: 'var(--bg-surface)', padding: '0.65rem', borderRadius: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={tpmoGiven} onChange={(e) => setTpmoGiven(e.target.checked)} style={{ marginTop: '0.2rem' }} />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-main)' }}>
                  <strong>TPMO Verbal Disclosure Given:</strong> CMS standard disclosure was provided during this outreach.
                </span>
              </label>

              {/* Action Buttons: Save & Exit OR Open Full Call Panel */}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleExitAndDisposition()}
                  style={{ flex: 1, padding: '0.75rem', fontWeight: 600, fontSize: '0.85rem' }}
                  title="Close Copilot and open full Call Panel with telephony dials"
                >
                  📞 Exit to Full Call Panel
                </button>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveQuickDisposition}
                  disabled={submittingDisp || !selectedProspect}
                  style={{
                    flex: 1.5,
                    padding: '0.75rem',
                    fontWeight: 750,
                    fontSize: '0.88rem',
                    backgroundColor: '#10b981',
                    borderColor: '#10b981',
                    color: '#fff',
                    boxShadow: '0 2px 10px rgba(16,185,129,0.3)',
                  }}
                >
                  {submittingDisp ? 'Saving & Exiting...' : '🚪 Exit & Save Disposition'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: EMAIL DRAFTER */}
          {activeTab === 'email' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Recipient Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Arthur Pendleton"
                  value={emailName || (selectedProspect ? selectedProspect.name : '')}
                  onChange={(e) => setEmailName(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                />
              </div>

              <div>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Email Purpose / Topic</label>
                <select
                  value={emailPurpose}
                  onChange={(e) => setEmailPurpose(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                >
                  <option value="AEP Annual Review">AEP Annual Review Outreach</option>
                  <option value="Turning 65 Prep">Turning 65 Medicare Introduction</option>
                  <option value="Confirm Appointment">Confirm Scheduled Appointment</option>
                  <option value="Request Scope of Appointment">Scope of Appointment (SOA) Link Request</option>
                  <option value="Welcome New Client">Welcome New Client</option>
                </select>
              </div>

              <button className="btn btn-primary" onClick={handleGenerateEmail} disabled={emailDrafting || (!emailName && !selectedProspect)}>
                {emailDrafting ? 'Drafting with AI...' : '✨ Generate Compliant Email'}
              </button>

              {emailDraft && (
                <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.5rem', color: 'var(--accent)' }}>Subject: {emailDraft.subject}</div>
                  <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', color: 'var(--text-main)' }}>{emailDraft.body}</div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: COMPLIANCE CHECK */}
          {activeTab === 'compliance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>
                  Call Notes or Transcript to Audit
                </label>
                <textarea
                  rows={5}
                  placeholder="Paste agent call notes here..."
                  value={complianceText}
                  onChange={(e) => setComplianceText(e.target.value)}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: '0.88rem' }}
                />
              </div>

              <button className="btn btn-primary" onClick={handleRunCompliance}>
                ⚖️ Audit for CMS Compliance
              </button>

              {complianceResults && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {complianceResults.issues.map((iss: any, i: number) => (
                    <div
                      key={i}
                      style={{
                        padding: '0.75rem',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        backgroundColor: iss.level === 'error' ? 'var(--danger-bg)' : iss.level === 'warning' ? 'var(--warning-bg)' : 'var(--success-bg)',
                        color: iss.level === 'error' ? 'var(--danger)' : iss.level === 'warning' ? 'var(--warning)' : 'var(--success)',
                        border: `1px solid ${iss.level === 'error' ? 'rgba(239,68,68,0.3)' : iss.level === 'warning' ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`,
                      }}
                    >
                      {iss.level === 'error' ? '🚫' : iss.level === 'warning' ? '⚠️' : '✅'} {iss.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Exit Copilot Action Bar */}
        <div
          style={{
            padding: '0.65rem 1.25rem',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-surface)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Done with Copilot? (Press <kbd style={{ padding: '0.1rem 0.35rem', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.72rem' }}>Esc</kbd> to exit)
          </span>
          <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToDashboard}
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem', fontWeight: 600 }}
              title="Exit Copilot and return to Dashboard"
            >
              🏠 Dashboard
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToLeads}
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem', fontWeight: 600 }}
              title="Exit Copilot and return to Leads"
            >
              📋 Leads
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{
                fontSize: '0.78rem',
                padding: '0.35rem 0.65rem',
                fontWeight: 700,
                borderColor: 'rgba(239, 68, 68, 0.4)',
                color: '#f87171',
              }}
              title="Exit and close Copilot"
            >
              🚪 Exit Copilot
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
