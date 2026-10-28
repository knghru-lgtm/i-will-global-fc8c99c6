import React, { useState, useEffect } from 'react';
import { api, formatPhone } from '../lib/api';
import { useAuth } from '../lib/auth';

interface RunningLateModalProps {
  isOpen: boolean;
  onClose: () => void;
  nextAppointmentId?: string;
  onAlertSent?: (res: any) => void;
}

export const RunningLateModal: React.FC<RunningLateModalProps> = ({
  isOpen,
  onClose,
  nextAppointmentId,
  onAlertSent,
}) => {
  const { user, activeRole } = useAuth();
  const isAllowed = activeRole === 'admin' || activeRole === 'licensed_agent' || user?.role === 'admin' || user?.role === 'licensed_agent' || user?.email?.toLowerCase() === 'king@iwillglobal.com' || user?.email?.toLowerCase() === 'aneesha@iwillglobal.com';
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<any>(null);
  const [minutesDelayed, setMinutesDelayed] = useState<number>(15);
  const [customMessage, setCustomMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sentResult, setSentResult] = useState<any>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/appointments/running-late-status');
      setStatus(res);
      if (res.suggested_delay_minutes) {
        setMinutesDelayed(res.suggested_delay_minutes);
      }
      if (res.default_sms_message) {
        setCustomMessage(res.default_sms_message);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to detect running late status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSentResult(null);
      fetchStatus();
    }
  }, [isOpen, nextAppointmentId]);

  // Update default message when minutes change
  const handleDelayChange = (mins: number) => {
    setMinutesDelayed(mins);
    if (status?.next_appointment) {
      const origDue = new Date(status.next_appointment.due_at);
      const newEst = new Date(origDue.getTime() + mins * 60 * 1000);
      const origStr = origDue.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' MST';
      const newStr = newEst.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' MST';
      const clientName = status.next_appointment.customer_first_name || 'there';
      const agentName = status.agent?.name || user?.name || 'Your Licensed Agent';
      const agentPhone = status.agent?.phone || '(480) 331-9455';

      setCustomMessage(
        `Hi ${clientName}, this is ${agentName} with I Will Global Insurance. My previous Medicare appointment is running about ${mins} minutes longer than planned. I apologize for the slight delay and will connect with you at approximately ${newStr} (originally ${origStr})! If you need to adjust or reschedule, reply RESCHEDULE or call me at ${agentPhone}. Thank you for your patience!`
      );
    }
  };

  const handleSendAlert = async () => {
    setSubmitting(true);
    setError('');
    try {
      const payload: any = {
        minutes_delayed: minutesDelayed,
        custom_message: customMessage,
      };
      if (nextAppointmentId) {
        payload.next_appointment_id = nextAppointmentId;
      } else if (status?.next_appointment?.id) {
        payload.next_appointment_id = status.next_appointment.id;
      }

      const res = await api.post('/appointments/running-late', payload);
      setSentResult(res);
      if (onAlertSent) onAlertSent(res);
    } catch (err: any) {
      setError(err.message || 'Failed to send running late SMS');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !isAllowed) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '600px', width: '100%', padding: '1.75rem', position: 'relative' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.6rem' }}>🏃</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent)' }}>
                Running Late? Auto-Text Next Appointment
              </h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Instantly notify your next beneficiary via automated SMS when your current meeting runs long.
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', color: '#fca5a5', marginBottom: '1rem', fontSize: '0.85rem' }}>
            ⚠️ {error}
          </div>
        )}

        {sentResult ? (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>📲</div>
            <h4 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10b981', marginBottom: '0.5rem' }}>
              Automated Text Sent Successfully!
            </h4>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Your next appointment with <strong>{sentResult.recipient?.name}</strong> ({formatPhone(sentResult.recipient?.phone)}) was notified of the estimated start time around <strong>{sentResult.next_appointment?.new_time_formatted}</strong>.
            </div>

            <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '8px', textAlign: 'left', fontSize: '0.82rem', color: '#cbd5e1', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
              <strong>Message Content:</strong>
              <div style={{ marginTop: '0.35rem', fontStyle: 'italic' }}>"{sentResult.message_sent}"</div>
            </div>

            <button className="btn btn-primary" onClick={onClose} style={{ minWidth: '160px' }}>
              Done / Return to Calendar
            </button>
          </div>
        ) : loading ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Detecting current consultation & finding next appointment...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            {/* Status Insight Banner */}
            <div style={{ background: status?.has_running_late ? 'rgba(239, 68, 68, 0.12)' : 'rgba(200, 150, 62, 0.12)', border: `1px solid ${status?.has_running_late ? '#ef4444' : 'var(--accent)'}`, borderRadius: '10px', padding: '0.85rem 1rem', fontSize: '0.85rem' }}>
              {status?.has_running_late ? (
                <div>
                  <strong style={{ color: '#f87171' }}>⚠️ Appointment Overdue:</strong> Your meeting with{' '}
                  <strong>{status?.current_appointment?.customer_first_name} {status?.current_appointment?.customer_last_name}</strong>{' '}
                  has run <strong>{status?.minutes_overdue} minutes past</strong> scheduled time.
                </div>
              ) : (
                <div>
                  <strong style={{ color: 'var(--accent)' }}>ℹ️ Schedule Status:</strong> Proactively notify your next attendee if you anticipate your current discussion will run over.
                </div>
              )}
            </div>

            {/* Next Appointment Recipient Card */}
            {status?.next_appointment ? (
              <div style={{ background: 'var(--bg-surface)', border: '1.5px solid var(--border-color)', borderRadius: '12px', padding: '1rem' }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.05em' }}>
                  Next Appointment Recipient
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.35rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                      {status.next_appointment.customer_first_name} {status.next_appointment.customer_last_name}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#60a5fa' }}>
                      📞 {formatPhone(status.next_appointment.customer_phone)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Scheduled Time:</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f59e0b' }}>
                      {new Date(status.next_appointment.due_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} MST
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
                No subsequent appointments scheduled for today.
              </div>
            )}

            {/* Delay Selector */}
            {status?.next_appointment && (
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: '0.45rem' }}>
                  Select Estimated Delay:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                  {[10, 15, 20, 30].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => handleDelayChange(mins)}
                      style={{
                        padding: '0.65rem 0.5rem',
                        borderRadius: '8px',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        border: minutesDelayed === mins ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                        background: minutesDelayed === mins ? 'var(--accent)' : 'var(--bg-surface)',
                        color: minutesDelayed === mins ? '#051039' : '#fff',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      +{mins} mins
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Live Message Preview & Editor */}
            {status?.next_appointment && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700 }}>
                    SMS Message Preview:
                  </label>
                  <span style={{ fontSize: '0.75rem', color: '#10b981' }}>
                    Estimated Start: {(() => {
                      const origDue = new Date(status.next_appointment.due_at);
                      const newEst = new Date(origDue.getTime() + minutesDelayed * 60 * 1000);
                      return newEst.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' MST';
                    })()}
                  </span>
                </div>
                <textarea
                  className="input"
                  rows={4}
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  style={{ width: '100%', fontSize: '0.84rem', lineHeight: '1.45', padding: '0.65rem', borderRadius: '8px' }}
                />
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSendAlert}
                disabled={submitting || !status?.next_appointment}
                style={{ fontWeight: 800, minWidth: '190px' }}
              >
                {submitting ? 'Sending SMS...' : '🚀 Send Automatic Text Now'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
