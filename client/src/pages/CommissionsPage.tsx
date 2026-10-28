import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export const CommissionsPage: React.FC = () => {
  const { user, isScheduler } = useAuth();
  const [commissions, setCommissions] = useState<any[]>([]);
  const [schedulerCredits, setSchedulerCredits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = user?.role === 'admin' || user?.email === 'king@iwillglobal.com' || user?.email === 'aneesha@iwillglobal.com' || user?.id === 'u_principal';

  useEffect(() => {
    Promise.all([
      api.get('/records/commissions?sort=period:desc'),
      api.get('/appointments/scheduler-credits'),
    ])
      .then(([commRes, credRes]) => {
        setCommissions(commRes.rows || []);
        setSchedulerCredits(credRes || []);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  // Filter commissions: admins see all, schedulers and agents strictly see their own
  const userCommissions = isAdmin
    ? commissions
    : commissions.filter((c) => c.agent_id === user?.id);

  const totalExpected = userCommissions.reduce((sum, c) => sum + Number(c.expected_amount || 0), 0);
  const totalPaid = userCommissions.reduce((sum, c) => sum + Number(c.paid_amount || 0), 0);

  const totalSchedulerEarnings = userCommissions
    .filter((c) => c.type?.startsWith('Appointment Set') || c.type === 'Policy Sold Bonus')
    .reduce((sum, c) => sum + Number(c.paid_amount || c.expected_amount || 0), 0);

  // For milestone progress, find the current user's stats (or top if admin)
  const myCredit = schedulerCredits.find((c) => c.user_id === user?.id) || schedulerCredits[0] || {
    user_name: user?.name || 'My Progress',
    confirmed_and_sold: 0,
    tier_50_progress: 0,
    tier_100_progress: 0,
  };

  const displayedCredits = isAdmin
    ? schedulerCredits
    : schedulerCredits.filter((sc) => sc.user_id === user?.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>
            {isScheduler
              ? '🏅 My Scheduler Earnings & Lead Credit Tracker'
              : isAdmin
                ? 'Commission & Bonus Tracking (Agency Admin)'
                : 'My Commission Tracking'}
          </h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {isScheduler
              ? 'Earn $25 credit per confirmed appointment (YES reply) + $25 bonus per sold policy!'
              : isAdmin
                ? 'Licensed Agent Commissions & Scheduler Appointment Setting Payouts (Agency-wide)'
                : 'Your private earned commissions and milestone bonuses'}
          </div>
        </div>
      </div>

      {/* Scheduler Bonus Rule Banner */}
      <div style={{ background: 'linear-gradient(135deg, rgba(200,150,62,0.15), rgba(5,16,57,0.4))', border: '1px solid var(--accent)', borderRadius: '12px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--accent)' }}>
            💡 Scheduler Commission Structure:
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginTop: '0.2rem' }}>
            • <strong>$25.00 Credit</strong> awarded when customer replies <strong>YES or Y</strong> to confirm appointment.
            <br />
            • <strong>+$25.00 Additional Bonus</strong> awarded when assigned licensed agent completes policy sale! (<strong>$50 total per lead</strong>)
          </div>
        </div>
        <div style={{ background: 'var(--accent)', color: '#051039', padding: '0.6rem 1rem', borderRadius: '8px', fontWeight: 800, fontSize: '1.1rem' }}>
          ${totalSchedulerEarnings} Earned
        </div>
      </div>

      {/* Summary Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-header"><span>Appt Set Credits ($25)</span><span>📅</span></div>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>
            ${userCommissions.filter((c) => c.type?.startsWith('Appointment Set')).reduce((sum, c) => sum + Number(c.paid_amount || 25), 0)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-header"><span>Policy Sold Bonuses ($25)</span><span>🏆</span></div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>
            ${userCommissions.filter((c) => c.type === 'Policy Sold Bonus').reduce((sum, c) => sum + Number(c.paid_amount || 25), 0)}
          </div>
        </div>
        {!isScheduler && (
          <>
            <div className="stat-card">
              <div className="stat-header"><span>{isAdmin ? 'Total Agent Commissions' : 'My Total Commissions'}</span><span>💰</span></div>
              <div className="stat-value">${Math.round(totalExpected).toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-header"><span>{isAdmin ? 'Total Paid' : 'My Total Paid'}</span><span>✅</span></div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>${Math.round(totalPaid).toLocaleString()}</div>
            </div>
          </>
        )}
      </div>

      {/* Milestone Tier Bonuses Banner ($1,000 for 50 Sold & $3,000 for 100 Sold) */}
      <div className="responsive-grid-2col">
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--accent)' }}>🎯 Tier 1 Milestone Bonus ($1,000)</span>
            <span className="badge badge-gold">50 Confirmed & Sold</span>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Reach <strong>50 Confirmed & Sold Leads</strong> to earn an instant <strong>$1,000.00 Performance Bonus!</strong>
          </div>
          <div style={{ marginTop: '0.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
              <span>{myCredit.user_name} Progress:</span>
              <strong>{myCredit.confirmed_and_sold || 0} / 50 Sold ({myCredit.tier_50_progress || 0}%)</strong>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.1)', height: '10px', borderRadius: '5px', overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(90deg, var(--accent), #10b981)', height: '100%', width: `${myCredit.tier_50_progress || 0}%` }} />
            </div>
          </div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#10b981' }}>🏆 Tier 2 Mega Bonus ($3,000)</span>
            <span className="badge badge-success">100 Confirmed & Sold</span>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Reach <strong>100 Confirmed & Sold Leads</strong> to unlock the <strong>$3,000.00 Mega Bonus!</strong> ($4,000 total bonuses)
          </div>
          <div style={{ marginTop: '0.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
              <span>{myCredit.user_name} Progress:</span>
              <strong>{myCredit.confirmed_and_sold || 0} / 100 Sold ({myCredit.tier_100_progress || 0}%)</strong>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.1)', height: '10px', borderRadius: '5px', overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(90deg, #10b981, #6366f1)', height: '100%', width: `${myCredit.tier_100_progress || 0}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Scheduler Credits Summary */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.25rem' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.85rem' }}>
          {isAdmin ? '🏅 Scheduler Lead Credit & Bonus Leaderboard (Agency-wide)' : '🏅 My Lead Credits & Performance Earnings'}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
          {displayedCredits.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.5rem' }}>
              No scheduler credit records found.
            </div>
          ) : (
            displayedCredits.map((sc) => (
              <div key={sc.user_id} style={{ background: 'var(--bg-surface)', padding: '0.85rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                    {sc.user_name} {!isAdmin && <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 500 }}>(You)</span>}
                  </span>
                  {sc.tier_100_achieved ? (
                    <span className="badge badge-success">👑 $3K Mega</span>
                  ) : sc.tier_50_achieved ? (
                    <span className="badge badge-gold">🏆 $1K Bonus</span>
                  ) : null}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent)', marginTop: '0.3rem', fontWeight: 600 }}>
                  {sc.confirmed_credits} Confirmed · <strong>{sc.confirmed_and_sold || 0} Sold</strong>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Appts Booked: {sc.total_booked} · Total Payout: <strong style={{ color: 'var(--success)' }}>${sc.total_earnings || (sc.confirmed_credits * 25)}</strong>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Ledger Table */}
      <div className="table-container">
        <h3 style={{ padding: '1rem 1.25rem 0.5rem', fontSize: '1.05rem', fontWeight: 700 }}>
          {isAdmin ? 'Commission & Bonus Ledger (Agency-wide)' : 'My Commission & Bonus Ledger'}
        </h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Recipient</th>
              <th>Commission Type</th>
              <th>Earned Amount</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>Loading ledger...</td></tr>
            ) : userCommissions.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No commissions recorded yet. Book appointments and get customer YES replies!</td></tr>
            ) : userCommissions.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.period || '2026-10'}</strong></td>
                <td>{isAdmin ? (c.agent_id ? 'Scheduler / Agent' : 'User') : (user?.name || 'You')}</td>
                <td>
                  <span className={`badge ${c.type === 'Appointment Set' ? 'badge-gold' : c.type === 'Policy Sold Bonus' ? 'badge-success' : 'badge-gold'}`}>
                    {c.type === 'Appointment Set' ? '📅 $25 Appt Set Credit' : c.type === 'Policy Sold Bonus' ? '🏆 $25 Policy Sold Bonus' : c.type}
                  </span>
                </td>
                <td style={{ fontWeight: 700, color: 'var(--success)' }}>${c.expected_amount || c.paid_amount || 25}</td>
                <td><span className="badge badge-success">{c.status || 'Paid'}</span></td>
                <td>{c.paid_date || new Date().toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
