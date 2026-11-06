import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api, formatPhone, openGoogleVoiceWindow } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CallPanel } from '../components/CallPanel';
import { BookAppointmentModal } from '../components/BookAppointmentModal';
import { InboundSMSSimulatorModal } from '../components/InboundSMSSimulatorModal';
import { WarmTransferModal } from '../components/WarmTransferModal';
import { BlandCallModal } from '../components/BlandCallModal';

export const RecordDetailPage: React.FC<{ type: 'lead' | 'client' | 'opportunity' }> = ({ type }) => {
  const { id } = useParams<{ id: string }>();
  const { user, isLicensed, activeRole } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.email?.toLowerCase() === 'king@iwillglobal.com' || user?.email?.toLowerCase() === 'aneesha@iwillglobal.com' || activeRole === 'admin';
  const [record, setRecord] = useState<any>(null);
  const [related, setRelated] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [activeCallLead, setActiveCallLead] = useState<any>(null);
  const [showAppointmentModal, setShowAppointmentModal] = useState<boolean>(false);
  const [showWarmTransferModal, setShowWarmTransferModal] = useState<boolean>(false);
  const [showBlandModal, setShowBlandModal] = useState<boolean>(false);
  const [showSmsSimulator, setShowSmsSimulator] = useState<boolean>(false);
  const [aiBrief, setAiBrief] = useState<string>('');
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [qualifiedAgents, setQualifiedAgents] = useState<any[]>([]);
  const [assigningAgent, setAssigningAgent] = useState(false);
  const [unassigning, setUnassigning] = useState(false);

  const loadRecord = async () => {
    setLoading(true);
    try {
      const endpoint = type === 'lead' ? 'leads' : type === 'client' ? 'clients' : 'opportunities';
      const rec = await api.get(`/records/${endpoint}/${id}`);
      setRecord(rec);
      try {
        sessionStorage.setItem('iwg_last_active_prospect', JSON.stringify({
          id: rec.id,
          name: `${rec.first_name || ''} ${rec.last_name || ''}`.trim() || rec.name || 'Prospect',
          phone: rec.phone || '',
          type: type === 'opportunity' ? 'lead' : type,
          state: rec.state || 'AZ',
          status: rec.status,
        }));
      } catch (e) {}
      const rel = await api.get(`/records/${endpoint}/${id}/related`);
      setRelated(rel);

      if (type === 'lead') {
        api.get(`/appointments/available-agents?state=${encodeURIComponent(rec.state || 'AZ')}`)
          .then((ag) => setQualifiedAgents(ag || []))
          .catch(() => {});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecord();
  }, [id, type]);

  const handleGenerateBrief = async () => {
    setLoadingBrief(true);
    try {
      const res = await api.post(`/ai/insight/${type}/${id}`);
      setAiBrief(res.brief);
    } catch (err: any) {
      alert(`Failed to load AI brief: ${err.message}`);
    } finally {
      setLoadingBrief(false);
    }
  };

  const handleConvertLead = async () => {
    try {
      const res = await api.post(`/leads/${id}/convert`, {});
      alert(`Lead successfully converted to Client!`);
      window.location.href = `/clients/${res.client.id}`;
    } catch (err: any) {
      alert(`Lead conversion failed: ${err.message}`);
    }
  };

  const handleUnassignProspect = async () => {
    if (!window.confirm(`Are you sure you want to unassign this prospect and return them to the Master List Bank unassigned pool?`)) {
      return;
    }
    setUnassigning(true);
    try {
      const res = await api.post(`/records/leads/${id}/unassign`);
      alert(`⚡ ${res.message || 'Prospect unassigned and returned to Master List Bank.'}`);
      loadRecord();
    } catch (err: any) {
      alert(`Unassign failed: ${err.message}`);
    } finally {
      setUnassigning(false);
    }
  };

  const handleAssignToAgent = async (targetAgentId: string) => {
    if (!targetAgentId) return;
    if (targetAgentId === '__unassign__') {
      return handleUnassignProspect();
    }
    setAssigningAgent(true);
    try {
      const res = await api.post(`/records/leads/${id}/assign-agent`, {
        agent_id: targetAgentId,
      });
      alert(`🎉 Lead successfully assigned to ${res.assigned_agent.name} (${res.assigned_agent.is_principal ? 'Principal Broker' : 'Licensed Agent'})!`);
      loadRecord();
    } catch (err: any) {
      alert(`Lead assignment failed: ${err.message}`);
    } finally {
      setAssigningAgent(false);
    }
  };

  const handleDeleteLead = async () => {
    if (!window.confirm(`⚠️ Are you sure you want to permanently delete lead ${name}? This action cannot be undone.`)) {
      return;
    }
    try {
      await api.delete(`/records/leads/${id}`);
      alert(`🗑️ Lead ${name} has been permanently deleted.`);
      window.location.href = '/leads';
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading record...</div>;
  if (!record) return <div style={{ padding: '2rem', color: 'var(--danger)' }}>Record not found.</div>;

  const name = record.first_name ? `${record.first_name} ${record.last_name}` : record.name;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header Highlights Panel */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--accent)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em' }}>
              {type} Record
            </div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: '0.2rem 0' }}>{name}</h1>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              📞 {formatPhone(record.phone)} · 📍 {record.address ? `${record.address}, ` : ''}{record.city ? `${record.city}, ` : ''}{record.state || 'AZ'} {record.zip || ''}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={handleGenerateBrief}
              disabled={loadingBrief}
            >
              🤖 {loadingBrief ? 'Briefing...' : 'AI Pre-Call Brief'}
            </button>

            {type !== 'opportunity' && (
              <button
                className="btn btn-accent"
                onClick={() => setShowAppointmentModal(true)}
              >
                📅 Schedule Appointment
              </button>
            )}

            {type !== 'opportunity' && (
              <button
                className="btn btn-secondary"
                disabled={!activeCallLead}
                onClick={() => {
                  if (activeCallLead) {
                    setShowWarmTransferModal(true);
                  }
                }}
                style={{
                  borderColor: activeCallLead ? 'var(--accent)' : 'rgba(255, 255, 255, 0.15)',
                  color: activeCallLead ? 'var(--accent)' : '#64748b',
                  backgroundColor: activeCallLead ? 'rgba(200, 150, 62, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                  fontWeight: 700,
                  cursor: activeCallLead ? 'pointer' : 'not-allowed',
                  opacity: activeCallLead ? 1 : 0.6,
                }}
                title={activeCallLead ? "Live 3-Way Warm Transfer (Call active)" : "🔒 Warm Transfer Locked: Connect live call with prospect first"}
              >
                <span>{activeCallLead ? '⚡' : '🔒'}</span> 3-Way Warm Transfer
              </button>
            )}

            <a
              href={user?.google_meet_url || (user?.email ? `https://meet.google.com/iwg-${user.email.split('@')[0]}` : 'https://meet.google.com/iwg-agent')}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
              style={{ textDecoration: 'none', borderColor: '#3b82f6', color: '#60a5fa', fontWeight: 700 }}
            >
              🎥 Google Meet Video
            </a>

            {record.phone && (
              <button
                className="btn btn-secondary"
                onClick={() => setShowSmsSimulator(true)}
                title="Test customer replying YES / Y to text message"
              >
                📱 Test Customer Reply (YES/Y)
              </button>
            )}

            {record.phone && (
              <button
                className="btn btn-primary"
                onClick={() => setActiveCallLead({ id: record.id, name, phone: record.phone, email: record.email, address: record.address, type, state: record.state, status: record.status })}
              >
                📞 Call (Google Voice)
              </button>
            )}

            {record.phone && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  openGoogleVoiceWindow(record.phone);
                  window.dispatchEvent(
                    new CustomEvent('iwg-open-sarah-voice', {
                      detail: {
                        mode: 'outbound',
                        lead_id: record.id,
                        prospect_name: name || 'Medicare Beneficiary',
                        phone: record.phone,
                        state: record.state || 'AZ',
                        address: record.address || '',
                      },
                    })
                  );
                }}
                style={{
                  borderColor: '#8b5cf6',
                  color: '#c084fc',
                  background: 'rgba(139, 92, 246, 0.15)',
                  fontWeight: 700,
                }}
                title="Launch Sarah Voice AI + Google Voice (480) 331-9455 to call, qualify, book, or warm-transfer this prospect"
              >
                🎙️ Sarah AI Voice Call
              </button>
            )}

            {type === 'lead' && isLicensed && record.status !== 'Converted' && (
              <button className="btn btn-success" onClick={handleConvertLead}>
                ✨ Convert Lead → Client
              </button>
            )}

            {type === 'lead' && isAdmin && (
              <button
                type="button"
                className="btn"
                onClick={handleDeleteLead}
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                  color: '#fca5a5',
                  border: '1.5px solid rgba(239, 68, 68, 0.55)',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  cursor: 'pointer',
                }}
                title="Admin: Permanently delete this lead"
              >
                🗑️ Delete Lead
              </button>
            )}
          </div>
        </div>

        {/* AI Brief Banner if loaded */}
        {aiBrief && (
          <div style={{ marginTop: '1.25rem', padding: '1rem', backgroundColor: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: '12px', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>
            {aiBrief}
          </div>
        )}
      </div>

      {/* Outbound Scheduler Lead Assignment Panel */}
      {type === 'lead' && (
        <div style={{ background: '#081232', border: '1.5px solid var(--accent)', borderRadius: '14px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#c8963e', color: '#051039', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.35rem', fontWeight: 800 }}>
              👑
            </div>
            <div>
              <div style={{ fontSize: '0.76rem', color: '#ffd88a', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.06em' }}>
                Assigned State-Licensed Agent ({record.state || 'AZ'})
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginTop: '0.15rem' }}>
                {record.assigned_agent_id === 'u_principal' ? (
                  <span style={{ color: '#ffd88a', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span>👑 King Amen Ra — Principal & Broker of Record</span>
                    <span style={{ fontSize: '0.75rem', background: '#c8963e', color: '#051039', padding: '1px 6px', borderRadius: '4px', fontWeight: 800 }}>NPN: 16094432</span>
                  </span>
                ) : record.assigned_agent_id ? (
                  <span>
                    {qualifiedAgents.find(a => a.id === record.assigned_agent_id)?.name || 'Assigned Agent'}
                    {qualifiedAgents.find(a => a.id === record.assigned_agent_id)?.npn && ` (NPN: ${qualifiedAgents.find(a => a.id === record.assigned_agent_id)?.npn})`}
                  </span>
                ) : (
                  <span style={{ color: '#94a3b8' }}>⚡ Unassigned (Select King Amen Ra or an agent below to assign)</span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            {isAdmin && (record.assigned_agent_id || record.owner_id) && (
              <button
                type="button"
                className="btn"
                disabled={unassigning || assigningAgent}
                onClick={handleUnassignProspect}
                style={{
                  padding: '0.55rem 0.95rem',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                  color: '#fca5a5',
                  border: '1.5px solid rgba(239, 68, 68, 0.55)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  cursor: 'pointer',
                }}
                title="Admin: Unassign prospect and return to Master List Bank unassigned pool"
              >
                ⚡ Unassign Prospect
              </button>
            )}

            <button
              type="button"
              className="btn btn-primary"
              disabled={assigningAgent || unassigning || record.assigned_agent_id === 'u_principal'}
              onClick={() => handleAssignToAgent('u_principal')}
              style={{
                background: record.assigned_agent_id === 'u_principal' ? 'rgba(200,150,62,0.2)' : 'linear-gradient(135deg, #c8963e, #936021)',
                border: '1px solid #c8963e',
                color: '#fff',
                fontWeight: 800,
                fontSize: '0.85rem',
                padding: '0.55rem 1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <span>👑</span>
              <span>{record.assigned_agent_id === 'u_principal' ? 'Assigned to King Amen Ra' : 'Assign to King Amen Ra'}</span>
            </button>

            <select
              value={record.assigned_agent_id || ''}
              onChange={(e) => handleAssignToAgent(e.target.value)}
              disabled={assigningAgent || unassigning}
              style={{
                padding: '0.55rem 0.85rem',
                borderRadius: '8px',
                background: '#0e1d47',
                color: '#fff',
                border: '1px solid var(--border-color)',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              <option value="">-- Choose Agent to Assign --</option>
              {isAdmin && (record.assigned_agent_id || record.owner_id) && (
                <option value="__unassign__">⚡ [Admin] Unassign & Return to Master Bank</option>
              )}
              <option value="u_principal">👑 King Amen Ra — Principal & Broker of Record (NPN: 16094432)</option>
              {qualifiedAgents
                .filter(a => a.id !== 'u_principal' && a.email?.toLowerCase() !== 'king@iwillglobal.com')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.title || 'Agent'}) — NPN: {a.npn} [{a.states?.join(', ')}]
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      {/* Stage Path Bar for Leads & Opportunities */}
      {type === 'lead' && (
        <div className="path-container">
          {['New', 'Contacted', 'SOA Sent', 'SOA Signed', 'Appointment Set', 'Converted'].map((st) => (
            <div
              key={st}
              className={`path-step ${record.status === st ? 'current' : ''}`}
            >
              {st}
            </div>
          ))}
        </div>
      )}

      {/* Related Lists Grid */}
      <div className="responsive-grid-sidebar">
        {/* Left: Activities & Timeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1rem' }}>Activity History</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {(related?.activities || []).map((a: any) => (
                <div key={a.id} style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.subject}</span>
                    <span className="badge badge-gold" style={{ fontSize: '0.75rem' }}>{a.status || a.disposition || a.type}</span>
                  </div>
                  {a.body && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                  {a.meta?.scheduler_credit_status && (
                    <div style={{ fontSize: '0.8rem', marginTop: '0.4rem', color: a.meta.scheduler_credit_status === 'Credited' ? 'var(--success)' : 'var(--warning)', fontWeight: 700 }}>
                      {a.meta.scheduler_credit_status === 'Credited' ? '🏅 Scheduler Lead Credit: AWARDED' : '⏳ Scheduler Lead Credit: PENDING Customer YES Reply'}
                    </div>
                  )}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.4rem' }}>
                    {new Date(a.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Scope of Appointment & Policies */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Scope of Appointment</h3>
            {(related?.soas || []).length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>No SOA on file yet.</div>
            ) : (
              (related?.soas || []).map((s: any) => (
                <div key={s.id} style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', fontSize: '0.82rem' }}>
                  <div style={{ fontWeight: 700, color: s.status === 'Signed' ? 'var(--success)' : 'var(--warning)' }}>
                    {s.status === 'Signed' ? '✅ Signed' : '⏳ Sent'} ({s.method})
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Signed by: {s.signer_name || s.beneficiary_name}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showAppointmentModal && (
        <BookAppointmentModal
          contact={{ id: record.id, name, phone: record.phone, email: record.email, type: type as any, state: record.state, address: record.address }}
          onClose={() => setShowAppointmentModal(false)}
          onScheduled={() => loadRecord()}
        />
      )}

      {showSmsSimulator && (
        <InboundSMSSimulatorModal
          defaultPhone={record.phone}
          onClose={() => setShowSmsSimulator(false)}
          onProcessed={() => loadRecord()}
        />
      )}

      {showWarmTransferModal && (
        <WarmTransferModal
          isOpen={showWarmTransferModal}
          contact={{
            id: record.id,
            name: `${record.first_name || ''} ${record.last_name || ''}`.trim() || 'Prospect',
            phone: record.phone || '',
            type: type === 'opportunity' ? 'lead' : type,
            state: record.state || 'AZ',
            notes: record.notes,
          }}
          onClose={() => setShowWarmTransferModal(false)}
          onTransferComplete={() => loadRecord()}
        />
      )}

      {activeCallLead && (
        <CallPanel
          contact={activeCallLead}
          onClose={() => setActiveCallLead(null)}
          onCallCompleted={() => loadRecord()}
        />
      )}

      {showBlandModal && (
        <BlandCallModal
          isOpen={showBlandModal}
          lead={record}
          onClose={() => setShowBlandModal(false)}
          onCallDispatched={() => loadRecord()}
        />
      )}
    </div>
  );
};

