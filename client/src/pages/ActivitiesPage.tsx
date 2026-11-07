import React, { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  title?: string;
  phone?: string;
  npn?: string;
  states?: string[];
  avatar_color?: string;
  daily_call_goal?: number;
  google_meet_url?: string;
}

interface ActivityItem {
  id: string;
  type: string;
  subject: string;
  body?: string;
  related_type?: string;
  related_id?: string;
  user_id?: string;
  assigned_to?: string;
  status?: string;
  priority?: string;
  due_at?: string;
  end_at?: string;
  completed?: boolean;
  direction?: string;
  phone?: string;
  duration_sec?: number;
  disposition_id?: string;
  disposition?: string;
  provider?: string;
  ai_summary?: string;
  meta?: any;
  created_at: string;
  updated_at?: string;
  user_name?: string;
  user_email?: string;
  user_role?: string;
  user_title?: string;
  user_avatar_color?: string;
  assigned_to_name?: string;
  assigned_to_role?: string;
  assigned_to_title?: string;
  assigned_to_email?: string;
  assigned_to_npn?: string;
  // Explicitly resolved Scheduler attribution
  scheduler_name?: string;
  resolved_scheduler_id?: string;
  scheduler_role?: string;
  // Explicitly resolved Licensed Agent attribution
  licensed_agent_name?: string;
  resolved_agent_id?: string;
  licensed_agent_role?: string;
  licensed_agent_npn?: string;
  // Warm Transfer details
  is_warm_transfer?: boolean;
  transfer_target_agent?: string;
  scheduler_credit_status?: string;
  // Prospect details
  prospect_name?: string;
  prospect_phone?: string;
  prospect_state?: string;
  prospect_status?: string;
  prospect_address?: string;
}

interface AuditEvent {
  id: string;
  user_id: string;
  action: string;
  entity?: string;
  entity_id?: string;
  details?: any;
  created_at: string;
}

interface SummaryStats {
  total_calls?: number;
  calls_today?: number;
  calls_7d?: number;
  calls_30d?: number;
  total_talk_sec?: number;
  connects?: number;
  appointments_booked?: number;
  tasks_completed?: number;
  pending_tasks?: number;
  disposition_mix?: { label: string; count: number }[];
  audit_events?: AuditEvent[];
}

export const ActivitiesPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Multi-dimensional filters: Role, Specific Scheduler, Specific Agent, Activity Type, Date Range
  const [selectedUserId, setSelectedUserId] = useState<string>(searchParams.get('user_id') || '');
  const [selectedRole, setSelectedRole] = useState<string>(searchParams.get('role') || 'all');
  const [selectedSchedulerId, setSelectedSchedulerId] = useState<string>(searchParams.get('scheduler_id') || '');
  const [selectedAgentId, setSelectedAgentId] = useState<string>(searchParams.get('agent_id') || '');
  const [selectedType, setSelectedType] = useState<string>(searchParams.get('type') || 'all');
  const [selectedRange, setSelectedRange] = useState<string>(searchParams.get('range') || 'all');
  const [searchQuery, setSearchQuery] = useState<string>(searchParams.get('q') || '');
  const [viewMode, setViewMode] = useState<'timeline' | 'table'>('timeline');

  // Data states
  const [teamMembers, setTeamMembers] = useState<UserItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [userProfile, setUserProfile] = useState<UserItem | null>(null);
  const [summaryStats, setSummaryStats] = useState<SummaryStats | null>(null);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Sync state to URL params
  const updateFilterParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === 'all') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    setSearchParams(next);
  };

  // Load team roster
  useEffect(() => {
    api.get('/users')
      .then((res) => {
        const list = Array.isArray(res) ? res : res.users || [];
        setTeamMembers(list);
      })
      .catch((err) => console.error('Failed to load team users:', err));
  }, []);

  // Sync from searchParams when URL changes
  useEffect(() => {
    const urlUser = searchParams.get('user_id') || '';
    const urlRole = searchParams.get('role') || 'all';
    const urlScheduler = searchParams.get('scheduler_id') || '';
    const urlAgent = searchParams.get('agent_id') || '';
    const urlType = searchParams.get('type') || 'all';
    const urlRange = searchParams.get('range') || 'all';
    const urlQ = searchParams.get('q') || '';

    if (urlUser !== selectedUserId) setSelectedUserId(urlUser);
    if (urlRole !== selectedRole) setSelectedRole(urlRole);
    if (urlScheduler !== selectedSchedulerId) setSelectedSchedulerId(urlScheduler);
    if (urlAgent !== selectedAgentId) setSelectedAgentId(urlAgent);
    if (urlType !== selectedType) setSelectedType(urlType);
    if (urlRange !== selectedRange) setSelectedRange(urlRange);
    if (urlQ !== searchQuery) setSearchQuery(urlQ);
  }, [searchParams]);

  // Fetch activities timeline & history
  const fetchTimeline = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedUserId) params.set('user_id', selectedUserId);
    if (selectedSchedulerId) params.set('scheduler_id', selectedSchedulerId);
    if (selectedAgentId) params.set('agent_id', selectedAgentId);
    if (selectedRole && selectedRole !== 'all') params.set('role', selectedRole);
    if (selectedType && selectedType !== 'all') params.set('type', selectedType);
    if (selectedRange && selectedRange !== 'all') params.set('range', selectedRange);
    if (searchQuery) params.set('q', searchQuery);
    params.set('limit', '150');

    api.get(`/activities/timeline?${params.toString()}`)
      .then((res) => {
        setActivities(res.activities || []);
        setTotalCount(res.total || 0);
        setUserProfile(res.userProfile || null);
        setSummaryStats(res.summaryStats || null);
      })
      .catch((err) => {
        console.error('Failed to load activity timeline:', err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTimeline();
  }, [selectedUserId, selectedSchedulerId, selectedAgentId, selectedRole, selectedType, selectedRange, searchQuery]);

  // Filter change handlers
  const handleUserChange = (uId: string) => {
    setSelectedUserId(uId);
    // If a specific user is picked, clear the separate scheduler/agent filter
    setSelectedSchedulerId('');
    setSelectedAgentId('');
    updateFilterParams({ user_id: uId, scheduler_id: '', agent_id: '' });
  };

  const handleSchedulerChange = (sId: string) => {
    setSelectedSchedulerId(sId);
    setSelectedUserId(''); // scheduler filter takes precedence
    updateFilterParams({ scheduler_id: sId, user_id: '' });
  };

  const handleAgentChange = (aId: string) => {
    setSelectedAgentId(aId);
    setSelectedUserId(''); // agent filter takes precedence
    updateFilterParams({ agent_id: aId, user_id: '' });
  };

  const handleRoleChange = (r: string) => {
    setSelectedRole(r);
    updateFilterParams({ role: r });
  };

  const handleTypeChange = (t: string) => {
    setSelectedType(t);
    updateFilterParams({ type: t });
  };

  const handleRangeChange = (r: string) => {
    setSelectedRange(r);
    updateFilterParams({ range: r });
  };

  const handleResetFilters = () => {
    setSelectedUserId('');
    setSelectedRole('all');
    setSelectedSchedulerId('');
    setSelectedAgentId('');
    setSelectedType('all');
    setSelectedRange('all');
    setSearchQuery('');
    setSearchParams(new URLSearchParams());
  };

  // Format seconds to human talk time
  const formatDuration = (sec?: number) => {
    if (!sec && sec !== 0) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  // Group team members by role for convenient selection
  const groupedUsers = useMemo(() => {
    const schedulers = teamMembers.filter((u) => u.role === 'scheduler');
    const agents = teamMembers.filter((u) => u.role === 'licensed_agent');
    const leadership = teamMembers.filter((u) => u.role === 'admin' || u.role === 'manager');
    return { schedulers, agents, leadership };
  }, [teamMembers]);

  // Connect rate calculation
  const connectRate = useMemo(() => {
    if (!summaryStats?.total_calls || !summaryStats?.connects) return 0;
    return Math.round((summaryStats.connects / summaryStats.total_calls) * 100);
  }, [summaryStats]);

  // Active selected member object
  const activeMember = useMemo(() => {
    if (userProfile) return userProfile;
    const targetId = selectedUserId || selectedSchedulerId || selectedAgentId;
    if (!targetId) return null;
    return teamMembers.find((u) => u.id === targetId) || null;
  }, [userProfile, selectedUserId, selectedSchedulerId, selectedAgentId, teamMembers]);

  // Counts of activities by type for tab pills
  const typeCounts = useMemo(() => {
    const counts = { call: 0, transfer: 0, event: 0, task: 0, email: 0, chat: 0 };
    for (const a of activities) {
      if (a.is_warm_transfer) counts.transfer++;
      if (a.type === 'call') counts.call++;
      else if (a.type === 'event') counts.event++;
      else if (a.type === 'task') counts.task++;
      else if (a.type === 'email') counts.email++;
      else if (a.type === 'chat' || a.type === 'note') counts.chat++;
    }
    return counts;
  }, [activities]);

  const hasActiveFilters = Boolean(
    selectedUserId || selectedSchedulerId || selectedAgentId ||
    (selectedRole && selectedRole !== 'all') ||
    (selectedType && selectedType !== 'all') ||
    (selectedRange && selectedRange !== 'all') ||
    searchQuery
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.6rem' }}>🕒</span>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
              Activity Timeline & History
            </h1>
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Live chronological feed tracking <strong>who was the scheduler</strong>, <strong>which agent took the consultation</strong>, and <strong>what call outcome was logged</strong> · {totalCount} total records
          </div>
        </div>

        {/* View Mode Toggle & Calendar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: viewMode === 'timeline' ? '#3b82f6' : 'var(--bg-surface)',
                color: viewMode === 'timeline' ? '#fff' : 'var(--text-muted)',
              }}
              title="Switch to Chronological Visual Timeline View"
            >
              🕒 Visual Timeline
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: viewMode === 'table' ? '#3b82f6' : 'var(--bg-surface)',
                color: viewMode === 'table' ? '#fff' : 'var(--text-muted)',
              }}
              title="Switch to Data Table View (with dedicated Scheduler & Agent columns)"
            >
              📋 Data Table
            </button>
          </div>

          <Link
            to="/calendar"
            className="btn btn-secondary"
            style={{ textDecoration: 'none', fontWeight: 700, padding: '0.45rem 0.85rem', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <span>📅</span> <span>Master Calendar</span>
          </Link>
        </div>
      </div>

      {/* WHO IS DOING WHAT — Primary Filter Panel */}
      <div
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '14px',
          padding: '1rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 750, color: '#ffd88a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>🔍</span> <span>SELECT WHO IS DOING WHAT:</span>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleResetFilters}
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }}
            >
              ✕ Clear All Filters
            </button>
          )}
        </div>

        {/* Dropdowns Row: Filter by Scheduler, Filter by Licensed Agent, or All Members */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
          {/* 1. Dedicated Scheduler Selector */}
          <div style={{ backgroundColor: 'var(--bg-surface)', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 750, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.35rem' }}>
              <span>🎧</span> <span>Filter by Scheduler (Dialer / Booker):</span>
            </label>
            <select
              className="form-control"
              style={{
                width: '100%',
                padding: '0.4rem 0.65rem',
                fontSize: '0.84rem',
                fontWeight: 600,
                backgroundColor: 'var(--bg-input)',
                borderColor: selectedSchedulerId ? '#38bdf8' : 'var(--border-color)',
                color: selectedSchedulerId ? '#38bdf8' : 'var(--text-main)',
              }}
              value={selectedSchedulerId}
              onChange={(e) => handleSchedulerChange(e.target.value)}
            >
              <option value="">All Schedulers (Anyone who dialed/booked)</option>
              {groupedUsers.schedulers.map((u) => (
                <option key={u.id} value={u.id}>
                  🎧 {u.name} (Scheduler)
                </option>
              ))}
            </select>
          </div>

          {/* 2. Dedicated Licensed Agent Selector */}
          <div style={{ backgroundColor: 'var(--bg-surface)', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid rgba(212, 160, 76, 0.3)' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 750, color: '#ffd88a', display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.35rem' }}>
              <span>👔</span> <span>Filter by Licensed Agent (Consultant / Closer):</span>
            </label>
            <select
              className="form-control"
              style={{
                width: '100%',
                padding: '0.4rem 0.65rem',
                fontSize: '0.84rem',
                fontWeight: 600,
                backgroundColor: 'var(--bg-input)',
                borderColor: selectedAgentId ? 'var(--accent)' : 'var(--border-color)',
                color: selectedAgentId ? '#ffd88a' : 'var(--text-main)',
              }}
              value={selectedAgentId}
              onChange={(e) => handleAgentChange(e.target.value)}
            >
              <option value="">All Licensed Agents (Anyone assigned)</option>
              {groupedUsers.agents.map((u) => (
                <option key={u.id} value={u.id}>
                  👔 {u.name} {u.npn ? `(NPN: ${u.npn})` : ''}
                </option>
              ))}
              {groupedUsers.leadership.map((u) => (
                <option key={u.id} value={u.id}>
                  👑 {u.name} ({u.role.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          {/* 3. General Member / Self Selector */}
          <div style={{ backgroundColor: 'var(--bg-surface)', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 750, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.35rem' }}>
              <span>👤</span> <span>Filter by Individual Member:</span>
            </label>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <select
                className="form-control"
                style={{
                  flex: 1,
                  padding: '0.4rem 0.65rem',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  backgroundColor: 'var(--bg-input)',
                  borderColor: selectedUserId ? '#3b82f6' : 'var(--border-color)',
                }}
                value={selectedUserId}
                onChange={(e) => handleUserChange(e.target.value)}
              >
                <option value="">All Team Members (Agency-wide)</option>
                <optgroup label="── Schedulers ──">
                  {groupedUsers.schedulers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} (Scheduler)
                    </option>
                  ))}
                </optgroup>
                <optgroup label="── Licensed Agents ──">
                  {groupedUsers.agents.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} (Licensed Agent)
                    </option>
                  ))}
                </optgroup>
                <optgroup label="── Leadership & Management ──">
                  {groupedUsers.leadership.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role.toUpperCase()})
                    </option>
                  ))}
                </optgroup>
              </select>

              {user?.id && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleUserChange(user.id)}
                  style={{
                    padding: '0.3rem 0.6rem',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    backgroundColor: selectedUserId === user.id ? 'rgba(212, 160, 76, 0.25)' : 'transparent',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)',
                  }}
                  title="View my own activity history"
                >
                  My History
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Role Quick Filter Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.65rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Filter by Role:</span>
          {[
            { id: 'all', label: 'All Roles' },
            { id: 'scheduler', label: '🎧 Schedulers Only', count: groupedUsers.schedulers.length },
            { id: 'licensed_agent', label: '👔 Licensed Agents Only', count: groupedUsers.agents.length },
            { id: 'admin', label: '👑 Leadership Only', count: groupedUsers.leadership.length },
          ].map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => handleRoleChange(r.id)}
              style={{
                padding: '0.25rem 0.6rem',
                fontSize: '0.76rem',
                fontWeight: selectedRole === r.id ? 750 : 500,
                borderRadius: '6px',
                border: '1px solid',
                borderColor: selectedRole === r.id ? '#3b82f6' : 'rgba(255,255,255,0.12)',
                backgroundColor: selectedRole === r.id ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.04)',
                color: selectedRole === r.id ? '#93c5fd' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selected Member Performance & Profile Banner */}
      {activeMember && (
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '1.25rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {/* Member Identity Row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div
                style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '50%',
                  backgroundColor: activeMember.avatar_color || '#1e3578',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.3rem',
                  fontWeight: 800,
                  border: '2px solid rgba(255,255,255,0.2)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                }}
              >
                {activeMember.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>
                    {activeMember.name}
                  </h2>
                  <span
                    className={`badge ${
                      activeMember.role === 'admin'
                        ? 'badge-danger'
                        : activeMember.role === 'manager'
                        ? 'badge-gold'
                        : activeMember.role === 'licensed_agent'
                        ? 'badge-info'
                        : 'badge-warning'
                    }`}
                    style={{ fontSize: '0.75rem', fontWeight: 700 }}
                  >
                    {activeMember.role === 'scheduler' ? '🎧 ' : activeMember.role === 'licensed_agent' ? '👔 ' : '👑 '}
                    {activeMember.title || activeMember.role.replace('_', ' ')}
                  </span>
                  {activeMember.npn && (
                    <span style={{ fontSize: '0.74rem', color: '#93c5fd', background: 'rgba(59, 130, 246, 0.15)', padding: '0.15rem 0.5rem', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                      NPN: <strong>{activeMember.npn}</strong>
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
                  <span>✉️ {activeMember.email}</span>
                  {activeMember.phone && <span>📞 {activeMember.phone}</span>}
                  {activeMember.google_meet_url && (
                    <a
                      href={activeMember.google_meet_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      🎥 Google Meet
                    </a>
                  )}
                  {activeMember.states && (
                    <span>
                      Licensed States: {(Array.isArray(activeMember.states) ? activeMember.states : [activeMember.states]).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Daily Call Goal Meter */}
            {activeMember.daily_call_goal && activeMember.daily_call_goal > 0 && (
              <div style={{ textAlign: 'right', minWidth: '180px' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  Daily Call Goal Progress:
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <strong style={{ fontSize: '1.05rem', color: '#34d399' }}>
                    {summaryStats?.calls_today || 0}
                  </strong>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>/ {activeMember.daily_call_goal}</span>
                </div>
                <div style={{ width: '100%', height: '6px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '3px', marginTop: '0.35rem', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.round(((summaryStats?.calls_today || 0) / activeMember.daily_call_goal) * 100))}%`,
                      backgroundColor: '#10b981',
                      borderRadius: '3px',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Quick KPI Stat Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginTop: '0.25rem' }}>
            <div style={{ backgroundColor: 'var(--bg-surface)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>📞 Calls Today</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--accent)', marginTop: '0.2rem' }}>
                {summaryStats?.calls_today || 0}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                7d: {summaryStats?.calls_7d || 0} · 30d: {summaryStats?.calls_30d || 0}
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>⏱️ Total Talk Time</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#60a5fa', marginTop: '0.2rem' }}>
                {formatDuration(summaryStats?.total_talk_sec)}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                Avg: {summaryStats?.total_calls ? Math.round((summaryStats.total_talk_sec || 0) / summaryStats.total_calls) : 0}s / call
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>🤝 Connected Calls</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#34d399', marginTop: '0.2rem' }}>
                {summaryStats?.connects || 0}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                Connect Rate: {connectRate}%
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>📅 Appointments Set</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f59e0b', marginTop: '0.2rem' }}>
                {summaryStats?.appointments_booked || 0}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                Warm Transfers & Consults
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>☑️ Tasks Completed</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#a78bfa', marginTop: '0.2rem' }}>
                {summaryStats?.tasks_completed || 0}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                Pending: {summaryStats?.pending_tasks || 0}
              </div>
            </div>
          </div>

          {/* Disposition Mix Breakdown Pills */}
          {(summaryStats?.disposition_mix || []).length > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                CALL DISPOSITION MIX & OUTCOMES:
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {summaryStats?.disposition_mix?.map((dm, idx) => (
                  <span
                    key={idx}
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-main)',
                      fontWeight: 600,
                    }}
                  >
                    {dm.label}: <strong style={{ color: '#38bdf8' }}>{dm.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* WHAT ACTION Filter Toolbar (Calls, Appointments, Warm Transfers, Tasks, Date Horizon & Search) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          backgroundColor: 'var(--bg-card)',
          padding: '0.85rem 1.25rem',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
        }}
      >
        {/* Activity Type Tabs */}
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'All Activities', icon: '🌟' },
            { id: 'call', label: `Calls (${typeCounts.call})`, icon: '📞' },
            { id: 'transfer', label: `Warm Transfers (${typeCounts.transfer})`, icon: '⚡' },
            { id: 'event', label: `Appointments (${typeCounts.event})`, icon: '📅' },
            { id: 'task', label: `Tasks (${typeCounts.task})`, icon: '☑️' },
            { id: 'email', label: 'Emails', icon: '✉️' },
            { id: 'chat', label: 'Chats & Notes', icon: '💬' },
            { id: 'system', label: 'System', icon: '⚙️' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handleTypeChange(t.id)}
              style={{
                padding: '0.35rem 0.7rem',
                fontSize: '0.8rem',
                fontWeight: selectedType === t.id ? 750 : 500,
                borderRadius: '8px',
                border: '1px solid',
                borderColor: selectedType === t.id ? 'var(--accent)' : 'transparent',
                backgroundColor: selectedType === t.id ? 'rgba(212, 160, 76, 0.18)' : 'transparent',
                color: selectedType === t.id ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <span>{t.icon}</span> <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Date Horizon & Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* Date Range Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Range:</span>
            <select
              className="form-control"
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', width: 'auto' }}
              value={selectedRange}
              onChange={(e) => handleRangeChange(e.target.value)}
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Past 7 Days</option>
              <option value="30d">Past 30 Days</option>
            </select>
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative', width: '240px' }}>
            <input
              type="text"
              className="form-control"
              placeholder="Search scheduler, agent, prospect..."
              style={{ padding: '0.35rem 0.65rem 0.35rem 1.8rem', fontSize: '0.8rem' }}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                updateFilterParams({ q: e.target.value });
              }}
            />
            <span style={{ position: 'absolute', left: '0.55rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', opacity: 0.6 }}>
              🔍
            </span>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fetchTimeline}
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', fontWeight: 600 }}
            title="Refresh Timeline"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Main Activities Feed */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏳</div>
          Loading activities timeline and role attribution...
        </div>
      ) : activities.length === 0 ? (
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '3rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.6rem' }}>📭</div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>No Activities Found</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.4rem' }}>
            No activities matched your current selection.
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleResetFilters}
              style={{ marginTop: '1rem', fontSize: '0.8rem', fontWeight: 600 }}
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : viewMode === 'timeline' ? (
        /* Visual Chronological Timeline Feed */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative' }}>
          {/* Subtle vertical spine */}
          <div
            style={{
              position: 'absolute',
              left: '23px',
              top: '15px',
              bottom: '15px',
              width: '2px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              zIndex: 0,
            }}
          />

          {activities.map((a) => {
            const isCall = a.type === 'call';
            const isEvent = a.type === 'event';
            const isTask = a.type === 'task';
            const isEmail = a.type === 'email';
            const isChat = a.type === 'chat' || a.type === 'note';
            const isExpanded = expandedId === a.id;

            const icon = a.is_warm_transfer ? '⚡' : isCall ? '📞' : isEvent ? '📅' : isTask ? '☑️' : isEmail ? '✉️' : isChat ? '💬' : '⚙️';
            const badgeBg = a.is_warm_transfer ? '#10b981' : isCall ? '#3b82f6' : isEvent ? '#f59e0b' : isTask ? '#10b981' : isEmail ? '#38bdf8' : '#8b5cf6';

            return (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                {/* Timeline Node Badge */}
                <div
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--bg-surface)',
                    border: `2px solid ${badgeBg}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.2rem',
                    flexShrink: 0,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  }}
                >
                  {icon}
                </div>

                {/* Timeline Card */}
                <div
                  style={{
                    flex: 1,
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '14px',
                    padding: '1.1rem 1.35rem',
                    boxShadow: 'var(--shadow-sm)',
                    transition: 'border-color 0.2s',
                  }}
                >
                  {/* Card Header Row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span
                          className={`badge ${
                            a.is_warm_transfer
                              ? 'badge-success'
                              : isCall
                              ? 'badge-info'
                              : isEvent
                              ? 'badge-gold'
                              : isTask
                              ? 'badge-success'
                              : 'badge-secondary'
                          }`}
                          style={{ fontSize: '0.72rem', fontWeight: 750 }}
                        >
                          {a.is_warm_transfer ? '⚡ Warm Transfer' : isCall ? '📞 Call' : isEvent ? '📅 Appointment' : isTask ? '☑️ Task' : isEmail ? '✉️ Email' : 'Activity'}
                        </span>

                        <span style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--text-main)' }}>
                          {a.subject || 'Activity Record'}
                        </span>

                        {a.status && (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              padding: '0.1rem 0.45rem',
                              borderRadius: '4px',
                              backgroundColor: a.status.toLowerCase().includes('completed') || a.status.toLowerCase().includes('confirmed')
                                ? 'rgba(16, 185, 129, 0.15)'
                                : 'rgba(255, 255, 255, 0.08)',
                              color: a.status.toLowerCase().includes('completed') || a.status.toLowerCase().includes('confirmed')
                                ? '#34d399'
                                : 'var(--text-muted)',
                              fontWeight: 600,
                            }}
                          >
                            {a.status}
                          </span>
                        )}
                      </div>

                      {/* Prospect & Contact Link */}
                      {a.prospect_name && (
                        <div style={{ fontSize: '0.85rem', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Medicare Beneficiary:</span>
                          <Link
                            to={a.related_type === 'client' ? `/clients/${a.related_id}` : `/leads/${a.related_id}`}
                            style={{ color: '#38bdf8', fontWeight: 750, textDecoration: 'none' }}
                          >
                            👤 {a.prospect_name}
                          </Link>
                          {a.prospect_phone && (
                            <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                              📞 {a.prospect_phone}
                            </span>
                          )}
                          {a.prospect_state && (
                            <span className="badge badge-gold" style={{ fontSize: '0.68rem', padding: '0.05rem 0.35rem' }}>
                              {a.prospect_state}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Timestamp */}
                    <div style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      <div>{new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '0.1rem' }}>
                        {new Date(a.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>

                  {/* PROMINENT ATTRIBUTION BOX: WHO WAS THE SCHEDULER & WHO WAS THE AGENT */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      flexWrap: 'wrap',
                      marginTop: '0.75rem',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    {/* Scheduler Attribution Pill */}
                    {a.scheduler_name ? (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(56, 189, 248, 0.15)',
                          border: '1px solid rgba(56, 189, 248, 0.4)',
                          color: '#38bdf8',
                          fontSize: '0.8rem',
                          fontWeight: 750,
                        }}
                      >
                        <span>🎧 Scheduler:</span>
                        <strong style={{ color: '#fff' }}>{a.scheduler_name}</strong>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.25rem 0.6rem',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: '#94a3b8',
                          fontSize: '0.76rem',
                        }}
                      >
                        <span>🎧 Scheduler:</span>
                        <span>{a.user_role === 'scheduler' ? a.user_name : 'N/A (Agent Direct)'}</span>
                      </div>
                    )}

                    {/* Arrow for warm transfer or appointment handoff */}
                    {(a.is_warm_transfer || (a.scheduler_name && a.licensed_agent_name)) && (
                      <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>➔</span>
                    )}

                    {/* Licensed Agent Attribution Pill */}
                    {a.licensed_agent_name ? (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(212, 160, 76, 0.18)',
                          border: '1px solid rgba(212, 160, 76, 0.45)',
                          color: '#ffd88a',
                          fontSize: '0.8rem',
                          fontWeight: 750,
                        }}
                      >
                        <span>👔 Licensed Agent:</span>
                        <strong style={{ color: '#fff' }}>{a.licensed_agent_name}</strong>
                        {a.licensed_agent_npn && (
                          <span style={{ fontSize: '0.7rem', opacity: 0.85 }}>({a.licensed_agent_npn})</span>
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.25rem 0.6rem',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: '#94a3b8',
                          fontSize: '0.76rem',
                        }}
                      >
                        <span>👔 Consultation Agent:</span>
                        <span>Pending Assignment</span>
                      </div>
                    )}

                    {/* Warm Transfer Tag */}
                    {a.is_warm_transfer && (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(16, 185, 129, 0.18)',
                          border: '1px solid rgba(16, 185, 129, 0.4)',
                          color: '#6ee7b7',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                        }}
                      >
                        <span>⚡ 3-Way Warm Conference</span>
                        {a.scheduler_credit_status && (
                          <span style={{ fontSize: '0.7rem', backgroundColor: 'rgba(16, 185, 129, 0.3)', padding: '0.05rem 0.4rem', borderRadius: '4px' }}>
                            ✓ {a.scheduler_credit_status}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Call / Appointment Outcome Metric Badges */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.7rem' }}>
                    {a.disposition && (
                      <span
                        style={{
                          fontSize: '0.76rem',
                          fontWeight: 750,
                          padding: '0.18rem 0.6rem',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(212, 160, 76, 0.15)',
                          border: '1px solid rgba(212, 160, 76, 0.35)',
                          color: '#ffd88a',
                        }}
                      >
                        📋 Disposition: {a.disposition}
                      </span>
                    )}

                    {a.duration_sec !== undefined && a.duration_sec !== null && (
                      <span
                        style={{
                          fontSize: '0.76rem',
                          fontWeight: 750,
                          padding: '0.18rem 0.55rem',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(59, 130, 246, 0.12)',
                          color: '#93c5fd',
                          border: '1px solid rgba(59, 130, 246, 0.25)',
                        }}
                      >
                        ⏱️ Duration: {formatDuration(a.duration_sec)}
                      </span>
                    )}

                    {a.direction && (
                      <span style={{ fontSize: '0.74rem', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '0.15rem 0.45rem', borderRadius: '4px' }}>
                        {a.direction === 'inbound' ? '📥 Inbound Call' : '📤 Outbound Dial'}
                      </span>
                    )}

                    {(a.provider === 'bland_ai' || a.meta?.source === 'bland_ai') && (
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(139, 92, 246, 0.2)',
                          border: '1px solid #8b5cf6',
                          color: '#c084fc',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        <span>🎙️</span> <span>Sarah Outbound & Receptionist (480) 331-9455</span>
                      </span>
                    )}

                    {a.due_at && (
                      <span style={{ fontSize: '0.76rem', color: '#fcd34d', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '0.18rem 0.55rem', borderRadius: '6px' }}>
                        📅 Scheduled At: {new Date(a.due_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                  </div>

                  {/* Body / Transcript / Notes */}
                  {a.body && (
                    <div
                      style={{
                        marginTop: '0.7rem',
                        padding: '0.65rem 0.9rem',
                        backgroundColor: 'var(--bg-surface)',
                        borderRadius: '8px',
                        fontSize: '0.83rem',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.45,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {isExpanded ? a.body : a.body.slice(0, 160) + (a.body.length > 160 ? '...' : '')}
                      {a.body.length > 160 && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : a.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#38bdf8',
                            fontSize: '0.76rem',
                            fontWeight: 750,
                            cursor: 'pointer',
                            marginLeft: '0.4rem',
                          }}
                        >
                          {isExpanded ? 'Show Less ▲' : 'Read Full Notes ▼'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* AI Summary */}
                  {a.ai_summary && (
                    <div
                      style={{
                        marginTop: '0.5rem',
                        padding: '0.55rem 0.8rem',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        border: '1px solid rgba(139, 92, 246, 0.25)',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        color: '#c4b5fd',
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>✨ AI Call Summary:</div>
                      {a.ai_summary}
                    </div>
                  )}

                  {/* Call Audio Recording */}
                  {a.meta?.recording_url && (
                    <div
                      style={{
                        marginTop: '0.65rem',
                        padding: '0.65rem 0.85rem',
                        backgroundColor: 'rgba(139, 92, 246, 0.08)',
                        border: '1px solid rgba(139, 92, 246, 0.3)',
                        borderRadius: '8px',
                      }}
                    >
                      <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#c084fc', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span>🎧</span> <span>Call Audio Recording</span>
                      </div>
                      <audio controls src={a.meta.recording_url} style={{ width: '100%', height: '36px' }} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Data Table View with Dedicated Scheduler & Agent Columns */
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th style={{ color: '#38bdf8' }}>🎧 Scheduler</th>
                <th style={{ color: '#ffd88a' }}>👔 Licensed Agent</th>
                <th>Prospect / Subject</th>
                <th>Disposition / Outcome</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id}>
                  {/* Time */}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 600 }}>{new Date(a.created_at).toLocaleDateString()}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>

                  {/* Type */}
                  <td>
                    <span
                      className={`badge ${
                        a.is_warm_transfer
                          ? 'badge-success'
                          : a.type === 'call'
                          ? 'badge-info'
                          : a.type === 'event'
                          ? 'badge-gold'
                          : a.type === 'task'
                          ? 'badge-success'
                          : 'badge-secondary'
                      }`}
                      style={{ fontSize: '0.72rem' }}
                    >
                      {a.is_warm_transfer ? '⚡ Transfer' : a.type === 'call' ? '📞 Call' : a.type === 'event' ? '📅 Appt' : a.type === 'task' ? '☑️ Task' : '💬 ' + a.type}
                    </span>
                  </td>

                  {/* Scheduler Column */}
                  <td>
                    {a.scheduler_name ? (
                      <div>
                        <strong style={{ color: '#38bdf8', fontSize: '0.85rem' }}>
                          🎧 {a.scheduler_name}
                        </strong>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Outbound Dialer</div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>
                    )}
                  </td>

                  {/* Licensed Agent Column */}
                  <td>
                    {a.licensed_agent_name ? (
                      <div>
                        <strong style={{ color: '#ffd88a', fontSize: '0.85rem' }}>
                          👔 {a.licensed_agent_name}
                        </strong>
                        {a.licensed_agent_npn && (
                          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>NPN: {a.licensed_agent_npn}</div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Unassigned</span>
                    )}
                  </td>

                  {/* Prospect / Subject */}
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{a.subject}</div>
                    {a.prospect_name ? (
                      <div style={{ fontSize: '0.78rem', marginTop: '0.15rem' }}>
                        <Link
                          to={a.related_type === 'client' ? `/clients/${a.related_id}` : `/leads/${a.related_id}`}
                          style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 600 }}
                        >
                          👤 {a.prospect_name}
                        </Link>
                        {a.prospect_phone && <span style={{ color: '#94a3b8', marginLeft: '0.35rem' }}>({a.prospect_phone})</span>}
                        {a.prospect_state && (
                          <span className="badge badge-gold" style={{ fontSize: '0.62rem', padding: '0.05rem 0.3rem', marginLeft: '0.35rem' }}>
                            {a.prospect_state}
                          </span>
                        )}
                      </div>
                    ) : a.body ? (
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                        {a.body.slice(0, 50)}...
                      </div>
                    ) : null}
                  </td>

                  {/* Disposition */}
                  <td>
                    {a.disposition ? (
                      <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>{a.disposition}</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>N/A</span>
                    )}
                  </td>

                  {/* Duration */}
                  <td>{formatDuration(a.duration_sec)}</td>

                  {/* Status */}
                  <td>
                    <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>{a.status || 'Completed'}</span>
                  </td>

                  {/* Actions */}
                  <td>
                    {a.related_id && (
                      <Link
                        to={a.related_type === 'client' ? `/clients/${a.related_id}` : `/leads/${a.related_id}`}
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', textDecoration: 'none', fontWeight: 600 }}
                        title="View Prospect Record"
                      >
                        View ➔
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Security, Compliance & Audit History */}
      {summaryStats?.audit_events && summaryStats.audit_events.length > 0 && (
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '1.25rem 1.5rem',
            marginTop: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.2rem' }}>🛡️</span>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                Security, Compliance & Audit History
              </h3>
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Recent system audit records
            </span>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {summaryStats.audit_events.map((ev) => (
                  <tr key={ev.id}>
                    <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                      {new Date(ev.created_at).toLocaleString()}
                    </td>
                    <td>
                      <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>
                        {ev.action}
                      </span>
                    </td>
                    <td>
                      <code style={{ fontSize: '0.75rem' }}>{ev.entity || 'system'}:{ev.entity_id ? ev.entity_id.slice(0, 10) : ''}</code>
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {typeof ev.details === 'object' ? JSON.stringify(ev.details) : String(ev.details || '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
