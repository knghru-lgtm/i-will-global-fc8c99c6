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
  const [copiedWhisper, setCopiedWhisper] = useState<boolean>(false);
  const [copiedMerge, setCopiedMerge] = useState<boolean>(false);

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
  const agentName = user?.name || 'Sarah';

  const whisperScriptText = `Hi King Amen Ra, this is Sarah AI whispering automatically on behalf of ${agentName} with the Medicare Helpline powered by IWG Insurance and Financial Services. We have ${displayName} on the line—they are interested in reviewing the 2027 Medicare changes and verifying their doctors and prescriptions. Bridging you in now!`;
  const mergeScriptText = `Thank you so much for your patience, ${displayName}! It is my pleasure to introduce King Amen Ra, our Principal Broker at IWG Insurance and Financial Services. King, I have shared ${displayName}'s information with you so they are in the very best hands. ${displayName}, it has been a privilege speaking with you today—King will take wonderful care of you from here!`;

  const speakAiWhisperAutomatically = (textToSpeak: string) => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 1.02;
        utterance.pitch = 1.05;
        window.speechSynthesis.speak(utterance);
      }
    } catch {
      // ignore if speech synthesis is unavailable
    }
  };

  return (
    <div className="slideover-overlay" onClick={onClose}>
      <div
        className="slideover-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '760px', maxWidth: '95vw', backgroundColor: '#0b132b', color: '#fff', display: 'flex', flexDirection: 'column' }}
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
              <div style={{ fontWeight: 800, fontSize: '1.08rem', color: '#c8963e', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span>Unified Outbound Script (Same as Sarah AI)</span>
                <span className="badge badge-gold" style={{ fontSize: '0.7rem' }}>
                  {isLiveCall ? '🟢 LIVE CALL · WHISPER TRANSFER READY' : 'WHISPER TRANSFER ENABLED'}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                Speaking with: <strong style={{ color: '#fff' }}>{displayName}</strong> · Medicare Helpline powered by IWG Insurance and Financial Services
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
              title="Initiate Live Whisper Warm Transfer to Principal Broker King Amen Ra at (602) 456-9681"
            >
              <span>⚡</span> <span>Whisper Transfer → King</span>
            </button>
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
          {/* Unified Script Notice Banner */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.6rem 0.9rem',
              background: 'rgba(200,150,62,0.1)',
              borderRadius: '8px',
              border: '1px solid rgba(200,150,62,0.35)',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div style={{ fontSize: '0.82rem', color: '#ffd88a', fontWeight: 700 }}>
              🎙️ All Outbound Callers & Sarah AI Use This Exact Unified Script + Whisper Warm Transfer to King Amen Ra ((602) 456-9681)
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

          {/* Step Progress Bar */}
          <div style={{ display: 'flex', gap: '0.4rem', background: '#111c3a', padding: '0.4rem', borderRadius: '10px' }}>
            {[
              { num: 1, label: '1. Sarah Greeting & Qualify' },
              { num: 2, label: '2. 2027 Medicare & Plans' },
              { num: 3, label: '3. Whisper Transfer / Book Appt' },
              { num: 4, label: '💡 Divisions & Objections' },
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

          {/* STEP 1: SARAH'S OPENING GREETING & 2027 MEDICARE CHANGES */}
          {activeStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#c8963e', margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>
                  Step 1: World-Class Opening Greeting & 2027 Value Hook (Unified for All Callers & Sarah AI)
                </h4>

                <div style={{ fontSize: '0.92rem', lineHeight: 1.6, color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ background: 'rgba(200,150,62,0.12)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #c8963e' }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#ffd88a', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                      1. Warm Opening Greeting (Line 1):
                    </div>
                    <p style={{ margin: '0 0 0.35rem', fontWeight: 700, color: '#fff', fontSize: '0.96rem' }}>
                      "Hello <strong>{displayName}</strong>, this is <strong>{agentName}</strong> calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you doing today?"
                    </p>
                    <div style={{ fontSize: '0.76rem', color: '#cbd5e1', fontStyle: 'italic' }}>
                      Inbound Receptionist Greeting: "Thank you for calling IWG Insurance and Financial Services. This is Sarah—it is a pleasure to assist you today. How may I direct your call?"
                    </div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #38bdf8' }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                      2. Empathy Bridge + Clinical & Fiduciary Authority:
                    </div>
                    <p style={{ margin: 0, fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>
                      "I’m so glad we connected. We are a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees—and our clinical and benefits governance is led by our Principal Broker, <strong>King Amen Ra</strong>, and our Chief Operating Officer, <strong>Aneesha Sullivan, PA</strong>."
                    </p>
                  </div>

                  <div style={{ background: 'rgba(16,185,129,0.12)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#34d399', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                      3. High-Conversion 2027 Value Question & Automatic AI Whisper Transfer:
                    </div>
                    <p style={{ margin: '0 0 0.6rem', fontWeight: 800, color: '#6ee7b7', fontSize: '1.02rem' }}>
                      "To make sure you have the most accurate information for your healthcare and budget, would you like to hear how the <strong>2027 Medicare changes</strong> can lower your out-of-pocket costs and protect your doctor and prescription coverage?"
                    </p>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-accent"
                        onClick={() => {
                          setActiveStep(3);
                          speakAiWhisperAutomatically(whisperScriptText);
                          setIsWarmTransferOpen(true);
                        }}
                        style={{ padding: '0.45rem 0.9rem', fontSize: '0.84rem', fontWeight: 800 }}
                      >
                        🤖 Yes → Automatic AI Whisper Transfer (King / Directory)
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setActiveStep(2)}
                        style={{ padding: '0.45rem 0.9rem', fontSize: '0.84rem', fontWeight: 700 }}
                      >
                        📊 Review 2027 Medicare Changes First →
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Branch Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => setActiveStep(3)}
                  style={{ padding: '0.85rem', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                >
                  ⚡ Whisper Transfer OR 📅 Schedule (Phone / In-Person / Video)
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setActiveStep(4)}
                  style={{ padding: '0.85rem', fontWeight: 700, fontSize: '0.9rem', borderColor: '#ef4444', color: '#f87171' }}
                >
                  💡 All 6 Divisions & Empathy-First Rebuttals
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: 3-POINT HIGH-IMPACT 2027 MEDICARE SUMMARY & ASSUMPTIVE CLOSE */}
          {activeStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#c8963e', margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>
                  Step 2: 3-Point High-Impact 2027 Medicare Summary & Assumptive Close
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.88rem', color: '#e2e8f0', lineHeight: 1.55 }}>
                  <div style={{ background: '#16244d', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #c8963e' }}>
                    <strong style={{ color: '#ffd88a' }}>1. The Exposure (Why We Review Every Year):</strong>
                    <p style={{ margin: '0.35rem 0 0' }}>
                      "Original Medicare Part A (<strong>$0/month premium</strong> for 99%+ of beneficiaries) has a <strong>$1,788</strong> hospital deductible, and Part B (<strong>$209.50/month</strong> projected premium, <strong>$292</strong> annual deductible) leaves an <strong>uncapped 20% medical coinsurance with no annual out-of-pocket limit</strong>."
                    </p>
                  </div>

                  <div style={{ background: '#16244d', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #38bdf8' }}>
                    <strong style={{ color: '#38bdf8' }}>2. The 2027 Prescription Protection & 104+ Carrier Solution:</strong>
                    <p style={{ margin: '0.35rem 0 0' }}>
                      "For 2027, Part D caps your annual out-of-pocket prescription costs at <strong>$2,400</strong> with a <strong>$35/month insulin cap</strong> and <strong>$0 adult vaccines</strong>—but carrier drug formularies change every January. That is why we run a complimentary 5-minute check across <strong>104+ premier carriers</strong>—comparing <strong>Medigap Plan G</strong>, <strong>Plan N</strong>, and <strong>Medicare Advantage (Part C & D-SNP/C-SNP)</strong> side-by-side—to ensure your exact doctors and medications are covered at the lowest possible cost."
                    </p>
                  </div>

                  <div style={{ background: 'rgba(16,185,129,0.14)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #10b981', color: '#6ee7b7', fontWeight: 700 }}>
                    👉 3. Assumptive Micro-Commitment Close (Say This):
                    <div style={{ marginTop: '0.25rem', color: '#ffffff', fontStyle: 'italic' }}>
                      "To make this completely effortless for you, <strong>{displayName}</strong>, our Principal Broker <strong>King Amen Ra</strong> can verify your doctors and prescriptions in just a few minutes at zero cost. I have him available right now—let me introduce you so you can get your questions answered first-hand, okay?"
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-accent"
                  onClick={() => {
                    setActiveStep(3);
                    speakAiWhisperAutomatically(whisperScriptText);
                    setIsWarmTransferOpen(true);
                  }}
                  style={{ flex: 1, padding: '0.85rem', fontWeight: 800, fontSize: '0.92rem' }}
                >
                  ⚡ Launch Automatic AI Whisper Transfer to King Amen Ra →
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setActiveStep(3)}
                  style={{ flex: 1, padding: '0.85rem', fontWeight: 800, fontSize: '0.92rem' }}
                >
                  Proceed to Step 3: Whisper Transfer or Book Appointment →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: WHISPER WARM TRANSFER TO KING AMEN RA OR APPOINTMENT-ONLY BOOKING */}
          {activeStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Path A: Whisper Warm Transfer when King is Available */}
              <div style={{ backgroundColor: '#111c3a', border: '2px solid #c8963e', borderRadius: '12px', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <h4 style={{ color: '#ffd88a', margin: 0, fontSize: '1rem', fontWeight: 800 }}>
                    Path A — VIP Concierge Automatic AI Whisper Transfer ((602) 456-9681)
                  </h4>
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => {
                      speakAiWhisperAutomatically(whisperScriptText);
                      setIsWarmTransferOpen(true);
                    }}
                    style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem', fontWeight: 800 }}
                  >
                    ⚡ Open 3-Way Whisper Transfer Modal
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.88rem', color: '#e2e8f0' }}>
                  <div style={{ background: '#16244d', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #38bdf8' }}>
                    <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '0.78rem', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                      1. Say to {displayName} Before Placing on Hold (VIP Concierge Framing):
                    </div>
                    <em>
                      "Wonderful, <strong>{displayName}</strong>. I am bringing our Principal Broker and Licensed Senior Advisor, <strong>King Amen Ra</strong>, onto the line for you right now. I’m going to share your notes with him first so you don't have to repeat yourself—please stay with me for just 15 seconds."
                    </em>
                  </div>

                  <div style={{ background: 'rgba(200,150,62,0.14)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #c8963e' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem', flexWrap: 'wrap', gap: '0.35rem' }}>
                      <div style={{ fontWeight: 800, color: '#ffd88a', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                        2. 🤖 Automatic AI Whisper Briefing to King Amen Ra on Line 2 ((602) 456-9681):
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => speakAiWhisperAutomatically(whisperScriptText)}
                          style={{ padding: '0.2rem 0.55rem', fontSize: '0.74rem', fontWeight: 800, background: '#10b981', borderColor: '#059669' }}
                        >
                          🔊 AI Speak Whisper
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            navigator.clipboard.writeText(whisperScriptText);
                            setCopiedWhisper(true);
                            setTimeout(() => setCopiedWhisper(false), 2000);
                          }}
                          style={{ padding: '0.2rem 0.55rem', fontSize: '0.74rem', fontWeight: 700 }}
                        >
                          {copiedWhisper ? '✅ Copied Whisper!' : '📋 Copy Whisper Script'}
                        </button>
                      </div>
                    </div>
                    <div style={{ fontStyle: 'italic', color: '#fff', lineHeight: 1.5 }}>
                      "{whisperScriptText}"
                    </div>
                  </div>

                  <div style={{ background: 'rgba(16,185,129,0.14)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem', flexWrap: 'wrap', gap: '0.35rem' }}>
                      <div style={{ fontWeight: 800, color: '#34d399', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                        3. 🤝 3-Way Merge Introduction (Say Once Lines Are Merged):
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          navigator.clipboard.writeText(mergeScriptText);
                          setCopiedMerge(true);
                          setTimeout(() => setCopiedMerge(false), 2000);
                        }}
                        style={{ padding: '0.2rem 0.55rem', fontSize: '0.74rem', fontWeight: 700 }}
                      >
                        {copiedMerge ? '✅ Copied Merge!' : '📋 Copy Merge Intro'}
                      </button>
                    </div>
                    <div style={{ fontStyle: 'italic', color: '#fff', lineHeight: 1.5 }}>
                      "{mergeScriptText}"
                    </div>
                  </div>
                </div>
              </div>

              {/* Path B: When King Amen Ra is on a Warm Transfer Call (Executive Alternative-Choice Appointment Close) */}
              <div style={{ backgroundColor: '#111c3a', border: '1.5px solid #3b82f6', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#60a5fa', margin: '0 0 0.65rem', fontSize: '1rem', fontWeight: 800 }}>
                  Path B — Executive Alternative-Choice Appointment Close (When King is on a Warm Transfer):
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.88rem', color: '#e2e8f0' }}>
                  <p style={{ margin: 0, background: '#16244d', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #f59e0b' }}>
                    👉 <strong>Say to {displayName}:</strong> "Because <strong>King Amen Ra</strong> is currently on a live consultation helping another family with their 2027 benefits, I want to reserve a dedicated one-on-one time for you on his private calendar so you receive his undivided attention. Do you prefer a <strong>30-minute Telephone consultation</strong>, a <strong>60-minute In-Person visit</strong>, or a <strong>30-minute Video consultation</strong>—and would <strong>morning or afternoon</strong> work best for you?"
                  </p>
                  <p style={{ margin: 0, background: '#16244d', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                    👉 <strong>Confirm & Continue Calling:</strong> "Wonderful, <strong>{displayName}</strong>! I have reserved your <strong>[Telephone / In-Person / Video]</strong> consultation with Principal Broker <strong>King Amen Ra</strong> for <strong>[Day & Time]</strong>. Please have your current prescription list and doctors' names handy so we can prepare your custom 2027 comparison in advance. It has been a pleasure helping you today!"
                  </p>
                </div>

                {onScheduleClick && (
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      onClose();
                      onScheduleClick();
                    }}
                    style={{ width: '100%', marginTop: '0.85rem', padding: '0.85rem', fontWeight: 800, fontSize: '0.95rem' }}
                  >
                    📅 Book Telephone, In-Person, or Video Appointment & Continue Calling
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: 6-PRODUCT-LINE FUNNEL & EMPATHY-FIRST FIDUCIARY REBUTTALS */}
          {activeStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#c8963e', margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>
                  6-Product-Line Inbound/Outbound Funnel & Empathy-First Fiduciary Rebuttals
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '0.9rem', border: '1px solid #243566', fontSize: '0.84rem', color: '#e2e8f0' }}>
                    <div style={{ fontWeight: 800, color: '#ffd88a', marginBottom: '0.45rem' }}>
                      🏢 All 6 Product Line Funnel Scripts (After Greeting: "Thank you for calling IWG Insurance and Financial Services... How may I direct your call?"):
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <li><strong>1. Medicare Plans (2027 Changes):</strong> "You’ve reached the right place. We are a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. To give you the most accurate guidance on your Medicare options, would you like to review the new 2027 Medicare changes—including the $2,400 prescription cap and side-by-side Medigap vs. Advantage comparisons—with our Principal Broker, King Amen Ra, right now?"</li>
                      <li><strong>2. Individual & Family Health (ACA & Private PPO):</strong> "We would be honored to help you and your family. As a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees, we compare both ACA tax-credit plans and nationwide private PPO networks to protect your doctors and lower your monthly premium. May I connect you with a licensed specialist now to check if you qualify for a $0 or reduced-cost plan?"</li>
                      <li><strong>3. Group Health (1–50+ Employees / Level-Funded / ICHRA):</strong> "We would love to support your business. As an independent fiduciary advisory representing over 104 premier carriers, we design Level-Funded and ICHRA corporate benefit plans that typically save employers 15% to 30% while refunding unused claims reserves back to your business. May I connect you with King Amen Ra for a complimentary corporate benefits audit?"</li>
                      <li><strong>4. Investment Grade Life Insurance (IUL / Section 7702):</strong> "We specialize in institutional-grade wealth protection. Representing over 104 premier carriers, we structure high cash-value Indexed Universal Life policies under IRS Section 7702 that deliver tax-free retirement income with a contractual 0% downside market floor. Would you like me to connect you with King Amen Ra to design your custom tax-free retirement illustration?"</li>
                      <li><strong>5. Asset-Based Long Term Care (Hybrid Life + LTC):</strong> "Protecting your life savings and dignity is at the heart of what we do. We represent over 104 premier carriers offering modern 'use-it-or-leave-it' Asset-Based Long Term Care—paying tax-free benefits for home health or assisted living if you need care, or returning 100% of the benefit tax-free to your family if you never use it. Would you like to review a custom asset-protection strategy with King Amen Ra now?"</li>
                      <li><strong>6. Modern Term Life (with Built-In Living Benefits):</strong> "We make protecting your family effortless. Representing over 104 premier carriers, our Modern Term Life policies lock in guaranteed level rates with 15-minute no-exam digital approvals—and include built-in Living Benefits that pay cash while you are alive in the event of a critical or chronic illness. May I connect you now to compare your lowest wholesale rates?"</li>
                    </ul>
                  </div>

                  {/* Objection 1 */}
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '0.9rem', border: '1px solid #243566' }}>
                    <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.35rem', fontSize: '0.86rem' }}>
                      ❌ 1. "I’m happy with my current plan / I don’t want to change."
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#e2e8f0', background: 'rgba(255,255,255,0.03)', padding: '0.7rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      "I love hearing that, <strong>{displayName}</strong>, and our goal is never to move you if your current plan is still the #1 option for you. Because insurance carriers adjust their doctor networks, drug tiers, and copays for 2027, our free 5-minute fiduciary audit simply confirms in writing that your current plan still gives you the highest benefits at the lowest cost—and if it does, we tell you to stay right where you are. Let’s have <strong>King Amen Ra</strong> verify that for your peace of mind, fair enough?"
                    </div>
                  </div>

                  {/* Objection 2 */}
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '0.9rem', border: '1px solid #243566' }}>
                    <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.35rem', fontSize: '0.86rem' }}>
                      ❌ 2. "How much does this cost? / What is the catch?"
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#e2e8f0', background: 'rgba(255,255,255,0.03)', padding: '0.7rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      "There is never a fee, markup, or obligation—ever. By federal law, Medicare and insurance premiums are fixed, meaning you pay the exact same rate whether you navigate 104 carriers alone or have our Principal Broker <strong>King Amen Ra</strong> and clinical leadership under <strong>Aneesha Sullivan, PA</strong> advocate for you year-round for free."
                    </div>
                  </div>

                  {/* Objection 3 */}
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '0.9rem', border: '1px solid #243566' }}>
                    <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.35rem', fontSize: '0.86rem' }}>
                      ❌ 3. "I already have a broker / agent."
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#e2e8f0', background: 'rgba(255,255,255,0.03)', padding: '0.7rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      "That is wonderful—having an advocate is so important. Many of our clients keep their current plan until they ask us for a complimentary second opinion across all 104+ national carriers, since many agents only represent a handful of companies. It takes 3 minutes to verify you aren't overpaying for 2027—would you be open to a quick, no-obligation second look?"
                    </div>
                  </div>

                  {/* Objection 4 */}
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '0.9rem', border: '1px solid #243566' }}>
                    <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.35rem', fontSize: '0.86rem' }}>
                      ❌ 4. "Just mail me something / I’m busy right now."
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#e2e8f0', background: 'rgba(255,255,255,0.03)', padding: '0.7rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      "I completely respect your time, <strong>{displayName}</strong>. Because there are over 104 carriers, mailing a stack of generic brochures wouldn't show which plan covers your specific doctors and prescriptions. Instead, let’s lock in a quick <strong>Telephone</strong>, <strong>In-Person</strong>, or <strong>Video</strong> appointment at a time that is convenient for you, and we’ll prepare your custom 1-page summary in advance. Does tomorrow morning or afternoon work better?"
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
