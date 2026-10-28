import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { RunningLateModal } from '../components/RunningLateModal';
import { BookAppointmentModal } from '../components/BookAppointmentModal';
import { useAuth } from '../lib/auth';

export const CalendarPage: React.FC = () => {
  const { user, activeRole } = useAuth();
  const canAccessRunningLate = activeRole === 'admin' || activeRole === 'licensed_agent' || user?.role === 'admin' || user?.role === 'licensed_agent' || user?.email?.toLowerCase() === 'king@iwillglobal.com' || user?.email?.toLowerCase() === 'aneesha@iwillglobal.com';

  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [webcalUrl, setWebcalUrl] = useState<string>('');
  const [icsUrl, setIcsUrl] = useState<string>('');
  const [gcalSubscribeUrl, setGcalSubscribeUrl] = useState<string>('');

  // Schedule Appointment & Put on Calendar modal state (for schedulers & agents)
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleSlotData, setScheduleSlotData] = useState<{
    date?: string;
    time?: string;
    agentId?: string;
    apptType?: 'telephone' | 'video' | 'in_person';
  } | null>(null);

  const handleOpenScheduleModal = (slot?: any) => {
    if (slot && slot.start_at) {
      const d = new Date(slot.start_at);
      const dateStr = d.toISOString().slice(0, 10);
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      setScheduleSlotData({
        date: dateStr,
        time: `${hours}:${mins}`,
        agentId: slotAgentId,
        apptType: slotApptType,
      });
    } else {
      setScheduleSlotData({
        date: slotDate,
        agentId: slotAgentId,
        apptType: slotApptType,
      });
    }
    setIsScheduleModalOpen(true);
  };

  // Running Late auto-text state
  const [isRunningLateOpen, setIsRunningLateOpen] = useState(false);
  const [selectedApptForLate, setSelectedApptForLate] = useState<string | undefined>(undefined);
  const [lateStatus, setLateStatus] = useState<any>(null);

  // Available Time Slots Explorer state
  const getTodayDate = () => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  };

  const [slotDate, setSlotDate] = useState<string>(getTodayDate());
  const [slotAgentId, setSlotAgentId] = useState<string>('u_principal');
  const [slotApptType, setSlotApptType] = useState<'telephone' | 'video' | 'in_person'>('telephone');
  const [slotsResult, setSlotsResult] = useState<any>(null);
  const [loadingSlots, setLoadingSlots] = useState<boolean>(false);
  const [availableAgentsList, setAvailableAgentsList] = useState<any[]>([]);

  const fetchCalendar = async () => {
    setLoading(true);
    try {
      const res = await api.get('/appointments/calendar');
      setAppointments(res.appointments || []);
      setWebcalUrl(res.webcal_url || '');
      setIcsUrl(res.ics_url || '');
      setGcalSubscribeUrl(res.google_calendar_subscribe_url || '');

      // Check if current appointment has run over time (Admin & Agents only)
      if (canAccessRunningLate) {
        api.get('/appointments/running-late-status')
          .then((st) => setLateStatus(st))
          .catch(() => {});
      }
    } catch (err) {
      console.error('Failed to load agency appointments:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableSlots = async () => {
    setLoadingSlots(true);
    try {
      const res = await api.get(
        `/appointments/available-slots?agent_id=${slotAgentId}&date=${slotDate}&appointment_type=${slotApptType}`
      );
      setSlotsResult(res);
    } catch (err) {
      console.error('Failed to load available slots:', err);
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchCalendar();
    // Load all licensed agents for the slot selector
    api.get('/appointments/available-agents?state=AZ')
      .then((agents) => setAvailableAgentsList(agents))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchAvailableSlots();
  }, [slotAgentId, slotDate, slotApptType]);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await api.post('/appointments/sync-master-calendar', {});
      await fetchCalendar();
      fetchAvailableSlots();
      alert(`✅ Successfully connected & synced ${res.synced_count} appointments to info@iwillglobal.com master calendar!`);
    } catch (err: any) {
      alert(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleCopyLink = (url: string, label: string) => {
    navigator.clipboard.writeText(url);
    alert(`📋 ${label} copied to clipboard! Paste this into Google Calendar (Other calendars -> From URL) to subscribe in real-time.`);
  };

  const agentsList = Array.from(
    new Set(appointments.map((a) => a.agent_name).filter(Boolean))
  );

  const filteredAppointments = appointments.filter((a) => {
    if (selectedAgent === 'all') return true;
    return a.agent_name === selectedAgent;
  });

  const confirmedCount = appointments.filter((a) => a.status?.includes('Confirm') || a.meta?.customer_confirmed).length;
  const pendingCount = appointments.length - confirmedCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1200px' }}>
      {/* Top Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(200,150,62,0.15), rgba(5,16,57,0.8))',
          border: '1px solid rgba(200,150,62,0.3)',
          borderRadius: '16px',
          padding: '1.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.75rem' }}>📅</span>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, color: '#c8963e' }}>
              Agency Master Calendar — info@iwillglobal.com
            </h1>
          </div>
          <div style={{ fontSize: '0.9rem', color: '#cbd5e1', marginTop: '0.4rem' }}>
            All set appointments across schedulers and licensed agents automatically connect & display on <strong>info@iwillglobal.com</strong>.
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <span className="badge badge-success" style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}>
              🟢 Connected to info@iwillglobal.com
            </span>
            <span className="badge badge-info" style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}>
              📊 Total Scheduled: {appointments.length}
            </span>
            <span className="badge badge-gold" style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}>
              ✅ Confirmed: {confirmedCount}
            </span>
            {pendingCount > 0 && (
              <span className="badge badge-warning" style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}>
                ⏳ Awaiting SMS YES: {pendingCount}
              </span>
            )}
          </div>
        </div>

        {/* Global Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '220px' }}>
          <button
            className="btn btn-primary"
            onClick={() => handleOpenScheduleModal()}
            style={{
              fontWeight: 800,
              padding: '0.75rem 1rem',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              backgroundColor: '#10b981',
              borderColor: '#10b981',
              color: '#fff',
              boxShadow: '0 2px 10px rgba(16, 185, 129, 0.35)',
            }}
          >
            <span>📅</span>
            <span>+ Schedule Appointment</span>
          </button>

          <button
            className="btn btn-primary"
            onClick={handleSyncAll}
            disabled={syncing}
            style={{ fontWeight: 700, padding: '0.75rem 1rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
          >
            <span>{syncing ? '🔄 Syncing...' : '⚡ Sync All Appointments to info@'}</span>
          </button>

          <a
            href={gcalSubscribeUrl || `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(icsUrl)}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ textDecoration: 'none', textAlign: 'center', padding: '0.6rem 1rem', fontSize: '0.85rem' }}
          >
            🌐 Open in Google Calendar
          </a>

          <button
            className="btn btn-secondary"
            onClick={() => handleCopyLink(webcalUrl || icsUrl, 'Google Calendar Subscription URL')}
            style={{ padding: '0.5rem 1rem', fontSize: '0.82rem' }}
          >
            📋 Copy Google Calendar Feed Link (.ics)
          </button>

          {canAccessRunningLate && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSelectedApptForLate(undefined);
                setIsRunningLateOpen(true);
              }}
              style={{
                fontWeight: 750,
                padding: '0.65rem 1rem',
                fontSize: '0.85rem',
                borderColor: '#f59e0b',
                color: '#fbbf24',
                background: 'rgba(245, 158, 11, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
              }}
              title="Send automated text to next appointment if current meeting is taking too long (Admin & Licensed Agents Only)"
            >
              <span>🏃</span>
              <span>Running Late? Auto-Text Next Appt</span>
            </button>
          )}
        </div>
      </div>

      {/* Proactive Running Late Alert Banner if Current Consultation Exceeded Time (Admin & Agents only) */}
      {canAccessRunningLate && lateStatus?.has_running_late && (
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.18), rgba(15, 23, 42, 0.9))',
            border: '1.5px solid #ef4444',
            borderRadius: '14px',
            padding: '1.1rem 1.35rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            boxShadow: '0 4px 20px rgba(239, 68, 68, 0.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#ef4444', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>
              ⚠️
            </div>
            <div>
              <div style={{ fontWeight: 800, color: '#fca5a5', fontSize: '1rem' }}>
                Current Appointment Taking Too Long {lateStatus.minutes_overdue > 0 ? `(+${lateStatus.minutes_overdue}m Overdue)` : '(In Progress)'}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#e2e8f0', marginTop: '0.2rem' }}>
                Meeting with <strong>{lateStatus.current_appointment?.customer_first_name} {lateStatus.current_appointment?.customer_last_name}</strong> is exceeding scheduled time.{' '}
                {lateStatus.next_appointment ? (
                  <span>Next scheduled appointment is <strong>{lateStatus.next_appointment?.customer_first_name} {lateStatus.next_appointment?.customer_last_name}</strong> at <strong>{new Date(lateStatus.next_appointment?.due_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} MST</strong>.</span>
                ) : (
                  <span>No subsequent appointments found for today.</span>
                )}
              </div>
            </div>
          </div>

          {lateStatus.next_appointment && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setSelectedApptForLate(lateStatus.next_appointment?.id);
                setIsRunningLateOpen(true);
              }}
              style={{
                fontWeight: 800,
                padding: '0.65rem 1.25rem',
                fontSize: '0.88rem',
                background: '#ef4444',
                borderColor: '#ef4444',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span>📲</span>
              <span>Send +{lateStatus.suggested_delay_minutes || 15}m Delay Text Now</span>
            </button>
          )}
        </div>
      )}

      {/* Available Time Slots Explorer & Buffer Guard Card */}
      <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(200,150,62,0.35)', borderRadius: '12px', padding: '1.4rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.3rem' }}>⏱️</span>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--accent)' }}>
                Available Time Slots Explorer & Conflict Guard
              </h3>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Standard durations: <strong>30 mins</strong> for Phone & Video, <strong>60 mins</strong> for In-Person. Enforces <strong>30-minute buffer</strong> between appointments with zero double-booking.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge badge-success" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
              🟢 {slotsResult?.available_slots_count || 0} Slots Open
            </span>
            <span className="badge badge-warning" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
              ⏱️ 30m Buffer Active
            </span>
            <span className="badge badge-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
              🔒 {slotsResult?.booked_slots_count || 0} Booked/Buffered
            </span>
          </div>
        </div>

        {/* Filters: Agent, Date, Appointment Type */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
              Select Licensed Agent:
            </label>
            <select
              className="input"
              value={slotAgentId}
              onChange={(e) => setSlotAgentId(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', fontSize: '0.85rem' }}
            >
              <option value="u_principal">👑 King Amen Ra — Principal & Broker of Record (NPN: 16094432)</option>
              {availableAgentsList
                .filter((a) => a.id !== 'u_principal' && a.email?.toLowerCase() !== 'king@iwillglobal.com')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.title || 'Agent'}) — NPN: {a.npn}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
              Date (Arizona MST):
            </label>
            <input
              type="date"
              className="input"
              value={slotDate}
              onChange={(e) => setSlotDate(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', fontSize: '0.85rem' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
              Appointment Type & Duration:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.35rem' }}>
              <button
                type="button"
                className={`btn ${slotApptType === 'telephone' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSlotApptType('telephone')}
                style={{ padding: '0.45rem 0.2rem', fontSize: '0.75rem', textAlign: 'center' }}
              >
                📞 Phone (30m)
              </button>
              <button
                type="button"
                className={`btn ${slotApptType === 'video' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSlotApptType('video')}
                style={{ padding: '0.45rem 0.2rem', fontSize: '0.75rem', textAlign: 'center' }}
              >
                🎥 Video (30m)
              </button>
              <button
                type="button"
                className={`btn ${slotApptType === 'in_person' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSlotApptType('in_person')}
                style={{ padding: '0.45rem 0.2rem', fontSize: '0.75rem', textAlign: 'center' }}
              >
                🏠 In-Person (60m)
              </button>
            </div>
          </div>
        </div>

        {/* Live Slot Timeline Grid */}
        <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-main)' }}>
              Schedule Grid for {slotsResult?.agent?.name || 'Agent'} ({slotDate})
            </span>
            {loadingSlots && <span style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>🔄 Refreshing slots...</span>}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '0.5rem',
              maxHeight: '260px',
              overflowY: 'auto',
            }}
          >
            {slotsResult?.slots?.map((slot: any, idx: number) => {
              const isAvailable = slot.available;
              const isBuffer = slot.reason?.includes('Buffer');
              const isBooked = slot.reason === 'Booked';

              return (
                <div
                  key={idx}
                  onClick={() => isAvailable && handleOpenScheduleModal(slot)}
                  title={isAvailable ? '🟢 Click to book this slot immediately and put on calendar' : (slot.reason || slot.time_range)}
                  style={{
                    padding: '0.55rem 0.45rem',
                    borderRadius: '8px',
                    textAlign: 'center',
                    cursor: isAvailable ? 'pointer' : 'default',
                    transition: 'all 0.15s ease',
                    border: isAvailable
                      ? '1.5px solid rgba(16,185,129,0.7)'
                      : isBooked
                      ? '1px solid rgba(239,68,68,0.4)'
                      : '1px solid rgba(245,158,11,0.3)',
                    backgroundColor: isAvailable
                      ? 'rgba(16,185,129,0.12)'
                      : isBooked
                      ? 'rgba(239,68,68,0.08)'
                      : 'rgba(245,158,11,0.06)',
                    color: isAvailable
                      ? '#10b981'
                      : isBooked
                      ? '#ef4444'
                      : '#f59e0b',
                    boxShadow: isAvailable ? '0 1px 4px rgba(16,185,129,0.2)' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (isAvailable) {
                      e.currentTarget.style.backgroundColor = 'rgba(16,185,129,0.25)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (isAvailable) {
                      e.currentTarget.style.backgroundColor = 'rgba(16,185,129,0.12)';
                      e.currentTarget.style.transform = 'none';
                    }
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{slot.time_label}</div>
                  <div style={{ fontSize: '0.7rem', marginTop: '0.15rem' }}>
                    {isAvailable ? (
                      <span style={{ color: '#10b981', fontWeight: 700 }}>🟢 Click to Book ({slotsResult?.duration_minutes}m)</span>
                    ) : isBooked ? (
                      <span style={{ color: '#ef4444', fontWeight: 600 }}>
                        🔒 Booked {slot.conflicting_appointment?.customer_name ? `(${slot.conflicting_appointment.customer_name.split(' ')[0]})` : ''}
                      </span>
                    ) : isBuffer ? (
                      <span style={{ color: '#f59e0b', fontWeight: 600 }}>⏱️ 30m Buffer</span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>Past</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Filter by Licensed Agent:</label>
          <select
            className="input"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            style={{ padding: '0.45rem 0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}
          >
            <option value="all">All Licensed Agents ({appointments.length})</option>
            {agentsList.map((agent) => (
              <option key={agent} value={agent}>
                {agent} ({appointments.filter((a) => a.agent_name === agent).length})
              </option>
            ))}
          </select>
        </div>

        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Showing <strong>{filteredAppointments.length}</strong> appointments
        </div>
      </div>

      {/* Appointments List Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date & Time</th>
              <th>Customer / Prospect</th>
              <th>Type & Details</th>
              <th>Assigned Licensed Agent</th>
              <th>Booked By</th>
              <th>Calendar Status</th>
              <th>Google Calendar Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  Loading scheduled appointments for info@iwillglobal.com...
                </td>
              </tr>
            ) : filteredAppointments.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No appointments found for the selected filter.
                </td>
              </tr>
            ) : (
              filteredAppointments.map((appt) => {
                const meta = appt.meta || {};
                const due = new Date(appt.due_at || appt.created_at);
                const isConfirmed = appt.status?.includes('Confirm') || meta.customer_confirmed;

                return (
                  <tr key={appt.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: '#c8963e' }}>
                        {due.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} MST
                      </div>
                    </td>

                    <td>
                      <div style={{ fontWeight: 600 }}>{appt.customer_name || 'Medicare Beneficiary'}</div>
                      {appt.customer_phone && (
                        <div style={{ fontSize: '0.75rem', color: '#60a5fa' }}>📞 {appt.customer_phone}</div>
                      )}
                      {appt.customer_email && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>✉️ {appt.customer_email}</div>
                      )}
                    </td>

                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{appt.subject}</div>
                      {meta.google_meet_url && (
                        <div style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                          <a href={meta.google_meet_url} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'underline' }}>
                            🎥 Join Meet
                          </a>
                        </div>
                      )}
                      {meta.location && !meta.google_meet_url && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>📍 {meta.location}</div>
                      )}
                    </td>

                    <td>
                      <div style={{ fontWeight: 600 }}>{appt.agent_name || 'Assigned Agent'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {appt.agent_title || 'Licensed Specialist'}
                      </div>
                      {appt.agent_email && (
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{appt.agent_email}</div>
                      )}
                    </td>

                    <td>
                      <div style={{ fontSize: '0.82rem' }}>{appt.booked_by_name || 'Scheduler'}</div>
                    </td>

                    <td>
                      <span className={`badge ${isConfirmed ? 'badge-success' : 'badge-warning'}`}>
                        {isConfirmed ? '✅ Confirmed' : '⏳ Pending Confirmation'}
                      </span>
                      {meta.running_late_alert && (
                        <div style={{ marginTop: '0.25rem' }}>
                          <span
                            className="badge badge-warning"
                            style={{ fontSize: '0.72rem', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid #f59e0b' }}
                            title={meta.last_running_late_sms}
                          >
                            ⏰ Delay Sent (+{meta.minutes_delayed || 15}m)
                          </span>
                        </div>
                      )}
                      <div style={{ fontSize: '0.68rem', color: '#10b981', marginTop: '0.2rem' }}>
                        🔗 Synced to info@
                      </div>
                    </td>

                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {appt.google_calendar_url && (
                          <a
                            href={appt.google_calendar_url}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary"
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem', textDecoration: 'none', display: 'inline-block' }}
                          >
                            ➕ Add to Google Cal
                          </a>
                        )}
                        {canAccessRunningLate && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => {
                              setSelectedApptForLate(appt.id);
                              setIsRunningLateOpen(true);
                            }}
                            style={{ padding: '0.35rem 0.55rem', fontSize: '0.74rem', borderColor: '#f59e0b', color: '#fbbf24' }}
                            title="Send automated running late text to this attendee (Admin & Agents Only)"
                          >
                            🏃 Late Text
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Running Late Auto-Text Modal - Admin & Agents only */}
      {canAccessRunningLate && (
        <RunningLateModal
          isOpen={isRunningLateOpen}
          onClose={() => {
            setIsRunningLateOpen(false);
            setSelectedApptForLate(undefined);
          }}
          nextAppointmentId={selectedApptForLate}
          onAlertSent={() => {
            fetchCalendar();
          }}
        />
      )}

      {/* Schedule Appointment & Put on Calendar Modal */}
      {isScheduleModalOpen && (
        <BookAppointmentModal
          isOpen={isScheduleModalOpen}
          onClose={() => {
            setIsScheduleModalOpen(false);
            setScheduleSlotData(null);
          }}
          initialDate={scheduleSlotData?.date}
          initialTime={scheduleSlotData?.time}
          initialAgentId={scheduleSlotData?.agentId}
          initialApptType={scheduleSlotData?.apptType}
          onScheduled={() => {
            fetchCalendar();
            fetchAvailableSlots();
            setIsScheduleModalOpen(false);
            setScheduleSlotData(null);
          }}
        />
      )}
    </div>
  );
};
