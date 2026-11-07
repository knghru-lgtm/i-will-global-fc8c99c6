import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, type Role } from '../lib/auth';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { openSarahVoiceModal } from '../components/SarahVoiceModal';

export const TeamPage: React.FC = () => {
  const { isManager, activeRole, user } = useAuth();
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sarahPhone, setSarahPhone] = useState('');
  const [activatingSarah, setActivatingSarah] = useState(false);
  const [sarahBannerMsg, setSarahBannerMsg] = useState('');

  // Add / Edit Modal State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [passwordResetTarget, setPasswordResetTarget] = useState<any | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<Role>('scheduler');
  const [formTitle, setFormTitle] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formNpn, setFormNpn] = useState('');
  const [formStates, setFormStates] = useState('AZ');
  const [formPassword, setFormPassword] = useState('Welcome123!');
  const [formActive, setFormActive] = useState(true);

  const isSarahRow = (u: any) =>
    u?.id === 'u_sarah_ai' ||
    /sarah.*voice ai|sarah/i.test(`${u?.name || ''} ${u?.email || ''} ${u?.title || ''}`);

  const fetchTeam = async () => {
    try {
      const res = await api.get('/team');
      const list = Array.isArray(res) ? res : [];
      // Ensure Sarah Voice AI is always displayed with her live (480) 331-9455 identity and pinned at the top
      const normalized = list.map((u: any) =>
        isSarahRow(u)
          ? {
              ...u,
              name: 'Sarah — Voice AI Receptionist & Outbound Caller',
              email: 'sarah@iwillglobal.com',
              title: 'Autonomous Voice AI Outbound Caller & Receptionist (480) 331-9455',
              phone: '(480) 331-9455',
              active: true,
            }
          : u
      );
      normalized.sort((a: any, b: any) => (isSarahRow(b) ? 1 : 0) - (isSarahRow(a) ? 1 : 0));
      setTeam(normalized);
    } catch (err) {
      console.error('Failed to load team roster:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivateSarah = async (phoneOverride?: string) => {
    const targetPhone = (phoneOverride ?? sarahPhone).trim();
    setActivatingSarah(true);
    setSarahBannerMsg('');
    try {
      const res = await api.post('/sarah/activate', {
        phone_number: targetPhone || undefined,
      });
      const firstDispatched = res?.dispatched?.[0];
      const dialDigits = (targetPhone || firstDispatched?.phone || res?.call?.to || '').replace(/\D/g, '');
      const gvUrl =
        res?.call?.google_voice_url ||
        firstDispatched?.google_voice_url ||
        (dialDigits
          ? `https://voice.google.com/u/0/calls?a=nc,%2B${dialDigits.length === 10 ? '1' + dialDigits : dialDigits}`
          : 'https://voice.google.com/u/0/calls');
      try {
        window.open(gvUrl, '_blank', 'noopener,noreferrer');
      } catch {}
      openSarahVoiceModal({
        mode: 'outbound',
        leadPhone: targetPhone || firstDispatched?.phone || res?.call?.to || '',
        leadName:
          firstDispatched?.prospect_name ||
          (res?.lead ? `${res.lead.first_name || ''} ${res.lead.last_name || ''}`.trim() : 'Valued Beneficiary'),
        leadState: res?.lead?.state || 'AZ',
        autoStart: true,
      });
      setSarahBannerMsg(
        res?.message ||
          `✅ Sarah Voice AI activated on (480) 331-9455! Outbound calling & appointment scheduling (Telephone 30m, In-Person 60m, Video 30m) is LIVE.`
      );
      fetchTeam();
    } catch (err: any) {
      openSarahVoiceModal({
        mode: 'outbound',
        leadPhone: targetPhone || '',
        leadName: 'Valued Beneficiary',
        leadState: 'AZ',
        autoStart: true,
      });
      setSarahBannerMsg(
        `🎙️ Sarah Live Voice Console opened on (480) 331-9455! (${err?.message || 'Ready to dial via Google Voice'})`
      );
    } finally {
      setActivatingSarah(false);
    }
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const openAddModal = () => {
    setFormName('');
    setFormEmail('');
    setFormRole('scheduler');
    setFormTitle('Outbound Call Scheduler');
    setFormPhone('(480) 331-9400');
    setFormNpn('');
    setFormStates('AZ');
    setFormPassword('Welcome123!');
    setFormActive(true);
    setIsAddOpen(true);
  };

  const openEditModal = (u: any) => {
    setEditUser(u);
    setFormName(u.name || '');
    setFormEmail(u.email || '');
    setFormRole(u.role || 'scheduler');
    setFormTitle(u.title || '');
    setFormPhone(u.phone || '');
    setFormNpn(u.npn || '');
    setFormStates(Array.isArray(u.states) ? u.states.join(', ') : u.states || 'AZ');
    setFormPassword('');
    setFormActive(u.active !== false);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsedStates = formStates.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      await api.post('/users', {
        name: formName,
        email: formEmail,
        role: formRole,
        title: formTitle,
        phone: formPhone,
        npn: formNpn || undefined,
        states: parsedStates.length ? parsedStates : ['AZ'],
        password: formPassword || 'Welcome123!',
      });
      alert(`✅ Team member ${formName} (${formEmail}) successfully added as ${formRole.toUpperCase()}!`);
      setIsAddOpen(false);
      fetchTeam();
    } catch (err: any) {
      alert(`Error adding team member: ${err.message}`);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    try {
      const parsedStates = formStates.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const payload: any = {
        name: formName,
        role: formRole,
        title: formTitle,
        phone: formPhone,
        npn: formNpn || undefined,
        states: parsedStates,
        active: formActive,
      };
      if (formPassword) payload.password = formPassword;

      await api.patch(`/users/${editUser.id}`, payload);
      alert(`✅ Team member ${formName} successfully updated! Role: ${formRole.toUpperCase()}`);
      setEditUser(null);
      fetchTeam();
    } catch (err: any) {
      alert(`Error updating team member: ${err.message}`);
    }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to permanently remove "${name}" from the team? This action cannot be undone.`)) return;
    try {
      await api.delete(`/users/${id}`);
      alert(`✅ Team member "${name}" has been removed.`);
      if (editUser?.id === id) setEditUser(null);
      fetchTeam();
    } catch (err: any) {
      alert(`Error removing team member: ${err.message}`);
    }
  };

  const isAdmin = user?.role === 'admin' || user?.email?.toLowerCase() === 'king@iwillglobal.com' || user?.email?.toLowerCase() === 'aneesha@iwillglobal.com' || activeRole === 'admin' || isManager;

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading team roster...</div>;

  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <h2 style={{ color: '#ef4444', fontSize: '1.4rem', fontWeight: 700 }}>🔒 Access Restricted</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.95rem' }}>
          The Team Directory & Licensing roster is strictly available to Administrators only.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>I Will Global Team & Role Management</h1>
          <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
            Principal & COO Governance · Manage 20+ Licensed Agents, Schedulers & Executive Roles
          </div>
        </div>

        {isManager && (
          <button className="btn btn-primary" onClick={openAddModal} style={{ fontWeight: 700, padding: '0.6rem 1.1rem' }}>
            ➕ Add Team Member & Role
          </button>
        )}
      </div>

      {/* Sarah Voice AI (480) 331-9455 Outbound Caller & Appointment Scheduler Command Bar */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(30, 58, 138, 0.35))',
          border: '1.5px solid rgba(16, 185, 129, 0.55)',
          borderRadius: '14px',
          padding: '1.1rem 1.35rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #10b981, #059669)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.45rem',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
              }}
            >
              🎙️
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, fontSize: '1.05rem', color: '#ffffff' }}>
                  Sarah — Voice AI Receptionist & Outbound Caller
                </span>
                <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>
                  🟢 100% FREE · (480) 331-9455
                </span>
                <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>
                  📞 Telephone (30m) · 🏛️ In-Person (60m) · 💻 Video (30m)
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginTop: '0.2rem' }}>
                Answers all inbound calls 24/7 on <strong>(480) 331-9455</strong>, calls assigned leads via Google Voice, warm-transfers to{' '}
                <strong>King Amen Ra (+1 602-456-9681)</strong> with private whisper, and schedules appointments on the Master Calendar.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
            {isAdmin && (
              <>
                <input
                  type="tel"
                  value={sarahPhone}
                  onChange={(e) => setSarahPhone(e.target.value)}
                  placeholder="Phone or blank for Queue"
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(16, 185, 129, 0.5)',
                    background: 'rgba(15, 23, 42, 0.85)',
                    color: '#fff',
                    fontSize: '0.85rem',
                    width: '185px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleActivateSarah()}
                  disabled={activatingSarah}
                  style={{
                    padding: '0.55rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid #34d399',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                  }}
                >
                  {activatingSarah ? 'Starting Workday...' : `🚀 Activate Sarah Workday & Call ${sarahPhone || 'Assigned Leads'}`}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() =>
                openSarahVoiceModal({
                  mode: isAdmin ? 'outbound' : 'inbound',
                  leadPhone: sarahPhone || '',
                  leadName: 'Valued Beneficiary',
                  leadState: 'AZ',
                })
              }
              className="btn btn-secondary"
              style={{
                padding: '0.55rem 0.9rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                borderColor: '#f59e0b',
                color: '#fde68a',
              }}
            >
              {isAdmin ? '🎙️ Sarah Outbound & Receptionist Console' : '🎙️ Sarah Virtual Receptionist'}
            </button>
            <Link
              to="/leads"
              className="btn btn-secondary"
              style={{ padding: '0.55rem 0.85rem', fontSize: '0.8rem', fontWeight: 700, textDecoration: 'none' }}
            >
              📋 Assign Leads & Queue
            </Link>
            <Link
              to="/calendar"
              className="btn btn-secondary"
              style={{ padding: '0.55rem 0.85rem', fontSize: '0.8rem', fontWeight: 700, textDecoration: 'none' }}
            >
              📅 Master Calendar
            </Link>
          </div>
        </div>
        {sarahBannerMsg && (
          <div
            style={{
              padding: '0.55rem 0.85rem',
              borderRadius: '8px',
              background: 'rgba(16, 185, 129, 0.18)',
              border: '1px solid rgba(16, 185, 129, 0.45)',
              color: '#a7f3d0',
              fontSize: '0.83rem',
              fontWeight: 600,
            }}
          >
            {sarahBannerMsg}
          </div>
        )}
      </div>

      {/* Roster Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Team Member</th>
              <th>Role & Title</th>
              <th>NPN Number</th>
              <th>Licensed States</th>
              <th>AHIP Certification</th>
              <th>Carrier Appointments</th>
              <th>Calls Today</th>
              <th>Activity History</th>
              {isManager && <th>Governance</th>}
            </tr>
          </thead>
          <tbody>
            {team.map((u) => {
              const ahip = (u.credentials || []).find((c: any) => c.kind === 'certification' && c.name === 'AHIP');
              const appointments = (u.credentials || []).filter((c: any) => c.kind === 'appointment');
              const isSarah = isSarahRow(u);

              return (
                <tr
                  key={u.id}
                  style={{
                    opacity: u.active === false ? 0.5 : 1,
                    background: isSarah ? 'rgba(16, 185, 129, 0.08)' : undefined,
                  }}
                >
                  <td>
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span>{u.name}</span>
                      {isSarah && (
                        <span className="badge badge-success" style={{ fontSize: '0.68rem' }}>
                          🎙️ LIVE AI CALLER & RECEPTIONIST
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</div>
                    {u.phone && <div style={{ fontSize: '0.72rem', color: isSarah ? '#34d399' : '#64748b', fontWeight: isSarah ? 700 : 400 }}>📞 {u.phone}</div>}
                  </td>

                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'badge-danger' : u.role === 'manager' ? 'badge-gold' : u.role === 'licensed_agent' ? 'badge-info' : 'badge-warning'}`}>
                      {u.title || u.role.replace('_', ' ')}
                    </span>
                    {u.active === false && <span className="badge badge-danger" style={{ marginLeft: '0.4rem', fontSize: '0.68rem' }}>Disabled</span>}
                  </td>

                  <td>
                    <code>{u.npn || 'N/A (Scheduler)'}</code>
                  </td>

                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      {(u.states || ['AZ']).map((st: string) => (
                        <span key={st} className="badge badge-gold" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                          {st}
                        </span>
                      ))}
                    </div>
                  </td>

                  <td>
                    {u.role === 'scheduler' ? (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>N/A</span>
                    ) : ahip ? (
                      <span className="badge badge-success">✅ AHIP {ahip.plan_year || 2026}</span>
                    ) : (
                      <span className="badge badge-danger">Pending</span>
                    )}
                  </td>

                  <td>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {appointments.length ? appointments.map((a: any) => a.name).join(', ') : 'Unlicensed'}
                    </div>
                  </td>

                  <td>
                    <strong>{u.calls_today || 0}</strong>
                  </td>

                  <td>
                    <Link
                      to={`/activities?user_id=${u.id}`}
                      className="btn btn-secondary"
                      style={{
                        padding: '0.35rem 0.65rem',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        backgroundColor: 'rgba(59, 130, 246, 0.12)',
                        borderColor: 'rgba(59, 130, 246, 0.4)',
                        color: '#93c5fd',
                      }}
                      title={`View Activity Timeline & History for ${u.name}`}
                    >
                      <span>🕒</span> <span>Timeline & History</span>
                    </Link>
                  </td>

                  {isManager && (
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {isSarah && isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleActivateSarah()}
                            style={{
                              padding: '0.35rem 0.7rem',
                              fontSize: '0.78rem',
                              fontWeight: 800,
                              background: 'linear-gradient(135deg, #10b981, #059669)',
                              color: '#ffffff',
                              border: '1px solid #34d399',
                              borderRadius: '6px',
                              cursor: 'pointer',
                            }}
                            title="Admin Only: Activate Sarah Voice AI on (480) 331-9455 to start scheduling workday & call assigned leads"
                          >
                            🚀 Activate Sarah Workday
                          </button>
                        )}
                        <button
                          className="btn btn-secondary"
                          onClick={() => openEditModal(u)}
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem', fontWeight: 600 }}
                          title="Assign roles and edit details"
                        >
                          ⚙️ Assign Role
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setPasswordResetTarget(u)}
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem', fontWeight: 600, borderColor: '#c8963e', color: '#ffd88a' }}
                            title={`Reset password for ${u.name}`}
                          >
                            🔑 Password
                          </button>
                        )}
                        {isAdmin && u.id !== user?.id && (
                          <button
                            onClick={() => handleDeleteUser(u.id, u.name)}
                            style={{
                              padding: '0.35rem 0.65rem',
                              fontSize: '0.78rem',
                              fontWeight: 600,
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              color: '#ef4444',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              borderRadius: '6px',
                              cursor: 'pointer',
                            }}
                            title="Remove team member"
                          >
                            🗑️ Remove
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Team Member Modal */}
      {isAddOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.75rem', width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--text-main)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>➕ Add New Team Member</h2>
              <button onClick={() => setIsAddOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Full Name</label>
                <input type="text" className="input" required value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Marcus Vance" style={{ width: '100%' }} />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Google Workspace Email (@iwillglobal.com)</label>
                <input type="email" className="input" required value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="user@iwillglobal.com" style={{ width: '100%' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Assigned Role</label>
                  <select className="input" value={formRole} onChange={(e) => setFormRole(e.target.value as Role)} style={{ width: '100%' }}>
                    <option value="admin">👑 Admin / Executive</option>
                    <option value="manager">👔 Sales Manager</option>
                    <option value="licensed_agent">⚖️ Licensed Agent</option>
                    <option value="scheduler">📞 Outbound Scheduler</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Official Title</label>
                  <input type="text" className="input" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="e.g. Senior Medicare Advisor" style={{ width: '100%' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Phone Number</label>
                  <input type="text" className="input" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder="(602) 456-9681" style={{ width: '100%' }} />
                </div>

                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>NPN Number (If Licensed)</label>
                  <input type="text" className="input" value={formNpn} onChange={(e) => setFormNpn(e.target.value)} placeholder="e.g. 16094432" style={{ width: '100%' }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Licensed States (Comma-separated)</label>
                <input type="text" className="input" value={formStates} onChange={(e) => setFormStates(e.target.value)} placeholder="AZ, CA, NV, TX, FL, NM, CO" style={{ width: '100%' }} />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Initial Password</label>
                <input type="text" className="input" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Welcome123!" style={{ width: '100%' }} />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsAddOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ fontWeight: 700 }}>Save & Add Team Member</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Team Member Modal */}
      {editUser && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.75rem', width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--text-main)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>⚙️ Edit Team Member: {editUser.name}</h2>
              <button onClick={() => setEditUser(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <form onSubmit={handleUpdateUser} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Full Name</label>
                <input type="text" className="input" required value={formName} onChange={(e) => setFormName(e.target.value)} style={{ width: '100%' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Role Governance</label>
                  <select className="input" value={formRole} onChange={(e) => setFormRole(e.target.value as Role)} style={{ width: '100%' }}>
                    <option value="admin">👑 Admin / Executive</option>
                    <option value="manager">👔 Sales Manager</option>
                    <option value="licensed_agent">⚖️ Licensed Agent</option>
                    <option value="scheduler">📞 Outbound Scheduler</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Title</label>
                  <input type="text" className="input" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Phone Number</label>
                  <input type="text" className="input" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} style={{ width: '100%' }} />
                </div>

                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>NPN Number</label>
                  <input type="text" className="input" value={formNpn} onChange={(e) => setFormNpn(e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Licensed States</label>
                <input type="text" className="input" value={formStates} onChange={(e) => setFormStates(e.target.value)} style={{ width: '100%' }} />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Reset Password (Optional)</label>
                <input type="text" className="input" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Leave blank to keep unchanged" style={{ width: '100%' }} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                <input type="checkbox" id="activeCheckbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                <label htmlFor="activeCheckbox" style={{ fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>Account Active (Can log in)</label>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                {isAdmin && editUser.id !== user?.id ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteUser(editUser.id, editUser.name)}
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      color: '#ef4444',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '8px',
                      padding: '0.6rem 1rem',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    🗑️ Remove Member
                  </button>
                ) : <div />}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditUser(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" style={{ fontWeight: 700 }}>Save Changes</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Admin Password Reset Modal */}
      <ChangePasswordModal
        isOpen={Boolean(passwordResetTarget)}
        onClose={() => setPasswordResetTarget(null)}
        targetUser={passwordResetTarget}
        onSuccess={() => fetchTeam()}
      />
    </div>
  );
};
