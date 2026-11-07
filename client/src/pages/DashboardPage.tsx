import React, { useState, useEffect } from 'react';
import { api, openGoogleVoiceWindow } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Link } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const { isScheduler } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sarahConfig, setSarahDialerConfig] = useState<any>(null);
  const [activatingSarah, setActivatingSarah] = useState(false);
  const [sarahQuickPhone, setSarahQuickPhone] = useState('');
  const [sarahBannerMsg, setSarahBannerMsg] = useState('');

  useEffect(() => {
    api.get('/dashboard')
      .then((res) => setData(res))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
    const loadSarah = () => api.get('/sarah/config').then((c) => setSarahDialerConfig(c)).catch(() => { });
    loadSarah();
    window.addEventListener('iwg-sarah-status-changed', loadSarah);
    return () => window.removeEventListener('iwg-sarah-status-changed', loadSarah);
  }, []);

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>Loading dashboard...</div>;
  if (!data) return <div style={{ color: 'var(--danger)', padding: '2rem' }}>Failed to load dashboard.</div>;

  const { kpis, leadFunnel, leaderboard, upcoming, period } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Enrollment Period Banner */}
      {period?.current ? (
        <div
          style={{
            background: 'linear-gradient(135deg, #051039, #16245c)',
            border: '1px solid var(--accent)',
            borderRadius: '16px',
            padding: '1.25rem 1.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div>
            <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', fontWeight: 700 }}>
              Current Medicare Enrollment Window
            </div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#fff', marginTop: '0.2rem' }}>
              🗓️ {period.current.label}
            </h2>
            <div style={{ fontSize: '0.88rem', color: '#cbd5e1', marginTop: '0.2rem' }}>
              Ends {period.current.end} · Only <strong style={{ color: 'var(--accent)' }}>{period.current.daysLeft} days remaining</strong>
            </div>
          </div>
          <Link to="/leads?f_dob__gte=1961-01-01" className="btn btn-primary">
            🎯 View T65 & AEP Prospects
          </Link>
        </div>
      ) : period?.next ? (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '1rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <span style={{ fontWeight: 700, color: 'var(--accent)' }}>Upcoming Window: </span>
            <span>{period.next.label} starts {period.next.start} (in {period.next.daysUntil} days)</span>
          </div>
        </div>
      ) : null}

      {/* Sarah Agent AI Activation & Warm Transfer Appointment-Only Control Bar */}
      <div
        style={{
          background: sarahConfig?.is_on_warm_transfer
            ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(88, 28, 135, 0.35))'
            : 'linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(15, 23, 42, 0.95))',
          border: sarahConfig?.is_on_warm_transfer ? '2px solid #f59e0b' : '1.5px solid #8b5cf6',
          borderRadius: '16px',
          padding: '1.25rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
          boxShadow: '0 8px 28px rgba(139, 92, 246, 0.22)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{ fontSize: '2rem' }}>{sarahConfig?.is_on_warm_transfer ? '🔥🤖' : '🤖'}</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  Sarah Voice AI Outbound Dialer & Receptionist (480) 331-9455
                </h3>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '2px 9px',
                    borderRadius: '999px',
                    background: sarahConfig?.is_on_warm_transfer ? 'rgba(245, 158, 11, 0.25)' : 'rgba(16, 185, 129, 0.2)',
                    border: `1px solid ${sarahConfig?.is_on_warm_transfer ? '#f59e0b' : '#10b981'}`,
                    color: sarahConfig?.is_on_warm_transfer ? '#fcd34d' : '#34d399',
                  }}
                >
                  {sarahConfig?.is_on_warm_transfer
                    ? '🔥 ON WARM TRANSFER: BOOKING TELEPHONE / IN-PERSON / VIDEO APPTS ONLY & CONTINUING CALLS'
                    : sarahConfig?.is_campaign_active
                      ? '● ACTIVE & MAKING CALLS'
                      : '● READY TO CALL'}
                </span>
              </div>
              <div style={{ fontSize: '0.83rem', color: '#cbd5e1', marginTop: '0.25rem' }}>
                {sarahConfig?.is_on_warm_transfer
                  ? 'Sarah knows you are on a warm transfer call — she will ONLY select Telephone (30m), In-Person (60m), or Video (30m) appointments and continue dialing.'
                  : 'Activate Sarah Voice AI on (480) 331-9455 to begin making calls, warm-transferring to +1 (602) 456-9681, or booking Telephone, In-Person, or Video appointments.'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={sarahQuickPhone}
              onChange={(e) => setSarahQuickPhone(e.target.value)}
              placeholder="4803345557"
              style={{
                width: '145px',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                background: 'rgba(0,0,0,0.35)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.86rem',
              }}
              title="Phone number for immediate Sarah Outbound call"
            />
            <button
              type="button"
              disabled={activatingSarah}
              onClick={async () => {
                setActivatingSarah(true);
                setSarahBannerMsg('');
                const manualPhone = sarahQuickPhone.trim();
                try {
                  const res = await api.post('/sarah/activate', {
                    phone: manualPhone || undefined,
                    on_warm_transfer: Boolean(sarahConfig?.is_on_warm_transfer),
                    continue_queue: true,
                  });
                  const firstDispatched = res.dispatched?.[0];
                  const dialPhone = manualPhone || firstDispatched?.phone || '';
                  const dialName = firstDispatched?.prospect_name || 'Medicare Beneficiary';
                  if (dialPhone) openGoogleVoiceWindow(dialPhone);
                  window.dispatchEvent(
                    new CustomEvent('iwg-open-sarah-voice', {
                      detail: {
                        mode: 'outbound',
                        lead_id: firstDispatched?.lead_id,
                        prospect_name: dialName,
                        phone: dialPhone,
                        state: 'AZ',
                        on_warm_transfer: Boolean(sarahConfig?.is_on_warm_transfer),
                      },
                    })
                  );
                  setSarahBannerMsg(res.message || 'Sarah Outbound Caller + Google Voice (480) 331-9455 activated!');
                  window.dispatchEvent(new CustomEvent('iwg-sarah-status-changed'));
                } catch (err: any) {
                  setSarahBannerMsg('⚠️ ' + (err.message || 'Failed to activate Sarah Outbound Caller'));
                } finally {
                  setActivatingSarah(false);
                }
              }}
              style={{
                padding: '0.6rem 1.1rem',
                borderRadius: '8px',
                border: 'none',
                background: 'linear-gradient(135deg, #7c3aed, #9333ea)',
                color: '#fff',
                fontWeight: 800,
                fontSize: '0.86rem',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(139, 92, 246, 0.45)',
              }}
            >
              {activatingSarah ? 'Dialing...' : `🚀 Activate Sarah AI & Call ${sarahQuickPhone || 'Queue'}`}
            </button>
            <button
              type="button"
              onClick={async () => {
                const nextWarm = !sarahConfig?.is_on_warm_transfer;
                try {
                  const res = await api.post('/sarah/warm-transfer-mode', { on_warm_transfer: nextWarm });
                  setSarahDialerConfig((prev: any) => ({ ...(prev || {}), is_on_warm_transfer: nextWarm }));
                  setSarahBannerMsg(res.message);
                  window.dispatchEvent(new CustomEvent('iwg-sarah-status-changed'));
                } catch (err: any) {
                  setSarahBannerMsg('⚠️ ' + err.message);
                }
              }}
              style={{
                padding: '0.6rem 0.95rem',
                borderRadius: '8px',
                border: sarahConfig?.is_on_warm_transfer ? '1.5px solid #10b981' : '1.5px solid #f59e0b',
                background: sarahConfig?.is_on_warm_transfer ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.18)',
                color: sarahConfig?.is_on_warm_transfer ? '#6ee7b7' : '#fcd34d',
                fontWeight: 800,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              {sarahConfig?.is_on_warm_transfer ? '✅ End Warm Transfer Mode' : '🔥 I Am On Warm Transfer (Appt-Only Mode)'}
            </button>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('iwg-open-sarah-voice', { detail: { mode: 'outbound' } }))}
              style={{
                padding: '0.6rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.06)',
                color: '#e2e8f0',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              🎙️ Open Receptionist & Caller
            </button>
          </div>
        </div>
        {sarahBannerMsg && (
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6ee7b7', background: 'rgba(0,0,0,0.25)', padding: '0.45rem 0.75rem', borderRadius: '8px' }}>
            {sarahBannerMsg}
          </div>
        )}
      </div>

      {/* KPI Cards Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-header">
            <span>{data.is_admin ? 'New Leads (30d)' : 'My Assigned & Created Leads (30d)'}</span>
            <span>🎯</span>
          </div>
          <div className="stat-value">{kpis.new_leads_30d || 0}</div>
          <div className="stat-sub">
            {data.is_admin ? `Turning 65 in 90d: ${kpis.t65_90d || 0}` : `My T65 (90d): ${kpis.t65_90d || 0}`}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span>Calls Today</span>
            <span>📞</span>
          </div>
          <div className="stat-value">{kpis.calls_today || 0}</div>
          <div className="stat-sub">7d Connects: {kpis.connects_7d || 0}</div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span>Upcoming Appointments</span>
            <span>📅</span>
          </div>
          <div className="stat-value">{kpis.appts_next_7d || 0}</div>
          <div className="stat-sub">Next 7 Days</div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span>SOAs Signed (30d)</span>
            <span>✍️</span>
          </div>
          <div className="stat-value">{kpis.soas_signed_30d || 0}</div>
          <div className="stat-sub">Scope of Appointment</div>
        </div>

        {!isScheduler && (
          <>
            <div className="stat-card">
              <div className="stat-header">
                <span>Submitted Applications</span>
                <span>🏆</span>
              </div>
              <div className="stat-value">{kpis.apps_30d || 0}</div>
              <div className="stat-sub">Active Policies: {kpis.active_policies || 0}</div>
            </div>

            <div className="stat-card">
              <div className="stat-header">
                <span>Commissions MTD</span>
                <span>💰</span>
              </div>
              <div className="stat-value">${Math.round(kpis.commission_mtd || 0).toLocaleString()}</div>
              <div className="stat-sub">Expected this month</div>
            </div>
          </>
        )}
      </div>

      {/* Two-Column Middle Section: Funnel & Upcoming Agenda */}
      <div className="responsive-grid-2col">
        {/* Lead Funnel */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{data.is_admin ? 'Agency Lead Stage Pipeline' : 'My Assigned & Created Pipeline'}</span>
            <Link to="/leads" style={{ fontSize: '0.8rem', color: 'var(--accent)', textDecoration: 'none' }}>
              {data.is_admin ? 'View All Leads →' : 'View My Leads →'}
            </Link>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {leadFunnel.map((f: any) => (
              <div key={f.status} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ width: '130px', fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {f.status}
                </span>
                <div style={{ flex: 1, height: '10px', backgroundColor: 'var(--bg-surface)', borderRadius: '5px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, (f.n / Math.max(...leadFunnel.map((x: any) => x.n), 1)) * 100)}%`,
                      backgroundColor: f.status === 'SOA Signed' ? 'var(--accent)' : f.status === 'Appointment Set' ? 'var(--info)' : 'var(--primary-light)',
                      borderRadius: '5px',
                    }}
                  />
                </div>
                <span style={{ fontWeight: 700, fontSize: '0.85rem', width: '35px', textAlign: 'right' }}>{f.n}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Tasks & Appointments */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Upcoming Agenda</span>
            <Link to="/activities" style={{ fontSize: '0.8rem', color: 'var(--accent)', textDecoration: 'none' }}>All Activities →</Link>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '280px', overflowY: 'auto' }}>
            {upcoming.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>No tasks or appointments scheduled for today.</div>
            ) : (
              upcoming.map((a: any) => (
                <div
                  key={a.id}
                  style={{
                    padding: '0.65rem 0.85rem',
                    backgroundColor: 'var(--bg-surface)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span>{a.type === 'event' ? '📅' : '☑️'}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{a.subject}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {new Date(a.due_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  <span className={`badge ${a.type === 'event' ? 'badge-gold' : 'badge-info'}`} style={{ fontSize: '0.7rem' }}>
                    {a.type}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Performance Summary / Leaderboard */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
            {data.is_admin ? '🏆 Agency Performance Leaderboard (7d)' : '📊 My Performance Summary (7d)'}
          </h3>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {data.is_admin
              ? 'Agency Administration View: Real-time 7-day activity across all schedulers and licensed agents.'
              : 'Your private 7-day activity metrics (Calls, Connects, Appointments, and Conversions).'}
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>{data.is_admin ? 'Agent / Scheduler' : 'Team Member'}</th>
                <th>Role</th>
                <th>Calls (7d)</th>
                <th>Appointments Booked</th>
                {!isScheduler && <th>Applications Submitted</th>}
              </tr>
            </thead>
            <tbody>
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={isScheduler ? 4 : 5} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                    No calls logged in the last 7 days yet. Start calling leads to record your metrics!
                  </td>
                </tr>
              ) : (
                leaderboard.map((row: any) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 600 }}>{row.name} {!data.is_admin && <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 500 }}>(You)</span>}</td>
                    <td style={{ textTransform: 'capitalize', color: 'var(--text-muted)' }}>{row.role.replace('_', ' ')}</td>
                    <td><strong>{row.calls}</strong></td>
                    <td><span className="badge badge-gold">{row.appointments} appts</span></td>
                    {!isScheduler && <td><span className="badge badge-success">{row.applications} apps</span></td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
