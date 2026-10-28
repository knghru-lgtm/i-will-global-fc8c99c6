import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { WarmTransferModal } from './WarmTransferModal';

interface OutboundScriptModalProps {
  clientName?: string;
  clientAddress?: string;
  isOpen: boolean;
  isLiveCall?: boolean;
  onClose: () => void;
  onScheduleClick?: () => void;
  onExitDialer?: () => void;
}

export const OutboundScriptModal: React.FC<OutboundScriptModalProps> = ({
  clientName = '[Client Name]',
  clientAddress,
  isOpen,
  isLiveCall = false,
  onClose,
  onScheduleClick,
  onExitDialer,
}) => {
  const { user, tpmo } = useAuth();
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState<number>(1);
  const [isWarmTransferOpen, setIsWarmTransferOpen] = useState<boolean>(false);

  const handleExitDialer = useCallback(() => {
    onClose();
    if (onExitDialer) onExitDialer();
  }, [onClose, onExitDialer]);

  const handleExitToDashboard = useCallback(() => {
    onClose();
    if (onExitDialer) onExitDialer();
    navigate('/dashboard');
  }, [onClose, onExitDialer, navigate]);

  const handleExitToWorkflow = useCallback(() => {
    onClose();
    if (onExitDialer) onExitDialer();
    navigate('/leads');
  }, [onClose, onExitDialer, navigate]);

  // Allow toggling out of script at anytime via Escape key without leaving lead
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const displayName = clientName && clientName !== '[Client Name]' ? clientName : 'Beneficiary';
  const agentName = user?.name || '[Your Name]';

  return (
    <div className="slideover-overlay" onClick={onClose}>
      <div
        className="slideover-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '720px', maxWidth: '95vw', backgroundColor: '#0b132b', color: '#fff', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header with Exit to Dashboard & Workflow Buttons */}
        <div
          className="slideover-header"
          style={{ background: '#111c3a', borderBottom: '1px solid #243566', padding: '1.1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'rgba(200,150,62,0.15)',
                border: '1px solid #c8963e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
              }}
            >
              📜
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#c8963e' }}>
                Outbound Call Script: Annual Enrollment Review
              </div>
              <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                Speaking with: <strong style={{ color: '#fff' }}>{displayName}</strong>
                {clientAddress && (
                  <span style={{ marginLeft: '0.6rem', color: '#ffd88a' }}>
                    📍 <strong>Address:</strong> {clientAddress}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick Exit Navigation Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToDashboard}
              style={{
                padding: '0.4rem 0.75rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderColor: '#243566',
                color: '#fff',
              }}
              title="Exit script immediately and return to Dashboard"
            >
              <span>🏠</span> <span>Dashboard</span>
            </button>
            {isLiveCall ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsWarmTransferOpen(true)}
                style={{
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  backgroundColor: 'rgba(200, 150, 62, 0.18)',
                  borderColor: '#c8963e',
                  color: '#ffd88a',
                }}
                title="Initiate Live 3-Way Warm Transfer (Agent + Scheduler + Prospect)"
              >
                <span>⚡</span> <span>3-Way Transfer</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                disabled
                style={{
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  borderColor: 'rgba(255, 255, 255, 0.12)',
                  color: '#64748b',
                  cursor: 'not-allowed',
                  opacity: 0.65,
                }}
                title="Only available once connected on a live call with prospect. Dial to connect first."
              >
                <span>🔒</span> <span>3-Way Transfer</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{
                padding: '0.4rem 0.85rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                backgroundColor: 'rgba(59,130,246,0.15)',
                borderColor: '#3b82f6',
                color: '#93c5fd',
              }}
              title="Close script and stay on lead & dialer"
            >
              <span>←</span> <span>Back to Lead</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToWorkflow}
              style={{
                padding: '0.4rem 0.75rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderColor: '#243566',
                color: '#fff',
              }}
              title="Exit script immediately and return to Leads / Prospecting Workflow"
            >
              <span>📋</span> <span>Workflow</span>
            </button>
            {onExitDialer ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleExitDialer}
                style={{
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  backgroundColor: 'rgba(239,68,68,0.1)',
                  borderColor: 'rgba(239,68,68,0.4)',
                  color: '#f87171',
                }}
                title="Exit Dialer queue completely"
              >
                <span>🚪</span> <span>Exit Dialer</span>
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{ padding: '0.4rem 0.65rem', fontSize: '0.9rem', fontWeight: 700, borderColor: '#243566' }}
              title="Close script and return to lead"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="slideover-body" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', overflowY: 'auto' }}>
          {/* Quick Exit Banner */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.6rem 0.9rem',
              background: 'rgba(200,150,62,0.08)',
              borderRadius: '8px',
              border: '1px solid rgba(200,150,62,0.3)',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div style={{ fontSize: '0.82rem', color: '#ffd88a', fontWeight: 600 }}>
              💡 Need to pause or switch? Exit script at anytime:
            </div>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem', fontWeight: 700, backgroundColor: 'rgba(59,130,246,0.15)', borderColor: '#3b82f6', color: '#93c5fd' }}
                title="Close script and return to lead"
              >
                ← Return to Lead & Dialer
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleExitToDashboard}
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem', fontWeight: 600 }}
              >
                🏠 Exit to Dashboard
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleExitToWorkflow}
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem', fontWeight: 600 }}
              >
                📋 Return to Workflow
              </button>
            </div>
          </div>

          {/* Compliance Checkpoint Banner */}
          <div
            style={{
              padding: '0.85rem 1rem',
              borderRadius: '10px',
              backgroundColor: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171',
              fontSize: '0.82rem',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              🛡️ Mandatory CMS / TPMO Compliance Checkpoint:
            </div>
            <p style={{ margin: 0, fontStyle: 'italic', color: '#fca5a5' }}>
              "{tpmo}"
            </p>
          </div>

          {/* Scheduler Directive - Do Not Leave Voicemails */}
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '10px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1.5px solid #ef4444',
              color: '#fca5a5',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
            }}
          >
            <span style={{ fontSize: '1.25rem' }}>🚫</span>
            <div>
              <strong style={{ color: '#fff' }}>SCHEDULER INSTRUCTION — DO NOT LEAVE VOICEMAILS:</strong> If an answering machine or voicemail picks up, <strong>hang up immediately</strong>. Do NOT leave a voice message. Mark the call as <strong>"No Answer"</strong> to keep the lead in active rotation.
            </div>
          </div>

          {/* Step Progress Bar */}
          <div style={{ display: 'flex', gap: '0.4rem', background: '#111c3a', padding: '0.4rem', borderRadius: '10px' }}>
            {[
              { num: 1, label: '1. Greeting' },
              { num: 2, label: '2. Schedule Time' },
              { num: 3, label: '3. Confirm & Assign Agent' },
              { num: 4, label: '💡 Objections' },
            ].map((step) => (
              <button
                key={step.num}
                className={`btn ${activeStep === step.num ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveStep(step.num)}
                style={{ flex: 1, padding: '0.45rem 0.2rem', fontSize: '0.78rem', fontWeight: 700 }}
              >
                {step.label}
              </button>
            ))}
          </div>

          {/* STEP 1: GREETING & PURPOSE */}
          {activeStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#c8963e', margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>
                  Step 1: Greeting & Purpose of Call
                </h4>

                <div style={{ fontSize: '0.92rem', lineHeight: 1.6, color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <p style={{ margin: 0, background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #c8963e' }}>
                    "Hello <strong>{displayName}</strong>, this is <strong>{agentName}</strong> with the Medicare Helpline.
                  </p>
                  <p style={{ margin: 0, background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #c8963e' }}>
                    The reason for my call today is regarding the Medicare Annual Enrollment Period. As you may know, plan benefits, networks, and drug formularies change every January 1st. I’m reaching out to get you scheduled for your complimentary 2027 Annual Plan Review with one of our state-licensed agents to ensure your doctors, prescriptions, and benefits are fully protected."
                  </p>
                  <p style={{ margin: 0, background: 'rgba(200,150,62,0.1)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #e0ac53', fontWeight: 600 }}>
                    "We compare all major Medicare plans in your county to make sure you keep your doctors and don't overpay on copays or prescriptions next year." Do you have any questions about extra benefits?
                  </p>
                  <div style={{ background: 'rgba(59,130,246,0.15)', padding: '0.85rem', borderRadius: '8px', borderLeft: '3px solid #3b82f6' }}>
                    <p style={{ margin: '0 0 0.5rem', fontWeight: 700, color: '#60a5fa' }}>
                      👉 "Let’s get you connected to one of our trusted licensed agents."
                    </p>
                    <div style={{ paddingLeft: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.88rem' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.3rem' }}>
                          <strong style={{ color: '#10b981', fontSize: '0.92rem' }}>• If yes (Warm Transfer):</strong>
                          {isLiveCall ? (
                            <button
                              type="button"
                              className="btn btn-accent"
                              onClick={() => setIsWarmTransferOpen(true)}
                              style={{
                                padding: '0.35rem 0.8rem',
                                fontSize: '0.82rem',
                                fontWeight: 800,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                boxShadow: '0 2px 10px rgba(212, 160, 76, 0.35)',
                              }}
                            >
                              ⚡ Live 3-Way Transfer → (480) 331-9455
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              style={{
                                padding: '0.35rem 0.8rem',
                                fontSize: '0.82rem',
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                background: 'rgba(255, 255, 255, 0.05)',
                                color: '#64748b',
                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                borderRadius: '6px',
                                cursor: 'not-allowed',
                                opacity: 0.65,
                              }}
                              title="Connect live call with prospect first before initiating warm transfer"
                            >
                              🔒 3-Way Transfer (Connect Call First)
                            </button>
                          )}
                        </div>
                        <div style={{ marginTop: '0.2rem', color: isLiveCall ? '#cbd5e1' : '#94a3b8' }}>
                          {isLiveCall
                            ? 'Connect beneficiary immediately via live 3-way conference call to licensed agent at (480) 331-9455 ($25 scheduler credit).'
                            : 'Must be on a connected live call with beneficiary before warm transfer can be initiated.'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ color: '#f59e0b' }}>If no:</strong>
                        <div style={{ marginTop: '0.25rem', color: '#f8fafc', fontWeight: 600 }}>
                          "Let’s take 30 seconds to pick a convenient time on the calendar for your review. Would morning or afternoon work better for you?"
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Branch Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setActiveStep(2);
                    if (onScheduleClick) onScheduleClick();
                  }}
                  style={{ padding: '0.85rem', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                >
                  📅 "Schedule Appointment" → Put on Calendar
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setActiveStep(4)}
                  style={{ padding: '0.85rem', fontWeight: 700, fontSize: '0.9rem', borderColor: '#ef4444', color: '#f87171' }}
                >
                  💡 Client Has Objections / Questions
                </button>
              </div>

              <div style={{ background: '#0e1838', padding: '0.85rem', borderRadius: '10px', fontSize: '0.82rem', color: '#94a3b8', border: '1px dashed #243566' }}>
                💡 <strong>Scheduler Reminder:</strong> Schedulers do not need to triage medical conditions or prescriptions. Your goal is simply to secure the appointment time, assign it to King Amen Ra or an available licensed agent, and place it on the calendar!
              </div>
            </div>
          )}

          {/* STEP 2: SELECT APPOINTMENT TIME */}
          {activeStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#c8963e', margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>
                  Step 2: Select Appointment Time & Mode
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem', color: '#e2e8f0' }}>
                  <p style={{ margin: 0, background: '#16244d', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #c8963e', color: '#f8fafc', fontWeight: 600 }}>
                    👉 "Would you prefer to do that over the phone, via a video link, or in person? Our licensed agents can even come to you. Convenience and service is what we do."
                  </p>
                  <p style={{ margin: 0, background: '#16244d', padding: '0.75rem', borderRadius: '8px' }}>
                    👉 "Would the first part of the week or end of week work best? Is 10:00 AM or closer to 2:00 PM better?"
                  </p>
                  <p style={{ margin: 0, background: 'rgba(16,185,129,0.15)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981', color: '#6ee7b7' }}>
                    👉 "Great, let’s lock that spot in on our calendar with our licensed agent right now."
                  </p>
                </div>
              </div>

              {onScheduleClick && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    onClose();
                    onScheduleClick();
                  }}
                  style={{ width: '100%', padding: '0.85rem', fontWeight: 800, fontSize: '0.95rem' }}
                >
                  📅 Open Slot Picker & Put on Calendar Now
                </button>
              )}

              <button
                className="btn btn-secondary"
                onClick={() => setActiveStep(3)}
                style={{ width: '100%', padding: '0.65rem', fontWeight: 600 }}
              >
                Proceed to Step 3: Confirmation & Agent Handoff →
              </button>
            </div>
          )}

          {/* STEP 3: CONFIRM & ASSIGN AGENT */}
          {activeStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#c8963e', margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>
                  Step 3: Confirm Appointment & Auto-Send SMS
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem', color: '#e2e8f0' }}>
                  <p style={{ margin: 0, background: '#16244d', padding: '0.75rem', borderRadius: '8px' }}>
                    👉 "I have your appointment confirmed with our state-licensed Medicare specialist on our agency calendar."
                  </p>
                  <p style={{ margin: 0, background: 'rgba(16,185,129,0.15)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981', color: '#6ee7b7' }}>
                    👉 "I am sending a quick text message to your phone right now. When you see it, please reply <strong>YES</strong> to confirm your slot so the agent holds that time for you."
                  </p>
                  <p style={{ margin: 0, background: '#16244d', padding: '0.75rem', borderRadius: '8px' }}>
                    👉 "Please have your current prescription bottles and doctors' names ready for your licensed agent when they connect with you."
                  </p>
                  <p style={{ margin: 0, background: '#16244d', padding: '0.75rem', borderRadius: '8px', fontWeight: 700, color: '#c8963e' }}>
                    👉 "Thank you, <strong>{displayName}</strong>, and have a wonderful day!"
                  </p>
                </div>
              </div>

              {onScheduleClick && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    onClose();
                    onScheduleClick();
                  }}
                  style={{ width: '100%', padding: '0.85rem', fontWeight: 800, fontSize: '0.95rem' }}
                >
                  📅 Book Appointment & Auto-Send Confirmation Text (YES/Y)
                </button>
              )}
            </div>
          )}

          {/* STEP 4: OBJECTIONS */}
          {activeStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#c8963e', margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>
                  Common Objections & Quick Rebuttals
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {/* Objection 1 */}
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '1rem', border: '1px solid #243566' }}>
                    <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.4rem', fontSize: '0.88rem' }}>
                      ❌ "I’m happy with my current plan and don’t want to change."
                    </div>
                    <div style={{ fontSize: '0.88rem', color: '#e2e8f0', background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      "That’s great to hear, <strong>{displayName}</strong>, and staying right where you are may very well be the best choice. However, plans change their drug formularies and copays every single year on January 1st. A 10-minute checkup doesn't mean you have to change anything—it simply guarantees there are no surprise bills at the pharmacy counter in January."
                    </div>
                  </div>

                  {/* Objection 2 */}
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '1rem', border: '1px solid #243566' }}>
                    <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.4rem', fontSize: '0.88rem' }}>
                      ❌ "I get so many calls and mailers, it’s overwhelming."
                    </div>
                    <div style={{ fontSize: '0.88rem', color: '#e2e8f0', background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      "I completely understand—seniors are bombarded with hundreds of commercials and letters this time of year. That’s why you work with me as your local broker. You don't have to sift through stacks of mail; we look directly at your exact doctors and prescriptions together and cut through the noise in 15 minutes."
                    </div>
                  </div>

                  {/* Objection 3 */}
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '1rem', border: '1px solid #243566' }}>
                    <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.4rem', fontSize: '0.88rem' }}>
                      ❌ "Can't you just tell me what the best plan is right now?"
                    </div>
                    <div style={{ fontSize: '0.88rem', color: '#e2e8f0', background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      "Medicare has strict guidelines requiring us to complete a Scope of Appointment before reviewing specific plan benefit details. Setting our appointment ensures your call is handled properly, and it gives me time to run your exact medication list through the database so I don't give you guesswork."
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Dedicated Bottom Footer with Exit Actions */}
        <div
          className="slideover-footer"
          style={{
            background: '#111c3a',
            borderTop: '1px solid #243566',
            padding: '1rem 1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToDashboard}
              style={{
                fontWeight: 700,
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderColor: '#243566',
                color: '#fff',
              }}
            >
              <span>🏠</span> Exit to Dashboard
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExitToWorkflow}
              style={{
                fontWeight: 700,
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderColor: '#243566',
                color: '#fff',
              }}
            >
              <span>📋</span> Exit to Workflow (Leads)
            </button>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            style={{ fontWeight: 700, fontSize: '0.85rem', padding: '0.5rem 1.25rem', backgroundColor: '#3b82f6', borderColor: '#2563eb' }}
            title="Return to current lead & dialer"
          >
            ← Return to Lead & Dialer (Esc)
          </button>
        </div>
      </div>

      <WarmTransferModal
        isOpen={isWarmTransferOpen}
        onClose={() => setIsWarmTransferOpen(false)}
      />
    </div>
  );
};
