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

  const whisperScriptText = `Hi King Amen Ra, this is Sarah AI whispering automatically on behalf of ${agentName} with the Medicare Helpline powered by IWG Insurance and Financial Services. I have ${displayName} on the line asking about the 2027 Medicare changes and plan review. Merging the call automatically now so you can take over!`;
  const mergeScriptText = `Thank you so much for holding, ${displayName}! I now have King Amen Ra, our Principal Broker and Licensed Senior Advisor at IWG Insurance and Financial Services, right here on the line with both of us. King, Sarah AI has automatically whispered the briefing on ${displayName}'s 2027 Medicare coverage goals, so I will step back and let you two take it from here!`;

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
                  Step 1: Required Opening Greeting & 2027 Changes Script (Unified for All Callers & Sarah AI)
                </h4>

                <div style={{ fontSize: '0.92rem', lineHeight: 1.6, color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ background: 'rgba(200,150,62,0.12)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #c8963e' }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#ffd88a', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                      1. Mandatory Opening Sentence (Word-for-Word):
                    </div>
                    <p style={{ margin: '0 0 0.35rem', fontWeight: 700, color: '#fff', fontSize: '0.96rem' }}>
                      "Hello <strong>{displayName}</strong>, this is <strong>{agentName}</strong> calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"
                    </p>
                    <div style={{ fontSize: '0.76rem', color: '#cbd5e1', fontStyle: 'italic' }}>
                      Template: "Hello [Prospect Name], this is [Caller Name / Sarah] calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"
                    </div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #38bdf8' }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                      2. Fiduciary Value Statement:
                    </div>
                    <p style={{ margin: 0, fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>
                      "We are a 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. To give you the most accurate information about Medicare plans."
                    </p>
                  </div>

                  <div style={{ background: 'rgba(16,185,129,0.12)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#34d399', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                      3. 2027 Changes Question & Automatic AI Whisper Transfer:
                    </div>
                    <p style={{ margin: '0 0 0.6rem', fontWeight: 800, color: '#6ee7b7', fontSize: '1.02rem' }}>
                      "Would you like to know about the changes for 2027?"
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
                  💡 All 6 Divisions & Objection Rebuttals
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: SARAH'S 2027 MEDICARE COST STANDARDS & PLAN COMPARISON */}
          {activeStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#c8963e', margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>
                  Step 2: Sarah's 2027 Medicare Cost Standards & Plan Comparison Script
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.88rem', color: '#e2e8f0', lineHeight: 1.55 }}>
                  <div style={{ background: '#16244d', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #c8963e' }}>
                    <strong style={{ color: '#ffd88a' }}>🏥 2027 Original Medicare (Parts A & B) Cost Standards:</strong>
                    <ul style={{ margin: '0.4rem 0 0 1.2rem', padding: 0 }}>
                      <li><strong>Part A (Hospital):</strong> <strong>$0/month premium</strong> for 99%+ of beneficiaries; <strong>$1,788</strong> inpatient hospital deductible per benefit period.</li>
                      <li><strong>Part B (Medical):</strong> <strong>$209.50/month</strong> projected standard premium; <strong>$292</strong> annual deductible; <strong>20% coinsurance with NO annual out-of-pocket maximum cap</strong> on Original Medicare alone.</li>
                      <li><strong>Part D (Prescription Drugs):</strong> <strong>$2,400</strong> annual out-of-pocket maximum cap; <strong>$700</strong> maximum deductible; <strong>$35/month</strong> insulin cap; <strong>$0</strong> adult ACIP-recommended vaccines.</li>
                    </ul>
                  </div>

                  <div style={{ background: '#16244d', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #38bdf8' }}>
                    <strong style={{ color: '#38bdf8' }}>🛡️ Medigap Supplement (Plan G vs. Plan N) vs. Medicare Advantage (Part C):</strong>
                    <p style={{ margin: '0.4rem 0 0' }}>
                      "Because Original Medicare leaves an uncapped 20% exposure, we compare your two main protection paths side-by-side:<br />
                      • <strong>Medigap Plan G:</strong> Covers 100% of Medicare-approved gaps after the $292 Part B deductible with nationwide freedom to visit any doctor or hospital that accepts Medicare—no networks and no referrals.<br />
                      • <strong>Medigap Plan N:</strong> Lower monthly premium in exchange for modest copays (up to $20 doctor / $50 ER).<br />
                      • <strong>Medicare Advantage (Part C) & Special Needs Plans (D-SNP, C-SNP, I-SNP):</strong> All-in-one plans that bundle Part A, Part B, and Part D with a built-in Maximum Out-of-Pocket cap and extra dental, vision, hearing, and OTC benefits."
                    </p>
                  </div>

                  <div style={{ background: 'rgba(16,185,129,0.14)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #10b981', color: '#6ee7b7', fontWeight: 700 }}>
                    👉 Closing Question (Say This): "Would you like a personalized plan comparison or quote with our Principal Broker, King Amen Ra, right now?"
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-accent"
                  onClick={() => {
                    setActiveStep(3);
                    setIsWarmTransferOpen(true);
                  }}
                  style={{ flex: 1, padding: '0.85rem', fontWeight: 800, fontSize: '0.92rem' }}
                >
                  ⚡ Launch Whisper Warm Transfer to King Amen Ra →
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
                    Path A — When King Amen Ra is Available: Live Whisper Warm Transfer ((602) 456-9681)
                  </h4>
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => setIsWarmTransferOpen(true)}
                    style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem', fontWeight: 800 }}
                  >
                    ⚡ Open 3-Way Whisper Transfer Modal
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.88rem', color: '#e2e8f0' }}>
                  <div style={{ background: '#16244d', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #38bdf8' }}>
                    <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '0.78rem', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                      1. Say to {displayName} Before Placing on Hold:
                    </div>
                    <em>
                      "I am connecting you right now directly with <strong>King Amen Ra</strong>, our Principal Broker and Licensed Senior Advisor. Please stay on the line for just a moment while I whisper a quick briefing to him and bridge your call."
                    </em>
                  </div>

                  <div style={{ background: 'rgba(200,150,62,0.14)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #c8963e' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                      <div style={{ fontWeight: 800, color: '#ffd88a', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                        2. 🤫 Whisper Transfer Briefing to King Amen Ra on Line 2 ((602) 456-9681):
                      </div>
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
                    <div style={{ fontStyle: 'italic', color: '#fff', lineHeight: 1.5 }}>
                      "{whisperScriptText}"
                    </div>
                  </div>

                  <div style={{ background: 'rgba(16,185,129,0.14)', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
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

              {/* Path B: When King Amen Ra is on a Warm Transfer Call (Appointment-Only Mode) */}
              <div style={{ backgroundColor: '#111c3a', border: '1.5px solid #3b82f6', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#60a5fa', margin: '0 0 0.65rem', fontSize: '1rem', fontWeight: 800 }}>
                  Path B — When King Amen Ra is on a Warm Transfer Call (Or Prospect Prefers to Schedule):
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.88rem', color: '#e2e8f0' }}>
                  <p style={{ margin: 0, background: '#16244d', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #f59e0b' }}>
                    👉 <strong>Say to {displayName}:</strong> "King Amen Ra, our Principal Broker and Licensed Senior Advisor, is currently on a live warm transfer call helping another client right now, so I will get you scheduled right on his calendar. Would you prefer a <strong>Telephone appointment (30 minutes)</strong>, an <strong>In-Person appointment (60 minutes)</strong>, or a <strong>Video appointment (30 minutes)</strong> with King Amen Ra?"
                  </p>
                  <p style={{ margin: 0, background: '#16244d', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                    👉 <strong>Confirm & Continue Calling:</strong> "Wonderful! I have you confirmed for your <strong>[Telephone / In-Person / Video]</strong> appointment with King Amen Ra on <strong>[Day & Time]</strong>. Please have your current prescription list and doctors' names handy. Thank you, <strong>{displayName}</strong>, and have a wonderful day!"
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

          {/* STEP 4: SARAH'S 6 DIVISIONS & OBJECTION REBUTTALS */}
          {activeStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '12px', padding: '1.25rem' }}>
                <h4 style={{ color: '#c8963e', margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>
                  Sarah's 6 Insurance Divisions & Common Objection Rebuttals
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '0.9rem', border: '1px solid #243566', fontSize: '0.85rem', color: '#e2e8f0' }}>
                    <div style={{ fontWeight: 800, color: '#ffd88a', marginBottom: '0.35rem' }}>
                      🏢 Non-Medicare Divisions (When Caller Asks About Other Coverage):
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.5 }}>
                      <li><strong>Individual & Family Health (Under 65):</strong> ACA Marketplace plans with tax credits vs. Private PPO medically underwritten plans with nationwide networks.</li>
                      <li><strong>Group Health (2–250+ Employees):</strong> Level-Funded plans with refund of unused claim surplus, Traditional Group Major Medical, or tax-free ICHRA.</li>
                      <li><strong>Life Insurance & IUL:</strong> Term Life, Final Expense Whole Life, and Tax-Free Retirement Indexed Universal Life (IUL) structured under IRC Section 7702 with 0% market floor.</li>
                      <li><strong>Asset-Based Hybrid Long-Term Care:</strong> Linked Life + LTC policies that pay tax-free monthly care benefits or return a tax-free death benefit to heirs if care is never needed.</li>
                    </ul>
                  </div>

                  {/* Objection 1 */}
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '1rem', border: '1px solid #243566' }}>
                    <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.4rem', fontSize: '0.88rem' }}>
                      ❌ "I’m happy with my current plan and don’t want to change."
                    </div>
                    <div style={{ fontSize: '0.88rem', color: '#e2e8f0', background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      "That’s great to hear, <strong>{displayName}</strong>, and staying right where you are may very well be the best choice. Because we are a 100% free fiduciary advisory representing over 104 carriers, our review simply checks that your doctors and prescriptions are still covered at the lowest cost for 2027 so there are no surprise bills in January."
                    </div>
                  </div>

                  {/* Objection 2 */}
                  <div style={{ background: '#16244d', borderRadius: '10px', padding: '1rem', border: '1px solid #243566' }}>
                    <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.4rem', fontSize: '0.88rem' }}>
                      ❌ "How much does your service cost?"
                    </div>
                    <div style={{ fontSize: '0.88rem', color: '#e2e8f0', background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      "Our advisory service is <strong>100% free</strong> with zero broker fees and zero markup. Medicare and insurance carriers regulate plan rates by law, so you pay the exact same premium whether you enroll alone or have our Principal Broker, King Amen Ra, advocate for you year-round."
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
