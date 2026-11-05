import React from 'react';
import { Link } from 'react-router-dom';
import { 
  ShieldCheck, 
  Scale, 
  HeartHandshake, 
  Award, 
  CheckCircle2, 
  PhoneCall, 
  ArrowRight, 
  FileText, 
  Sparkles, 
  Users, 
  Check,
  Building,
  Heart,
  Play
} from 'lucide-react';
import './About.css';
import './Page.css';
import { PublicTeamDirectorySection } from '../components/PublicTeamDirectorySection';

const CARRIERS = [
  'UnitedHealthcare',
  'Humana',
  'Aetna',
  'Cigna Healthcare',
  'Blue Cross Blue Shield',
  'Wellcare',
  'Devoted Health',
  'Mutual of Omaha',
  'Anthem',
  'SilverScript'
];

const About = () => {

  return (
    <div className="about-page animate-fade-in">
      {/* Executive Hero Header */}
      <section className="about-hero">
        <div className="about-hero-bg"></div>
        <div className="container about-hero-content">
          <div className="about-eyebrow">
            <Sparkles size={14} /> Premier Independent Healthcare Advisory & Multi-Line Brokerage
          </div>
          <h1>
            Empowering Your Health & Wealth with <span>Clarity & Trust</span>
          </h1>
          <p className="about-hero-lead">
            Navigating Medicare, health insurance, and wealth protection should never feel overwhelming. I Will Global stands as your dedicated advocate—providing world-class, unbiased guidance across 104+ leading national carriers with zero broker fees and complete peace of mind.
          </p>
          <div className="about-hero-actions">
            <a href="tel:(480) 331-9455" className="btn btn-accent btn-large shadow-glow" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <PhoneCall size={18} /> Speak With an Advisor: (480) 331-9455
            </a>
            <Link to="/services" className="btn btn-white" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              Explore All 6 Offerings <ArrowRight size={18} />
            </Link>
            <Link 
              to="/medicare-resources" 
              className="btn btn-dark-outline" 
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <ShieldCheck size={18} /> 2027 Medicare Hub
            </Link>
            <Link 
              to="/#welcome-video" 
              className="btn btn-secondary" 
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', borderColor: 'var(--accent)', color: '#ffd88a', background: 'rgba(5, 16, 57, 0.85)' }}
            >
              <Play size={16} fill="#ffd88a" color="#ffd88a" /> Watch Welcome Video
            </Link>
          </div>
        </div>
      </section>

      {/* Floating Centerpiece: Our Mission Showcase */}
      <div className="mission-showcase-container">
        <div className="mission-spotlight-card">
          <div className="mission-badge-row">
            <span className="mission-badge">Our Mission</span>
            <span style={{ fontSize: '0.82rem', color: '#ffd88a', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <ShieldCheck size={16} /> Certified Independent Brokerage
            </span>
          </div>

          <h2>Standing by Your Side Every Step of the Way</h2>

          <div className="mission-quote-statement">
            "At I Will Global, Inc., our mission is clear: to empower individuals, families, and businesses with unbiased health guidance, no-cost enrollment advocacy, and institutional-grade wealth and asset protection. Whether you are transitioning into Medicare, securing affordable individual or group health coverage, accumulating tax-free retirement wealth through investment-grade life insurance, or safeguarding your life savings with asset-based long term care, we eliminate complexity and deliver complete clarity."
          </div>

          {/* Key Agency Performance Metrics */}
          <div className="mission-stats-grid">
            <div className="stat-item">
              <div className="stat-number">100%</div>
              <div className="stat-label">Free Service</div>
              <div className="stat-sub">Zero broker fees, zero markup, pure fiduciary health advocacy</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">104+</div>
              <div className="stat-label">Carrier Plans</div>
              <div className="stat-sub">Comprehensive cross-carrier options & formulary reviews</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">6</div>
              <div className="stat-label">Core Divisions</div>
              <div className="stat-sub">Medicare, Individual, Group, Wealth, LTC, and Term Life</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">1:1</div>
              <div className="stat-label">Dedicated Support</div>
              <div className="stat-sub">A personal licensed agent assigned for life, not a call center</div>
            </div>
          </div>
        </div>
      </div>

      {/* Pillars Section: Why Work With Us */}
      <section className="about-section">
        <div className="section-header-centered">
          <span className="section-tag">The I Will Global Distinction</span>
          <h2 className="section-title">Why Work With Us?</h2>
          <p className="section-subtitle">
            Choosing the right Medicare plan affects your health, your doctors, and your monthly budget. Here is how we ensure you make the optimal decision with complete confidence.
          </p>
        </div>

        <div className="pillars-grid">
          {/* Card 1: Expert Knowledge */}
          <div className="pillar-card">
            <div className="pillar-card-top">
              <div className="pillar-icon-box">
                <Award size={30} />
              </div>
              <span className="pillar-badge">Deep Expertise</span>
            </div>
            <h3>Expert Knowledge</h3>
            <p>
              Our friendly, experienced, and licensed professionals are standing by to answer your Medicare questions. We continuously train on complex CMS regulations, formulary updates, and Medigap underwriting to provide precise, timely answers.
            </p>
            <ul className="pillar-highlights-list">
              <li className="pillar-highlight-item">
                <CheckCircle2 size={16} />
                <span>Thorough Prescription Formulary Audits</span>
              </li>
              <li className="pillar-highlight-item">
                <CheckCircle2 size={16} />
                <span>Primary Care & Specialist Network Verification</span>
              </li>
              <li className="pillar-highlight-item">
                <CheckCircle2 size={16} />
                <span>Guidance on Medicare Late Enrollment Penalties</span>
              </li>
            </ul>
          </div>

          {/* Card 2: Unbiased Advice */}
          <div className="pillar-card">
            <div className="pillar-card-top">
              <div className="pillar-icon-box">
                <Scale size={30} />
              </div>
              <span className="pillar-badge">Zero Quotas</span>
            </div>
            <h3>Unbiased Advice</h3>
            <p>
              We shop multiple carriers and find you the lowest premiums based on your distinct needs. Because we are independent brokers contracted with all major carriers, we answer only to you—never to an insurance company sales quota.
            </p>
            <ul className="pillar-highlights-list">
              <li className="pillar-highlight-item">
                <CheckCircle2 size={16} />
                <span>Over 100 Advantage & Supplement Plans Compared</span>
              </li>
              <li className="pillar-highlight-item">
                <CheckCircle2 size={16} />
                <span>Objective Side-by-Side Cost vs. Benefit Analysis</span>
              </li>
              <li className="pillar-highlight-item">
                <CheckCircle2 size={16} />
                <span>Custom Doctor & Hospital Network Matching</span>
              </li>
            </ul>
          </div>

          {/* Card 3: No Cost Service */}
          <div className="pillar-card">
            <div className="pillar-card-top">
              <div className="pillar-icon-box">
                <HeartHandshake size={30} />
              </div>
              <span className="pillar-badge">100% Free</span>
            </div>
            <h3>No Cost Service</h3>
            <p>
              Our enrollment assistance comes with absolutely no cost and no obligation. Insurance premiums are strictly regulated by federal law: your monthly price is identical whether you enroll through us or direct, but with us, you gain a personal advocate for life.
            </p>
            <ul className="pillar-highlights-list">
              <li className="pillar-highlight-item">
                <CheckCircle2 size={16} />
                <span>Zero Hidden Fees or Extra Broker Surcharges</span>
              </li>
              <li className="pillar-highlight-item">
                <CheckCircle2 size={16} />
                <span>Dedicated Annual AEP Plan Reviews Every October</span>
              </li>
              <li className="pillar-highlight-item">
                <CheckCircle2 size={16} />
                <span>Continuous Year-Round Billing & Claims Support</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Carrier Representation Panel */}
        <div className="commitments-panel">
          <div className="commitments-grid">
            <div className="commitments-text">
              <span className="section-tag">Direct Carrier Access</span>
              <h3>We Shop the Nation's Top Insurance Companies for You</h3>
              <p>
                You don't need to spend hours visiting dozens of insurance websites or calling multiple call centers. We compare all options side-by-side in one simple, clear conversation.
              </p>
              <div className="carrier-pills-row">
                {CARRIERS.map((carrier, idx) => (
                  <span key={idx} className="carrier-pill">
                    {carrier}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(200,150,62,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <Building size={22} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#ffffff' }}>Agency Governance</h4>
                  <span style={{ fontSize: '0.82rem', color: '#cbd5e1', fontWeight: 600 }}>Licensed Broker of Record & Compliance</span>
                </div>
              </div>
              <p style={{ fontSize: '0.9rem', color: '#e2e8f0', lineHeight: '1.65', margin: '0 0 1rem' }}>
                I Will Global operates under rigorous state licensing and federal CMS compliance standards. Our leadership team ensures that every client interaction is conducted with absolute integrity, transparency, and care.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className="badge badge-gold" style={{ fontSize: '0.74rem' }}>
                  <Check size={13} /> NPN Verified
                </span>
                <span className="badge badge-gold" style={{ fontSize: '0.74rem' }}>
                  <Check size={13} /> CMS Compliant
                </span>
                <span className="badge badge-gold" style={{ fontSize: '0.74rem' }}>
                  <Check size={13} /> Multi-State Certified
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Our Team — Complete I Will Global Team Directory */}
        <div style={{ margin: '3rem -1.5rem' }}>
          <PublicTeamDirectorySection />
        </div>

        {/* Call to Action Banner */}
        <div className="about-cta-banner">
          <h2>Ready to Protect Your Health & Secure Your Legacy?</h2>
          <p>
            Whether you are enrolling in Medicare, shopping for individual or group health coverage, accumulating wealth via Indexed Universal Life, or safeguarding your family with living-benefit life insurance, our fiduciaries are here for you.
          </p>
          <div className="about-cta-buttons">
            <Link to="/services" className="btn btn-primary" style={{ padding: '0.85rem 1.8rem', fontSize: '1.05rem', fontWeight: 800 }}>
              Explore All 6 Offerings
            </Link>
            <a href="tel:(480) 331-9455" className="btn btn-white" style={{ padding: '0.85rem 1.8rem', fontSize: '1.05rem' }}>
              <PhoneCall size={18} /> Call (480) 331-9455
            </a>
            <Link 
              to="/medicare-resources" 
              className="btn btn-dark-outline"
              style={{ padding: '0.85rem 1.8rem', fontSize: '1.05rem' }}
            >
              2027 Medicare Education Hub <ArrowRight size={18} className="ml-2" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default About;
