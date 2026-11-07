import React, { useState, useEffect } from 'react';
import { api, formatPhone } from '../lib/api';
import { useAuth } from '../lib/auth';

interface BookAppointmentModalProps {
  isOpen?: boolean;
  contact?: {
    id: string;
    name: string;
    phone: string;
    email?: string;
    type: 'lead' | 'client';
    state?: string;
    address?: string;
  };
  initialDate?: string;
  initialTime?: string;
  initialAgentId?: string;
  initialApptType?: 'telephone' | 'video' | 'in_person';
  onClose: () => void;
  onScheduled?: (result: any) => void;
}

export const BookAppointmentModal: React.FC<BookAppointmentModalProps> = ({
  isOpen = true,
  contact,
  initialDate,
  initialTime,
  initialAgentId,
  initialApptType,
  onClose,
  onScheduled,
}) => {
  const { user } = useAuth();
  const [selectedContact, setSelectedContact] = useState<any>(contact || null);
  const [leadSearch, setLeadSearch] = useState<string>('');
  const [leadOptions, setLeadOptions] = useState<any[]>([]);
  const [loadingLeadOptions, setLoadingLeadOptions] = useState<boolean>(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState<boolean>(false);
  const [quickLead, setQuickLead] = useState<any>({ first_name: '', last_name: '', phone: '', email: '', state: 'AZ' });

  const customerState = (selectedContact?.state || 'AZ').toUpperCase();

  // Tomorrow 10:00 AM default
  const getDefaultDateTime = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    // Format YYYY-MM-THH:mm
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  const getDefaultDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  const [appointmentType, setAppointmentType] = useState<'telephone' | 'video' | 'in_person'>(initialApptType || 'telephone');
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || getDefaultDate());
  const [appointmentAt, setAppointmentAt] = useState<string>(initialTime || (initialDate ? `${initialDate}T10:00` : getDefaultDateTime()));
  const [durationMinutes, setDurationMinutes] = useState<number>(initialApptType === 'in_person' ? 60 : 30);
  const [agentId, setAgentId] = useState<string>(initialAgentId || '');
  const [location, setLocation] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>(contact?.phone || '');
  const [customerEmail, setCustomerEmail] = useState<string>(contact?.email || '');
  const [sendSms, setSendSms] = useState<boolean>(true);
  const [sendEmail, setSendEmail] = useState<boolean>(true);

  // Sync phone and email when contact prop or selectedContact updates
  useEffect(() => {
    if (selectedContact) {
      if (selectedContact.phone) setCustomerPhone(selectedContact.phone);
      if (selectedContact.email) setCustomerEmail(selectedContact.email);
    }
  }, [selectedContact]);

  // Load leads if no preselected contact
  useEffect(() => {
    if (!contact) {
      setLoadingLeadOptions(true);
      let url = `/records/leads?limit=30&sort=created_at:desc`;
      if (leadSearch.trim()) {
        url += `&q=${encodeURIComponent(leadSearch.trim())}`;
      }
      api.get(url)
        .then((res) => setLeadOptions(res.rows || []))
        .catch(() => {})
        .finally(() => setLoadingLeadOptions(false));
    }
  }, [contact, leadSearch]);

  const handleQuickAddLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickLead.first_name || !quickLead.phone) {
      alert('First name and phone number are required.');
      return;
    }
    try {
      const res = await api.post('/records/leads', {
        first_name: quickLead.first_name,
        last_name: quickLead.last_name || 'Prospect',
        phone: quickLead.phone,
        email: quickLead.email || undefined,
        state: quickLead.state || 'AZ',
        source: 'Calendar Phone Scheduling',
        tcpa_consent: true,
      });
      setSelectedContact({
        id: res.id,
        name: `${res.first_name} ${res.last_name}`,
        phone: res.phone,
        email: res.email,
        type: 'lead',
        state: res.state || 'AZ',
        address: res.address,
      });
      if (res.phone) setCustomerPhone(res.phone);
      if (res.email) setCustomerEmail(res.email);
      setIsQuickAddOpen(false);
    } catch (err: any) {
      alert(`Failed to add prospect: ${err.message}`);
    }
  };

  const [availableAgents, setAvailableAgents] = useState<any[]>([]);
  const [loadingAgents, setLoadingAgents] = useState<boolean>(false);
  const [slotsData, setSlotsData] = useState<any>(null);
  const [loadingSlots, setLoadingSlots] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<any>(null);

  // Load qualified available agents whenever date/time changes
  useEffect(() => {
    setLoadingAgents(true);
    const isoDate = new Date(appointmentAt).toISOString();
    api.get(`/appointments/available-agents?state=${customerState}&at=${encodeURIComponent(isoDate)}&duration=${durationMinutes}`)
      .then((agents) => setAvailableAgents(agents))
      .catch(() => {})
      .finally(() => setLoadingAgents(false));
  }, [customerState, appointmentAt, durationMinutes]);

  // Load available time slots for the chosen agent and date (enforcing 30m buffer & type durations)
  useEffect(() => {
    setLoadingSlots(true);
    const targetAgent = agentId || (availableAgents.find((a) => a.is_principal || a.id === 'u_principal')?.id || 'u_principal');
    api.get(`/appointments/available-slots?agent_id=${targetAgent}&date=${selectedDate}&appointment_type=${appointmentType}`)
      .then((res) => setSlotsData(res))
      .catch((err) => console.error('Failed to load slots:', err))
      .finally(() => setLoadingSlots(false));
  }, [selectedDate, agentId, appointmentType, availableAgents]);

  // Update duration when appointment type changes
  const handleTypeChange = (type: 'telephone' | 'video' | 'in_person') => {
    setAppointmentType(type);
    if (type === 'in_person') {
      setDurationMinutes(60); // 60 mins for in person
    } else {
      setDurationMinutes(30); // 30 mins for phone and video
    }
  };

  const handleSelectSlot = (slot: any) => {
    if (!slot.available) return;
    const d = new Date(slot.start_at);
    const tzOffset = d.getTimezoneOffset() * 60000;
    const localIso = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    setAppointmentAt(localIso);
  };

  const isSlotSelected = (slot: any) => {
    const slotTime = new Date(slot.start_at).getTime();
    const currentTime = new Date(appointmentAt).getTime();
    return Math.abs(slotTime - currentTime) < 60000;
  };

  // Update default location when appointment type changes
  useEffect(() => {
    if (appointmentType === 'video') {
      const targetAgent = availableAgents.find((a) => a.id === agentId) || availableAgents[0];
      const meetUrl = targetAgent?.google_meet_url || (user?.email ? `https://meet.google.com/iwg-${user.email.split('@')[0]}` : 'https://meet.google.com/iwg-agent');
      setLocation(`Google Meet: ${meetUrl}`);
    } else if (appointmentType === 'in_person') {
      setLocation(selectedContact?.address ? `${selectedContact.address}, ${customerState}` : '4800 N Scottsdale Rd, Scottsdale, AZ 85251 (I Will Global Office)');
    } else {
      setLocation(`Phone Call (${formatPhone(selectedContact?.phone || '')})`);
    }
  }, [appointmentType, selectedContact, customerState, agentId, availableAgents, user]);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact) {
      setError('Please select or add a prospect for this appointment.');
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const res = await api.post('/appointments/schedule', {
        related_type: selectedContact.type || 'lead',
        related_id: selectedContact.id,
        appointment_type: appointmentType,
        appointment_at: new Date(appointmentAt).toISOString(),
        duration_minutes: durationMinutes,
        agent_id: agentId || null,
        location,
        notes,
        customer_phone: customerPhone || undefined,
        customer_email: customerEmail || undefined,
        send_confirmation_sms: sendSms,
        send_confirmation_email: sendEmail,
      });

      setResult(res);
      if (onScheduled) onScheduled(res);
    } catch (err: any) {
      setError(err.message || 'Failed to schedule appointment.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedAgentObj = availableAgents.find((a) => a.id === agentId);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: '650px', width: '90%' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', color: 'var(--accent)', margin: 0, fontWeight: 700 }}>
              📅 Schedule Appointment & Put on Calendar
            </h2>
            {selectedContact ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span>
                  Booking for: <strong style={{ color: 'var(--accent)' }}>{selectedContact.name}</strong> ({formatPhone(selectedContact.phone)} · {selectedContact.address ? `${selectedContact.address}, ` : ''}{customerState})
                </span>
                {!contact && (
                  <button
                    type="button"
                    onClick={() => setSelectedContact(null)}
                    style={{ background: 'none', border: 'none', color: '#60a5fa', textDecoration: 'underline', fontSize: '0.78rem', cursor: 'pointer', padding: 0 }}
                  >
                    (Change Prospect)
                  </button>
                )}
              </div>
            ) : (
              <div style={{ fontSize: '0.85rem', color: '#ffd88a', marginTop: '0.2rem' }}>
                Select or quick-add a prospect below to book on agency calendar
              </div>
            )}
          </div>
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: '0.3rem 0.6rem' }}>✕</button>
        </div>

        {result ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid #10b981', padding: '1rem', borderRadius: '10px' }}>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#10b981', marginBottom: '0.5rem' }}>
                ✅ Appointment Successfully Scheduled!
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                Assigned Licensed Agent: <strong>{result.assigned_agent.name}</strong> (NPN: {result.assigned_agent.npn})
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Status: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{result.credit_status}</span>
              </div>
            </div>

            <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '8px' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent)', marginBottom: '0.5rem' }}>
                ⚡ Actions Executed Automatically by Receptionist:
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', lineHeight: '1.6' }}>
                {result.actions_taken?.map((act: string, idx: number) => (
                  <li key={idx}>{act}</li>
                ))}
              </ul>
            </div>

            <div style={{ background: 'rgba(200,150,62,0.1)', border: '1px solid var(--accent)', padding: '0.9rem', borderRadius: '8px' }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent)', marginBottom: '0.3rem' }}>
                🏅 Scheduler Lead Credit Requirement:
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                When {selectedContact?.name} replies <strong>YES</strong> or <strong>Y</strong> to the text message, the system will automatically convert status to <strong>Confirmed</strong> and award <strong>{user?.name}</strong> full lead credit!
              </div>
            </div>

            <button className="btn btn-primary" onClick={onClose} style={{ padding: '0.75rem' }}>
              Done & Return
            </button>
          </div>
        ) : (
          <form onSubmit={handleSchedule} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {error && (
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: '8px', fontSize: '0.85rem' }}>
                ⚠️ {error}
              </div>
            )}

            {/* Step 1: Select or Add Prospect if not preset */}
            {!selectedContact && (
              <div style={{ background: '#0e1d44', border: '1.5px solid var(--accent)', borderRadius: '10px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--accent)', margin: 0 }}>
                    👤 Step 1: Select Prospect / Lead *
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsQuickAddOpen(!isQuickAddOpen)}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem', fontWeight: 700 }}
                  >
                    {isQuickAddOpen ? '✕ Search Existing' : '+ Quick Add New Prospect'}
                  </button>
                </div>

                {isQuickAddOpen ? (
                  <div style={{ background: 'var(--bg-surface)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="First Name *"
                        value={quickLead.first_name}
                        onChange={(e) => setQuickLead({ ...quickLead, first_name: e.target.value })}
                        style={{ padding: '0.45rem', borderRadius: '6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.82rem' }}
                      />
                      <input
                        type="text"
                        placeholder="Last Name"
                        value={quickLead.last_name}
                        onChange={(e) => setQuickLead({ ...quickLead, last_name: e.target.value })}
                        style={{ padding: '0.45rem', borderRadius: '6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.82rem' }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 0.6fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="Phone Number * (e.g. 4805550123)"
                        value={quickLead.phone}
                        onChange={(e) => setQuickLead({ ...quickLead, phone: e.target.value })}
                        style={{ padding: '0.45rem', borderRadius: '6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.82rem' }}
                      />
                      <input
                        type="email"
                        placeholder="Email Address"
                        value={quickLead.email}
                        onChange={(e) => setQuickLead({ ...quickLead, email: e.target.value })}
                        style={{ padding: '0.45rem', borderRadius: '6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.82rem' }}
                      />
                      <input
                        type="text"
                        placeholder="State (AZ)"
                        value={quickLead.state}
                        onChange={(e) => setQuickLead({ ...quickLead, state: e.target.value })}
                        style={{ padding: '0.45rem', borderRadius: '6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.82rem' }}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleQuickAddLead}
                      style={{ width: '100%', padding: '0.45rem', fontSize: '0.82rem', fontWeight: 700 }}
                    >
                      Save & Select Prospect
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="Search prospect by name or phone number..."
                      value={leadSearch}
                      onChange={(e) => setLeadSearch(e.target.value)}
                      style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.85rem' }}
                    />
                    <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {loadingLeadOptions ? (
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8', padding: '0.5rem' }}>Loading prospects...</div>
                      ) : leadOptions.length === 0 ? (
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8', padding: '0.5rem' }}>No matching prospects found.</div>
                      ) : (
                        leadOptions.map((ld) => (
                          <div
                            key={ld.id}
                            onClick={() => setSelectedContact({ id: ld.id, name: `${ld.first_name} ${ld.last_name}`, phone: ld.phone, email: ld.email, type: 'lead', state: ld.state, address: ld.address })}
                            style={{
                              padding: '0.45rem 0.65rem',
                              borderRadius: '6px',
                              background: 'rgba(255,255,255,0.04)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              cursor: 'pointer',
                              fontSize: '0.82rem',
                              border: '1px solid transparent',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                          >
                            <div>
                              <span style={{ fontWeight: 700, color: '#fff' }}>{ld.first_name} {ld.last_name}</span>
                              <span style={{ color: '#93c5fd', marginLeft: '0.5rem' }}>{formatPhone(ld.phone)}</span>
                            </div>
                            <span style={{ fontSize: '0.74rem', color: '#ffd88a', background: 'rgba(212,160,76,0.15)', padding: '1px 6px', borderRadius: '4px' }}>
                              {ld.state || 'AZ'} · Click to Select 👉
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Appointment Type Toggle with Durations */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ fontWeight: 700, fontSize: '0.88rem', margin: 0 }}>
                  Select Appointment Type & Duration *
                </label>
                <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>
                  ⏱️ 30m Buffer Enforced
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                <button
                  type="button"
                  className={`btn ${appointmentType === 'telephone' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleTypeChange('telephone')}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0.6rem 0.4rem', gap: '0.2rem' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.88rem', fontWeight: 700 }}>
                    <span>📞</span>
                    <span>Phone</span>
                  </div>
                  <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>30 Minutes</span>
                </button>
                <button
                  type="button"
                  className={`btn ${appointmentType === 'video' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleTypeChange('video')}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0.6rem 0.4rem', gap: '0.2rem' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.88rem', fontWeight: 700 }}>
                    <span>🎥</span>
                    <span>Video Meet</span>
                  </div>
                  <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>30 Minutes</span>
                </button>
                <button
                  type="button"
                  className={`btn ${appointmentType === 'in_person' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleTypeChange('in_person')}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0.6rem 0.4rem', gap: '0.2rem' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.88rem', fontWeight: 700 }}>
                    <span>🏠</span>
                    <span>In-Person</span>
                  </div>
                  <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>60 Minutes</span>
                </button>
              </div>
            </div>

            {/* Interactive Available Time Slots Grid */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent)', display: 'block', margin: 0 }}>
                    📅 Available Time Slots ({durationMinutes}m slots + 30m buffer)
                  </label>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    Agent: <strong>{slotsData?.agent?.name || 'Selected Agent'}</strong> &nbsp;|&nbsp; Operating: 8:00 AM - 6:00 PM MST
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Date:</label>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      // Update appointmentAt date portion
                      const timePart = appointmentAt.slice(11) || '10:00';
                      setAppointmentAt(`${e.target.value}T${timePart}`);
                    }}
                    style={{
                      padding: '0.35rem 0.6rem',
                      borderRadius: '6px',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-main)',
                      fontSize: '0.82rem',
                    }}
                  />
                </div>
              </div>

              {/* Slot Availability Summary Badges */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.65rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.75rem' }}>
                <span className="badge badge-success" style={{ padding: '0.2rem 0.5rem' }}>
                  🟢 {slotsData?.available_slots_count || 0} Slots Open
                </span>
                <span className="badge badge-warning" style={{ padding: '0.2rem 0.5rem' }}>
                  ⏱️ 30m Buffer Spacing
                </span>
                {slotsData?.booked_slots_count > 0 && (
                  <span className="badge badge-secondary" style={{ padding: '0.2rem 0.5rem' }}>
                    🔒 {slotsData.booked_slots_count} Booked / Protected
                  </span>
                )}
                {loadingSlots && <span style={{ color: 'var(--accent)', fontSize: '0.75rem' }}>🔄 Checking slots...</span>}
              </div>

              {/* Slots Pills Container */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                  gap: '0.45rem',
                  maxHeight: '180px',
                  overflowY: 'auto',
                  paddingRight: '0.25rem',
                }}
              >
                {slotsData?.slots?.map((slot: any, idx: number) => {
                  const selected = isSlotSelected(slot);
                  const isAvailable = slot.available;
                  const isBuffer = slot.reason?.includes('Buffer');
                  const isBooked = slot.reason === 'Booked';

                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => handleSelectSlot(slot)}
                      title={slot.reason || slot.time_range}
                      style={{
                        padding: '0.45rem 0.35rem',
                        borderRadius: '6px',
                        fontSize: '0.76rem',
                        fontWeight: selected ? 800 : 600,
                        textAlign: 'center',
                        cursor: isAvailable ? 'pointer' : 'not-allowed',
                        border: selected
                          ? '2px solid #c8963e'
                          : isAvailable
                          ? '1px solid rgba(16,185,129,0.4)'
                          : isBooked
                          ? '1px solid rgba(239,68,68,0.3)'
                          : '1px solid rgba(245,158,11,0.25)',
                        backgroundColor: selected
                          ? 'var(--accent)'
                          : isAvailable
                          ? 'rgba(16,185,129,0.08)'
                          : isBooked
                          ? 'rgba(239,68,68,0.06)'
                          : 'rgba(245,158,11,0.05)',
                        color: selected
                          ? '#051039'
                          : isAvailable
                          ? '#10b981'
                          : isBooked
                          ? '#ef4444'
                          : '#cbd5e1',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div>{slot.time_label}</div>
                      <div style={{ fontSize: '0.68rem', opacity: 0.85 }}>
                        {selected
                          ? '✓ Selected'
                          : isAvailable
                          ? `Open (${durationMinutes}m)`
                          : isBooked
                          ? '🔒 Booked'
                          : isBuffer
                          ? '⏱️ 30m Buffer'
                          : 'Past'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date & Time and Duration */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.35rem' }}>
                  Confirmed Date & Time (Arizona MST) *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={appointmentAt}
                  onChange={(e) => setAppointmentAt(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                  }}
                />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.35rem' }}>
                  Duration
                </label>
                <select
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '0.6rem',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                  }}
                >
                  <option value={30}>30 mins (Phone / Video)</option>
                  <option value={60}>60 mins (In-Person)</option>
                  <option value={90}>90 mins (Extended)</option>
                </select>
              </div>
            </div>

            {/* State-Licensed Agent Selector */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent)' }}>
                  State-Licensed Agent Assignment ({customerState}) *
                </label>
                {loadingAgents && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Checking agent calendars...</span>}
              </div>

              {/* Quick Select King Amen Ra button */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button
                  type="button"
                  className={`btn ${agentId === (availableAgents.find(a => a.is_principal || a.id === 'u_principal')?.id || 'u_principal') ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setAgentId(availableAgents.find(a => a.is_principal || a.id === 'u_principal')?.id || 'u_principal')}
                  style={{
                    flex: 1,
                    padding: '0.45rem 0.65rem',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    borderColor: 'var(--accent)',
                    color: agentId === (availableAgents.find(a => a.is_principal || a.id === 'u_principal')?.id || 'u_principal') ? '#fff' : 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span>👑</span>
                  <span>Assign to King Amen Ra (Principal Broker)</span>
                </button>
                <button
                  type="button"
                  className={`btn ${agentId === '' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setAgentId('')}
                  style={{ padding: '0.45rem 0.65rem', fontSize: '0.82rem' }}
                >
                  ⚡ Auto-Route
                </button>
              </div>

              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  fontSize: '0.88rem',
                }}
              >
                <option value="">⚡ Auto-Route to Best Available Licensed Agent ({customerState})</option>
                {availableAgents.map((a) => {
                  const isPrincipal = a.is_principal || a.id === 'u_principal' || a.email?.toLowerCase() === 'king@iwillglobal.com';
                  return (
                    <option key={a.id} value={a.id}>
                      {isPrincipal ? `👑 ${a.name} — Principal & Broker of Record (NPN: ${a.npn})` : `${a.name} (${a.title || 'Agent'}) — NPN: ${a.npn}`} [{a.states?.join(', ')}] — {a.conflicts === 0 ? '🟢 Available' : '🔴 Conflict'} ({a.total_load_7d} apps/wk)
                    </option>
                  );
                })}
              </select>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                {selectedAgentObj ? (
                  <span>
                    Selected: <strong>{selectedAgentObj.is_principal ? `👑 ${selectedAgentObj.name} (Principal & Broker of Record)` : selectedAgentObj.name}</strong> (NPN: {selectedAgentObj.npn}). Licensed in {selectedAgentObj.states?.join(', ')}.
                  </span>
                ) : (
                  <span>Smart routing picks the lightest-loaded licensed agent in <strong>{customerState}</strong> with no calendar conflicts.</span>
                )}
              </div>
            </div>

            {/* Location / Contact Address */}
            <div>
              <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.35rem' }}>
                {appointmentType === 'in_person' ? 'In-Person Location Address' : 'Telephone Contact Number'} *
              </label>
              <input
                type="text"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={appointmentType === 'in_person' ? 'Enter home visit address or office location...' : 'Phone number...'}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  fontSize: '0.88rem',
                }}
              />
            </div>

            {/* Notes / Agenda */}
            <div>
              <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.35rem' }}>
                Appointment Notes & Agenda
              </label>
              <textarea
                rows={2}
                placeholder="Turning 65 review, doctors list, prescription review, Medigap vs MAPD..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                }}
              />
            </div>

            {/* Automated AI Confirmations & Scheduler Credit Rule Box */}
            <div style={{ background: 'var(--bg-surface)', border: '1.5px solid var(--accent)', padding: '1.1rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <span>📱</span> <span>Automated Confirmation Text & Email Protocol</span>
                </div>
                <span style={{ fontSize: '0.74rem', background: 'rgba(200, 150, 62, 0.15)', color: '#ffd88a', padding: '0.2rem 0.5rem', borderRadius: '6px', fontWeight: 600 }}>
                  Pre-fills from Selected Prospect
                </span>
              </div>

              {/* Pre-filled Editable Phone and Email Recipients */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontWeight: 700, fontSize: '0.82rem', display: 'block', marginBottom: '0.25rem', color: 'var(--text-main)' }}>
                    📱 Mobile Phone for Confirmation SMS *
                  </label>
                  <input
                    type="text"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="e.g. (480) 555-0123"
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.65rem',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-main)',
                      fontSize: '0.86rem',
                      fontWeight: 600,
                    }}
                  />
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {customerPhone ? `Target: ${formatPhone(customerPhone)}` : '⚠️ No phone entered'}
                  </div>
                </div>

                <div>
                  <label style={{ fontWeight: 700, fontSize: '0.82rem', display: 'block', marginBottom: '0.25rem', color: 'var(--text-main)' }}>
                    📧 Email for Calendar Invite & Confirmation
                  </label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="prospect@email.com"
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.65rem',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-main)',
                      fontSize: '0.86rem',
                    }}
                  />
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {customerEmail ? `Target: ${customerEmail}` : 'Optional (SMS will still be sent)'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.84rem' }}>
                  <input type="checkbox" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} />
                  <span style={{ fontWeight: 600 }}>Send Confirmation SMS (requesting <strong>"YES"</strong> / <strong>"Y"</strong>)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.84rem' }}>
                  <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                  <span style={{ fontWeight: 600 }}>Send Confirmation Email & Calendar Invite</span>
                </label>
              </div>

              {/* Dynamic Live SMS Confirmation Text Preview Box */}
              {sendSms && (
                <div style={{ background: '#071026', border: '1px solid #1e293b', borderRadius: '10px', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.76rem', color: '#38bdf8', fontWeight: 700 }}>
                    <span>💬 PRE-FILLED SMS CONFIRMATION TEXT PREVIEW</span>
                    <span>To: {customerPhone ? formatPhone(customerPhone) : 'Prospect Mobile'}</span>
                  </div>
                  <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.82rem', color: '#f1f5f9', lineHeight: '1.5', borderLeft: '3px solid var(--accent)', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                    {`Hi ${selectedContact?.name ? selectedContact.name.split(' ')[0] : 'there'}, your Medicare ${appointmentType === 'video' ? 'Google Meet Video Call' : appointmentType === 'telephone' ? 'Phone Call' : 'In-Person'} appointment with licensed agent ${selectedAgentObj?.name || 'Licensed Specialist'} (NPN: ${selectedAgentObj?.npn || 'Principal Broker'}) is scheduled for ${new Date(appointmentAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} MST. Location/Call: ${location || 'Phone Call'}.\n\n👉 IMPORTANT: Please reply YES or Y to confirm your appointment!\n\nReschedule or questions? Call I Will Global at (480) 331-9455. - I Will Global`}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: '#94a3b8' }}>
                    ℹ️ When beneficiary replies <strong>YES</strong> or <strong>Y</strong>, the CRM automatically marks appointment confirmed and qualifies lead credit!
                  </div>
                </div>
              )}

              {/* Email preview summary */}
              {sendEmail && customerEmail && (
                <div style={{ background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '8px', padding: '0.65rem 0.8rem', fontSize: '0.78rem', color: '#cbd5e1' }}>
                  <strong style={{ color: '#38bdf8' }}>✉️ Confirmation Email & 1-Click Link:</strong> Will be sent to <strong>{customerEmail}</strong> with Google Meet link & digital Scope of Appointment (SOA).
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} style={{ flex: 1, padding: '0.75rem' }}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting} style={{ flex: 2, padding: '0.75rem', fontWeight: 700 }}>
                {submitting ? 'Booking & Sending Confirmation...' : '📅 Schedule & Send Confirmation'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
