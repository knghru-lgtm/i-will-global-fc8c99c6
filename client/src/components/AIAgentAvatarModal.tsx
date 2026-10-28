import React, { useState } from 'react';
import { api } from '../lib/api';

interface AIAgentAvatarModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialName?: string;
  initialZip?: string;
  initialPhone?: string;
  initialEmail?: string;
}

export const AIAgentAvatarModal: React.FC<AIAgentAvatarModalProps> = ({
  isOpen,
  onClose,
  initialName = 'Beneficiary Prospect',
  initialZip = '85251',
  initialPhone = '(480) 331-9455',
  initialEmail = 'client@example.com',
}) => {
  const [activeStep, setActiveStep] = useState<number>(1);

  // Form State
  const [beneficiaryName, setBeneficiaryName] = useState<string>(initialName);
  const [zipCode, setZipCode] = useState<string>(initialZip);
  const [phone, setPhone] = useState<string>(initialPhone);
  const [email, setEmail] = useState<string>(initialEmail);
  const [hasMedicaid, setHasMedicaid] = useState<boolean>(false);
  const [needsTransportation, setNeedsTransportation] = useState<boolean>(true);
  const [doctorInput, setDoctorInput] = useState<string>('Dr. Smith (Banner Health), Mayo Clinic');
  const [prescriptionInput, setPrescriptionInput] = useState<string>('Eliquis, Metformin, Lisinopril');
  const [supplementalPriorities, setSupplementalPriorities] = useState<string[]>(['dental', 'groceries', 'transportation']);

  // Analysis State
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [enrolling, setEnrolling] = useState<boolean>(false);
  const [enrolledResult, setEnrolledResult] = useState<any>(null);

  if (!isOpen) return null;

  const handleRunAnalysis = async () => {
    setAnalyzing(true);
    setActiveStep(5);
    try {
      const doctors = doctorInput.split(',').map((s) => s.trim()).filter(Boolean);
      const prescriptions = prescriptionInput.split(',').map((s) => s.trim()).filter(Boolean);

      const res = await api.post('/ai/avatar/analysis', {
        beneficiaryName,
        phone,
        email,
        zipCode,
        hasMedicare: true,
        hasMedicaid,
        needsTransportation,
        doctors,
        prescriptions,
        supplementalPriorities,
      });

      setAnalysisResult(res);
    } catch (err: any) {
      alert(`AI Analysis error: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleEnroll = async (plan: any) => {
    setEnrolling(true);
    try {
      const res = await api.post('/ai/avatar/enroll', {
        beneficiaryName,
        phone,
        email,
        zipCode,
        planId: plan.id,
        carrier: plan.carrier,
        planName: plan.planName,
      });
      setEnrolledResult(res);
    } catch (err: any) {
      alert(`Enrollment submission failed: ${err.message}`);
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal-card"
        style={{
          maxWidth: '850px',
          width: '92%',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#0b132b',
          color: '#fff',
          border: '1px solid #243566',
          borderRadius: '16px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with AI Licensed Agent Avatar Photo */}
        <div style={{ background: '#111c3a', borderBottom: '1px solid #243566', padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '16px 16px 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {/* Animated Avatar Frame */}
            <div style={{ position: 'relative' }}>
              <img
                src="/avatar_agent.png"
                alt="AI Licensed Agent Avatar"
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '3px solid #3b82f6',
                  boxShadow: '0 0 15px rgba(59,130,246,0.5)',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  bottom: '0',
                  right: '0',
                  width: '16px',
                  height: '16px',
                  backgroundColor: '#10b981',
                  borderRadius: '50%',
                  border: '2px solid #0b132b',
                }}
                title="AI Avatar Active"
              />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: '1.2rem', color: '#c8963e' }}>
                  AI Licensed Agent Avatar
                </h3>
                <span style={{ fontSize: '0.72rem', background: 'rgba(59,130,246,0.2)', color: '#60a5fa', border: '1px solid #3b82f6', borderRadius: '12px', padding: '0.15rem 0.5rem', fontWeight: 700 }}>
                  NPN: 19842011 · iWillGlobal
                </span>
              </div>
              <div style={{ fontSize: '0.83rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Automated Needs & Benefits Analysis · Plan Comparison & Quotes Engine
              </div>
            </div>
          </div>

          <button className="btn btn-secondary" onClick={onClose} style={{ padding: '0.35rem 0.75rem', borderColor: '#243566' }}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Avatar Live Audio Greeting Bar */}
          <div style={{ background: '#16244d', border: '1px solid #243566', borderRadius: '12px', padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ fontSize: '1.5rem' }}>🎙️</div>
            <div style={{ flex: 1, fontSize: '0.88rem', lineHeight: 1.5, color: '#e2e8f0', fontStyle: 'italic' }}>
              "Hello! I am your AI Licensed Agent Avatar for I Will Global. I will perform a complete Medicare needs analysis for <strong>{beneficiaryName}</strong> in Zip <strong>{zipCode}</strong>, checking doctor networks, prescription formularies, transportation, Medicaid (AHCCCS) eligibility, and supplemental benefits!"
            </div>
          </div>

          {/* Stepper Header */}
          <div style={{ display: 'flex', gap: '0.4rem', background: '#111c3a', padding: '0.4rem', borderRadius: '10px' }}>
            {[
              { step: 1, label: '1. Zip & Dual' },
              { step: 2, label: '2. Doctors' },
              { step: 3, label: '3. Prescriptions' },
              { step: 4, label: '4. Transport & Benefits' },
              { step: 5, label: '5. Compare & Enroll' },
            ].map((s) => (
              <button
                key={s.step}
                className={`btn ${activeStep === s.step ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveStep(s.step)}
                style={{ flex: 1, padding: '0.45rem 0.2rem', fontSize: '0.78rem', fontWeight: 700 }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* STEP 1 */}
          {activeStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: '#111c3a', padding: '1.25rem', borderRadius: '12px', border: '1px solid #243566' }}>
              <h4 style={{ color: '#c8963e', margin: 0, fontWeight: 700 }}>Step 1: Beneficiary Profile & Dual Eligibility Status</h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>Beneficiary Full Name</label>
                  <input type="text" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', background: '#0e1838', border: '1px solid #243566', color: '#fff' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>Zip Code (County Search)</label>
                  <input type="text" value={zipCode} onChange={(e) => setZipCode(e.target.value)} style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', background: '#0e1838', border: '1px solid #243566', color: '#fff' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>Phone Number</label>
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', background: '#0e1838', border: '1px solid #243566', color: '#fff' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>Email Address</label>
                  <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', background: '#0e1838', border: '1px solid #243566', color: '#fff' }} />
                </div>
              </div>

              {/* Dual Eligibility Card */}
              <div style={{ background: '#16244d', padding: '1rem', borderRadius: '10px', border: '1px solid #3b82f6' }}>
                <div style={{ fontWeight: 700, color: '#60a5fa', marginBottom: '0.4rem', fontSize: '0.92rem' }}>
                  🛡️ Dual Eligibility Check (Medicare + AHCCCS / Medicaid)
                </div>
                <div style={{ fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '0.75rem' }}>
                  Does the beneficiary have both Medicare Part A/B AND AHCCCS / Medicaid state assistance?
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    type="button"
                    className={`btn ${hasMedicaid ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setHasMedicaid(true)}
                    style={{ flex: 1, padding: '0.6rem', fontWeight: 700 }}
                  >
                    ✅ YES (Medicare + AHCCCS Dual Qualified)
                  </button>
                  <button
                    type="button"
                    className={`btn ${!hasMedicaid ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setHasMedicaid(false)}
                    style={{ flex: 1, padding: '0.6rem', fontWeight: 700 }}
                  >
                    ❌ NO (Medicare Only)
                  </button>
                </div>
              </div>

              <button className="btn btn-primary" onClick={() => setActiveStep(2)} style={{ padding: '0.75rem', fontWeight: 700 }}>
                Next: Doctor & Provider Network Check →
              </button>
            </div>
          )}

          {/* STEP 2 */}
          {activeStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: '#111c3a', padding: '1.25rem', borderRadius: '12px', border: '1px solid #243566' }}>
              <h4 style={{ color: '#c8963e', margin: 0, fontWeight: 700 }}>Step 2: Doctors, Specialists & Preferred Hospitals</h4>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
                Enter primary care doctors, specialists, or medical groups so the AI Avatar can verify carrier in-network status.
              </p>

              <div>
                <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>Doctors & Hospital Networks (Comma separated)</label>
                <textarea
                  rows={3}
                  value={doctorInput}
                  onChange={(e) => setDoctorInput(e.target.value)}
                  placeholder="e.g. Dr. John Smith, Banner Health, Mayo Clinic, HonorHealth..."
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: '#0e1838', border: '1px solid #243566', color: '#fff', fontSize: '0.9rem' }}
                />
              </div>

              <div style={{ background: '#16244d', padding: '0.85rem', borderRadius: '8px', fontSize: '0.82rem', color: '#60a5fa' }}>
                💡 <strong>AI Verification:</strong> The AI Avatar cross-references doctor NPIs with carrier directories for Humana, UHC, BCBS, Devoted, Wellcare, Cigna, and Aetna.
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={() => setActiveStep(1)} style={{ padding: '0.75rem' }}>← Back</button>
                <button className="btn btn-primary" onClick={() => setActiveStep(3)} style={{ flex: 1, padding: '0.75rem', fontWeight: 700 }}>Next: Prescriptions & Formularies →</button>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {activeStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: '#111c3a', padding: '1.25rem', borderRadius: '12px', border: '1px solid #243566' }}>
              <h4 style={{ color: '#c8963e', margin: 0, fontWeight: 700 }}>Step 3: Prescription Medications & Formulary Tiers</h4>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
                Enter current prescription drugs so the AI Avatar can calculate annual out-of-pocket medication costs ($0 tier 1/2 copays).
              </p>

              <div>
                <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>Current Prescription Medications (Comma separated)</label>
                <textarea
                  rows={3}
                  value={prescriptionInput}
                  onChange={(e) => setPrescriptionInput(e.target.value)}
                  placeholder="e.g. Eliquis 5mg, Metformin 500mg, Lisinopril 10mg, Atorvastatin 20mg..."
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: '#0e1838', border: '1px solid #243566', color: '#fff', fontSize: '0.9rem' }}
                />
              </div>

              <div style={{ background: '#16244d', padding: '0.85rem', borderRadius: '8px', fontSize: '0.82rem', color: '#34d399' }}>
                💊 <strong>Formulary Protection:</strong> Ensures 100% of medications are covered with $0 copay at preferred mail-order or local retail pharmacies.
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={() => setActiveStep(2)} style={{ padding: '0.75rem' }}>← Back</button>
                <button className="btn btn-primary" onClick={() => setActiveStep(4)} style={{ flex: 1, padding: '0.75rem', fontWeight: 700 }}>Next: Transportation & Supplemental Benefits →</button>
              </div>
            </div>
          )}

          {/* STEP 4 */}
          {activeStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: '#111c3a', padding: '1.25rem', borderRadius: '12px', border: '1px solid #243566' }}>
              <h4 style={{ color: '#c8963e', margin: 0, fontWeight: 700 }}>Step 4: Non-Emergency Transportation & Supplemental Benefits</h4>

              {/* Transportation Section */}
              <div style={{ background: '#16244d', padding: '1rem', borderRadius: '10px', border: '1px solid #10b981' }}>
                <div style={{ fontWeight: 700, color: '#34d399', marginBottom: '0.4rem', fontSize: '0.92rem' }}>
                  🚌 Medical Transportation Needs
                </div>
                <div style={{ fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '0.75rem' }}>
                  Does the beneficiary require non-emergency medical rides to doctor appointments, pharmacies, or clinics?
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    type="button"
                    className={`btn ${needsTransportation ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setNeedsTransportation(true)}
                    style={{ flex: 1, padding: '0.6rem', fontWeight: 700 }}
                  >
                    🚗 YES (Include 24 - 48 Medical Rides/Yr)
                  </button>
                  <button
                    type="button"
                    className={`btn ${!needsTransportation ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setNeedsTransportation(false)}
                    style={{ flex: 1, padding: '0.6rem', fontWeight: 700 }}
                  >
                    ❌ NO (No Transportation Required)
                  </button>
                </div>
              </div>

              {/* Supplemental Priorities */}
              <div>
                <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>Select Key Supplemental Priorities:</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                  {[
                    { id: 'dental', label: '🦷 Dental ($3k-$4k)' },
                    { id: 'groceries', label: '🛒 Grocery Card ($60-$90/mo)' },
                    { id: 'transportation', label: '🚐 Transportation Rides' },
                    { id: 'vision', label: '👓 Vision & Glasses' },
                    { id: 'hearing', label: '👂 Hearing Aids' },
                    { id: 'gym', label: '🏋️ SilverSneakers Gym' },
                  ].map((p) => {
                    const isSelected = supplementalPriorities.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`btn ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => {
                          if (isSelected) setSupplementalPriorities(supplementalPriorities.filter((x) => x !== p.id));
                          else setSupplementalPriorities([...supplementalPriorities, p.id]);
                        }}
                        style={{ padding: '0.5rem', fontSize: '0.78rem', fontWeight: 600 }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button className="btn btn-secondary" onClick={() => setActiveStep(3)} style={{ padding: '0.75rem' }}>← Back</button>
                <button
                  className="btn btn-accent"
                  onClick={handleRunAnalysis}
                  style={{ flex: 1, padding: '0.85rem', fontWeight: 800, fontSize: '0.95rem' }}
                >
                  ⚡ Run AI Avatar Needs Analysis & Compare Plans →
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: COMPARISON MATRIX & ENROLLMENT */}
          {activeStep === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {analyzing ? (
                <div style={{ textAlign: 'center', padding: '3rem', background: '#111c3a', borderRadius: '12px', border: '1px solid #243566' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '1rem', animation: 'spin 1s linear infinite' }}>🤖</div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#c8963e' }}>
                    AI Licensed Agent Avatar is Analyzing Medicare Plans in Zip {zipCode}...
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                    Comparing Doctor Networks, Formularies, Transportation, and Spendables Allowances for {beneficiaryName}
                  </div>
                </div>
              ) : enrolledResult ? (
                <div style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid #10b981', borderRadius: '14px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ fontSize: '2rem' }}>🎉</div>
                    <div>
                      <h3 style={{ margin: 0, color: '#34d399', fontWeight: 800 }}>Enrollment Submitted Successfully!</h3>
                      <div style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>
                        Enrolled under Principal Licensed Agent (NPN 19842011) via iwillglobal.com Quotes
                      </div>
                    </div>
                  </div>

                  <div style={{ background: '#0e1838', padding: '1rem', borderRadius: '10px', fontSize: '0.88rem' }}>
                    <div>Client: <strong>{enrolledResult.client?.first_name} {enrolledResult.client?.last_name}</strong></div>
                    <div>Carrier: <strong style={{ color: '#c8963e' }}>{enrolledResult.policy?.carrier}</strong> ({enrolledResult.policy?.plan_name})</div>
                    <div>Policy Number: <strong>{enrolledResult.policy?.policy_number}</strong></div>
                    <div>Status: <span style={{ color: '#34d399', fontWeight: 700 }}>{enrolledResult.policy?.status}</span></div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <a href={enrolledResult.quoteUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ textDecoration: 'none', flex: 1, textAlign: 'center', padding: '0.75rem', fontSize: '0.88rem', fontWeight: 700 }}>
                      🌐 View Quote Page on iwillglobal.com
                    </a>
                    <button className="btn btn-primary" onClick={onClose} style={{ padding: '0.75rem 1.5rem' }}>
                      Done & View Client Record
                    </button>
                  </div>
                </div>
              ) : analysisResult ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* Analysis Summary Box */}
                  <div style={{ background: '#111c3a', border: '1px solid #243566', borderRadius: '12px', padding: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <h4 style={{ color: '#c8963e', margin: 0, fontWeight: 700 }}>
                        📊 AI Avatar Needs Analysis Results for {analysisResult.beneficiaryName}
                      </h4>
                      <span style={{ fontSize: '0.8rem', background: '#10b981', color: '#fff', padding: '0.2rem 0.6rem', borderRadius: '12px', fontWeight: 700 }}>
                        Zip: {analysisResult.zipCode}
                      </span>
                    </div>

                    <p style={{ fontSize: '0.88rem', lineHeight: 1.6, color: '#e2e8f0', margin: 0, background: '#16244d', padding: '0.85rem', borderRadius: '8px' }}>
                      "{analysisResult.summaryScript}"
                    </p>
                  </div>

                  {/* Plan Comparison Grid */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <h4 style={{ margin: 0, fontSize: '1rem', color: '#60a5fa', fontWeight: 700 }}>
                      Top Recommended Medicare Plans (Ranked by Match Score)
                    </h4>

                    {analysisResult.plans.map((plan: any, idx: number) => (
                      <div
                        key={plan.id}
                        style={{
                          background: idx === 0 ? 'linear-gradient(135deg, #111c3a 0%, #162a5c 100%)' : '#111c3a',
                          border: idx === 0 ? '2px solid #c8963e' : '1px solid #243566',
                          borderRadius: '14px',
                          padding: '1.25rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.85rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            {idx === 0 && (
                              <span style={{ background: '#c8963e', color: '#000', fontSize: '0.72rem', fontWeight: 800, padding: '0.15rem 0.5rem', borderRadius: '10px', textTransform: 'uppercase', display: 'inline-block', marginBottom: '0.3rem' }}>
                                🏆 #1 AI Top Recommendation
                              </span>
                            )}
                            <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#fff' }}>
                              {plan.carrier} — {plan.planName}
                            </h4>
                            <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                              Type: {plan.planType} · Premium: ${plan.monthlyPremium}/mo · MOOP: ${plan.maxOutOfPocket}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: plan.overallMatchPct >= 90 ? '#34d399' : '#60a5fa' }}>
                              {plan.overallMatchPct}% Match
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Doctor & Drug Match</div>
                          </div>
                        </div>

                        {/* Feature Badges */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.82rem', color: '#e2e8f0', background: '#0e1838', padding: '0.75rem', borderRadius: '8px' }}>
                          <div>🚌 <strong>Transportation:</strong> {plan.transportationRides}</div>
                          <div>🦷 <strong>Dental:</strong> {plan.dentalAllowance}</div>
                          <div>🛒 <strong>Spendables Card:</strong> {plan.spendablesMonthly}</div>
                          <div>💊 <strong>Prescriptions:</strong> {plan.prescriptionCopay}</div>
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
                          <button
                            className="btn btn-primary"
                            onClick={() => handleEnroll(plan)}
                            disabled={enrolling}
                            style={{ flex: 1, padding: '0.75rem', fontWeight: 800, fontSize: '0.92rem' }}
                          >
                            {enrolling ? 'Submitting Enrollment...' : `🏆 Enroll Now via iwillglobal.com Quotes (NPN 19842011)`}
                          </button>
                          <a
                            href={plan.enrollmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary"
                            style={{ textDecoration: 'none', padding: '0.75rem 1rem', fontSize: '0.85rem', fontWeight: 700 }}
                          >
                            🔗 Direct Quote Link
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
