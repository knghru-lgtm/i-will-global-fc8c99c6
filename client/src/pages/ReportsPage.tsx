import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export const ReportsPage: React.FC = () => {
  const { isScheduler } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const fetchStats = (userId?: string) => {
    setLoading(true);
    const query = userId ? `?days=30&user_id=${userId}` : '?days=30';
    api.get(`/calls/stats${query}`)
      .then((res) => {
        setStats(res);
        if (res.is_admin && users.length === 0) {
          api.get('/users').then((uRes) => {
            const list = Array.isArray(uRes) ? uRes : uRes.users || [];
            setUsers(list);
          }).catch(console.error);
        }
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStats(selectedUserId);
  }, [selectedUserId]);

  const isAdmin = stats?.is_admin;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>
            {isAdmin ? '📊 Agency Analytics & Performance Reports' : '📊 My Performance & Activity Reports'}
          </h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {isAdmin
              ? 'Agency Administration: 30-Day Calling Volume, Connect Rates, Disposition Mix, and Agent Breakdown'
              : 'Your private 30-day calling volume, connect rates, and personal disposition mix'}
          </div>
        </div>

        {/* Admin Team Member Filter Dropdown */}
        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Filter Team Member:</label>
            <select
              className="form-control"
              style={{ width: 'auto', minWidth: '220px', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">All Team Members (Agency-wide)</option>
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role.replace('_', ' ')})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading analytics reports...</div>
      ) : (
        <>
          {/* Stats KPI */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-header"><span>Total Calls (30d)</span><span>📞</span></div>
              <div className="stat-value">{stats?.totals?.calls || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-header"><span>Successful Connects</span><span>🤝</span></div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{stats?.totals?.connects || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-header"><span>Appointments Booked</span><span>📅</span></div>
              <div className="stat-value" style={{ color: 'var(--accent)' }}>{stats?.totals?.appointments || 0}</div>
            </div>
            {!isScheduler && (
              <div className="stat-card">
                <div className="stat-header"><span>Applications Submitted</span><span>🏆</span></div>
                <div className="stat-value" style={{ color: 'var(--info)' }}>{stats?.totals?.applications || 0}</div>
              </div>
            )}
          </div>

          {/* Admin-only Team Breakdown Table */}
          {isAdmin && (stats?.byAgent || []).length > 0 && !selectedUserId && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1rem' }}>
                👥 Team Member Performance Breakdown (30d)
              </h3>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Agent / Scheduler</th>
                      <th>Role</th>
                      <th>Total Calls</th>
                      <th>Connects</th>
                      <th>Appointments</th>
                      <th>Applications</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stats?.byAgent || []).map((ag: any) => (
                      <tr key={ag.id}>
                        <td style={{ fontWeight: 600 }}>{ag.name}</td>
                        <td style={{ textTransform: 'capitalize', color: 'var(--text-muted)' }}>{ag.role.replace('_', ' ')}</td>
                        <td><strong>{ag.calls}</strong></td>
                        <td style={{ color: 'var(--success)' }}>{ag.connects}</td>
                        <td><span className="badge badge-gold">{ag.appointments}</span></td>
                        <td><span className="badge badge-info">{ag.applications}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Disposition Mix Table */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1rem' }}>
              {isAdmin ? 'Call Disposition Breakdown (30d)' : 'My Call Disposition Breakdown (30d)'}
            </h3>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Disposition Label</th>
                    <th>Total Volume</th>
                    <th>Share %</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.mix || []).length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                        No disposition data recorded for this time range.
                      </td>
                    </tr>
                  ) : (
                    (stats?.mix || []).map((m: any) => (
                      <tr key={m.id}>
                        <td style={{ fontWeight: 600 }}>{m.label}</td>
                        <td><strong>{m.n}</strong></td>
                        <td>{Math.round((m.n / (stats?.totals?.calls || 1)) * 100)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
