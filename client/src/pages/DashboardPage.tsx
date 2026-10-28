import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Link } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const { isScheduler } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard')
      .then((res) => setData(res))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
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
