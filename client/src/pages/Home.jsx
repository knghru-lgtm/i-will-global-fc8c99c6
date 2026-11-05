import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  ShieldCheck, 
  HeartPulse, 
  Clock, 
  ArrowRight, 
  Award, 
  Scale, 
  HeartHandshake, 
  Briefcase, 
  TrendingUp, 
  Heart, 
  ChevronRight, 
  Sparkles, 
  PhoneCall, 
  CheckCircle2,
  Play,
  PlayCircle
} from 'lucide-react';
import IWGBrandedVideoPlayer from '../components/IWGBrandedVideoPlayer';
import { VideoGuideModal } from '../components/VideoGuideModal';
import { PublicTeamDirectorySection } from '../components/PublicTeamDirectorySection';
import './Home.css';

const Home = () => {
  const [isMedicareVideoOpen, setIsMedicareVideoOpen] = useState(false);

  return (
    <div className="home-page animate-fade-in">
      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-bg"></div>
        <div className="container hero-content">
          <div className="hero-split-grid">
            {/* Left: Protecting Your Health. Preserving Your Wealth. Box */}
            <div className="hero-text-card glass">
              <div style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '0.4rem', 
                background: 'rgba(200, 150, 62, 0.15)', 
                border: '1px solid rgba(200, 150, 62, 0.4)', 
                borderRadius: '999px', 
                padding: '0.35rem 0.85rem', 
                color: 'var(--accent)', 
                fontSize: '0.82rem', 
                fontWeight: 700, 
                textTransform: 'uppercase', 
                letterSpacing: '0.06em', 
                marginBottom: '1rem' 
              }}>
                <Sparkles size={14} /> Multi-Line Independent Brokerage & Fiduciary Advisory
              </div>
              <h1>Protecting Your Health. Preserving Your Wealth.</h1>
              <p className="subtitle">
                From comprehensive Medicare and individual & group health plans to investment-grade life insurance and asset-based long-term care—we shop 104+ top-rated national carriers to secure your ideal coverage at the lowest rates. Always independent, 100% fiduciary.
              </p>
              <div className="hero-actions">
                <Link to="/services" className="btn btn-accent btn-large shadow-glow">
                  Explore All 6 Offerings <ArrowRight size={20} className="ml-2" />
                </Link>
                <Link to="/medicare-resources" className="btn btn-white" style={{ padding: '0.95rem 1.65rem', fontSize: '1.02rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={20} /> 2027 Medicare Hub
                </Link>
                <button 
                  type="button" 
                  className="btn btn-secondary shadow-glow" 
                  onClick={() => setIsMedicareVideoOpen(true)}
                  style={{ padding: '0.95rem 1.65rem', fontSize: '1.02rem', display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontWeight: 700, borderColor: 'var(--accent)', color: '#ffd88a', background: 'rgba(5, 16, 57, 0.85)' }}
                >
                  <PlayCircle size={18} color="#ffd88a" /> Watch Medicare Video
                </button>
              </div>
            </div>

            {/* Right: Official Welcome Video */}
            <div className="hero-video-card" id="welcome-video">
              <IWGBrandedVideoPlayer 
                src="/videos/welcome-video.mp4"
                altSrc="/videos/iwg-welcome-30s.mp4"
                altLabel="30s Agency Spot"
                fileId="1DLstMOwsStQGHBB1Pm7SD6jZ4JysG8c9"
                title="I Will Global Official Welcome Video"
                subtitle="Fiduciary Healthcare Guidance & Institutional Wealth Protection"
                badge="Executive Welcome"
                loadingText="Loading Official Welcome Video..."
              />
            </div>
          </div>
        </div>
      </section>

      {/* Quick Jump Core Divisions Strip - HIGH CONTRAST & FULL VISIBILITY */}
      <nav className="core-divisions-strip" aria-label="Core Divisions Quick Links">
        <div className="container core-divisions-inner">
          <div className="core-divisions-label">
            <Sparkles size={14} color="#ffd88a" />
            <span>Core Divisions:</span>
          </div>
          <div className="core-divisions-pills">
            <Link to="/medicare-resources" className="offering-pill">
              <span className="pill-emoji">🛡️</span>
              <span className="pill-name">Medicare Solutions</span>
            </Link>
            <Link to="/services#individual-health" className="offering-pill">
              <span className="pill-emoji">🩺</span>
              <span className="pill-name">Individual & Family Health</span>
            </Link>
            <Link to="/services#group-health" className="offering-pill">
              <span className="pill-emoji">🏢</span>
              <span className="pill-name">Group Health (1–50+)</span>
            </Link>
            <Link to="/services#investment-grade-life" className="offering-pill">
              <span className="pill-emoji">📈</span>
              <span className="pill-name">Investment Grade Life</span>
            </Link>
            <Link to="/services#long-term-care" className="offering-pill">
              <span className="pill-emoji">🏛️</span>
              <span className="pill-name">Long Term Care</span>
            </Link>
            <Link to="/services#term-life" className="offering-pill">
              <span className="pill-emoji">⏳</span>
              <span className="pill-name">Term Life (Living Benefits)</span>
            </Link>
            <a href="#our-team" className="offering-pill">
              <span className="pill-emoji">👥</span>
              <span className="pill-name">Our Team Directory</span>
            </a>
          </div>
        </div>
      </nav>

      {/* Services/Features & Our Mission */}
      <section className="features-section container">
        {/* Mission Showcase Banner */}
        <div style={{ 
          background: 'linear-gradient(135deg, rgba(22, 36, 77, 0.98) 0%, rgba(5, 16, 57, 1) 100%)', 
          borderRadius: '16px', 
          padding: '2.5rem', 
          color: '#ffffff', 
          border: '1.5px solid rgba(212, 160, 76, 0.45)', 
          boxShadow: '0 20px 45px rgba(5, 16, 57, 0.35)', 
          marginBottom: '4rem',
          textAlign: 'center'
        }}>
          <span className="badge badge-gold" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem', display: 'inline-block', background: 'rgba(212, 160, 76, 0.25)', color: '#ffd88a', border: '1px solid #d4a04c' }}>
            Our Mission
          </span>
          <h2 style={{ color: '#ffffff', fontSize: '2rem', fontWeight: 800, marginBottom: '1rem', letterSpacing: '-0.5px' }}>
            Fiduciary Healthcare Guidance & Institutional Wealth Protection
          </h2>
          <p style={{ 
            fontSize: '1.15rem', 
            color: '#f8fafc', 
            lineHeight: '1.75', 
            maxWidth: '860px', 
            margin: '0 auto 1.75rem',
            fontStyle: 'italic',
            fontWeight: 400
          }}>
            "At I Will Global, Inc., our mission is clear: to empower individuals, families, and businesses with unbiased health guidance, no-cost enrollment advocacy, and institutional-grade wealth and asset protection. Whether you are transitioning into Medicare, securing affordable individual or group health coverage, accumulating tax-free retirement wealth through investment-grade life insurance, or safeguarding your life savings with asset-based long term care, we eliminate complexity and deliver complete clarity."
          </p>
          <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '1.5rem' }}>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#ffd88a' }}>100% Free</div>
              <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>Health Advisory & Enrollment</div>
            </div>
            <div style={{ width: '1px', background: 'rgba(255,255,255,0.25)' }}></div>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#ffd88a' }}>104+</div>
              <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>Top-Tier Carrier Products</div>
            </div>
            <div style={{ width: '1px', background: 'rgba(255,255,255,0.25)' }}></div>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#ffd88a' }}>6 Divisions</div>
              <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>Health, Group, Wealth & Life</div>
            </div>
            <div style={{ width: '1px', background: 'rgba(255,255,255,0.25)' }}></div>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#ffd88a' }}>7 States</div>
              <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>AZ, TX, CA, NV, FL, NM, CO</div>
            </div>
            <div style={{ width: '1px', background: 'rgba(255,255,255,0.25)' }}></div>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#ffd88a' }}>1:1</div>
              <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>Dedicated Personal Broker</div>
            </div>
          </div>
        </div>

        <div className="section-header text-center">
          <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            The I Will Global Distinction
          </span>
          <h2 className="text-primary text-3xl" style={{ marginTop: '0.25rem' }}>Why Work With Us?</h2>
          <p className="text-muted max-w-2xl mx-auto">
            Whether you need zero-cost healthcare enrollment, corporate group benefits, or advanced tax-exempt estate protection, here is why clients nationwide trust I Will Global:
          </p>
        </div>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon bg-blue">
              <Award size={32} />
            </div>
            <h3>Multidisciplinary Knowledge</h3>
            <p>Our licensed advisors continuously audit CMS Medicare rules, ACA federal subsidies, and advanced IRS Section 7702 tax-advantaged life insurance strategies to deliver cohesive healthcare and wealth solutions tailored to your life stage.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon bg-gold">
              <Scale size={32} />
            </div>
            <h3>100% Unbiased Brokerage</h3>
            <p>We represent you, not an insurance company. With direct contracts across 104+ premier carriers, we objectively shop and compare coverage, doctor networks, and premium structures to maximize your value—never tied to captive sales quotas.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon bg-blue">
              <HeartHandshake size={32} />
            </div>
            <h3>No-Cost Advocacy & Fiduciary Care</h3>
            <p>All Medicare and individual health advisory is 100% free of broker fees. From annual plan audits and prescription formulary checks to living-benefit claims support, you have a dedicated advocate for life.</p>
          </div>
        </div>
      </section>

      {/* Comprehensive Coverage: All 6 Offerings Showcase */}
      <section style={{ backgroundColor: '#f8fafc', padding: '5rem 1.5rem', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
        <div className="container">
          <div className="section-header text-center" style={{ marginBottom: '3rem' }}>
            <span style={{ color: '#936021', fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Full Spectrum Protection
            </span>
            <h2 className="text-primary text-3xl" style={{ marginTop: '0.35rem', color: '#051039' }}>
              Our Specialized Insurance & Wealth Divisions
            </h2>
            <p className="text-muted max-w-2xl mx-auto" style={{ color: '#334155', fontSize: '1.05rem' }}>
              I Will Global provides premier, independent brokerage for individuals, families, and growing businesses across all health and financial stages.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.75rem' }}>
            {/* 1. Medicare Solutions */}
            <div className="feature-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="feature-icon bg-blue" style={{ width: '3.25rem', height: '3.25rem', marginBottom: '1rem' }}>
                <ShieldCheck size={24} />
              </div>
              <span className="badge badge-gold" style={{ alignSelf: 'flex-start', fontSize: '0.72rem', marginBottom: '0.5rem', fontWeight: 700 }}>
                Senior Healthcare
              </span>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: '#051039', fontWeight: 800 }}>Medicare Advisory & Plans</h3>
              <p style={{ fontSize: '0.92rem', flex: 1, marginBottom: '1.25rem', color: '#334155', lineHeight: 1.6 }}>
                Complete guidance across Medicare Advantage (Part C), Supplements (Medigap Plans G & N), Part D Prescription Drug, and Special Needs Plans (D-SNP/C-SNP) with 100% free enrollment assistance.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link to="/medicare-resources" className="btn btn-outline" style={{ padding: '0.65rem 1rem', fontSize: '0.88rem', flex: 1, justifyContent: 'space-between', borderColor: '#051039', color: '#051039', fontWeight: 750, background: '#ffffff', minWidth: '150px' }}>
                  <span>Medicare Hub</span>
                  <ChevronRight size={16} />
                </Link>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setIsMedicareVideoOpen(true)}
                  style={{ padding: '0.65rem 0.95rem', fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, borderColor: 'var(--accent)', color: '#ffd88a', background: 'rgba(5, 16, 57, 0.9)' }}
                  title="Watch Official 2027 Medicare Video Guide"
                >
                  <PlayCircle size={15} color="#ffd88a" /> Watch Video
                </button>
              </div>
            </div>

            {/* 2. Individual Health */}
            <div className="feature-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="feature-icon bg-gold" style={{ width: '3.25rem', height: '3.25rem', marginBottom: '1rem' }}>
                <Heart size={24} />
              </div>
              <span className="badge badge-gold" style={{ alignSelf: 'flex-start', fontSize: '0.72rem', marginBottom: '0.5rem', fontWeight: 700 }}>
                Personal & Family
              </span>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: '#051039', fontWeight: 800 }}>Individual Health Insurance</h3>
              <p style={{ fontSize: '0.92rem', flex: 1, marginBottom: '1.25rem', color: '#334155', lineHeight: 1.6 }}>
                ACA Marketplace subsidies, off-exchange private PPO networks, and zero-spam fiduciary plan matching to cut your monthly health costs without sacrificing your doctor choice.
              </p>
              <Link to="/services#individual-health" className="btn btn-outline" style={{ padding: '0.65rem 1.1rem', fontSize: '0.88rem', width: '100%', justifyContent: 'space-between', borderColor: '#051039', color: '#051039', fontWeight: 750, background: '#ffffff' }}>
                <span>Explore Individual Health</span>
                <ChevronRight size={16} />
              </Link>
            </div>

            {/* 3. Group Health */}
            <div className="feature-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="feature-icon bg-blue" style={{ width: '3.25rem', height: '3.25rem', marginBottom: '1rem' }}>
                <Briefcase size={24} />
              </div>
              <span className="badge badge-gold" style={{ alignSelf: 'flex-start', fontSize: '0.72rem', marginBottom: '0.5rem', fontWeight: 700 }}>
                Corporate Solutions
              </span>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: '#051039', fontWeight: 800 }}>Group Health Insurance</h3>
              <p style={{ fontSize: '0.92rem', flex: 1, marginBottom: '1.25rem', color: '#334155', lineHeight: 1.6 }}>
                Level-funded health plans and ICHRA designs for 1–50+ employees that return unused claims reserves directly to the business owner while lowering employee deductibles.
              </p>
              <Link to="/services#group-health" className="btn btn-outline" style={{ padding: '0.65rem 1.1rem', fontSize: '0.88rem', width: '100%', justifyContent: 'space-between', borderColor: '#051039', color: '#051039', fontWeight: 750, background: '#ffffff' }}>
                <span>Explore Group Benefits</span>
                <ChevronRight size={16} />
              </Link>
            </div>

            {/* 4. Investment Grade Life */}
            <div className="feature-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="feature-icon bg-gold" style={{ width: '3.25rem', height: '3.25rem', marginBottom: '1rem' }}>
                <TrendingUp size={24} />
              </div>
              <span className="badge badge-gold" style={{ alignSelf: 'flex-start', fontSize: '0.72rem', marginBottom: '0.5rem', fontWeight: 700 }}>
                Tax-Free Wealth
              </span>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: '#051039', fontWeight: 800 }}>Investment Grade Life (IUL)</h3>
              <p style={{ fontSize: '0.92rem', flex: 1, marginBottom: '1.25rem', color: '#334155', lineHeight: 1.6 }}>
                High cash-value Indexed Universal Life with guaranteed 0% downside floor protection, tax-free retirement loan distributions, and infinite banking liquidity under IRC Sec. 7702.
              </p>
              <Link to="/services#investment-grade-life" className="btn btn-outline" style={{ padding: '0.65rem 1.1rem', fontSize: '0.88rem', width: '100%', justifyContent: 'space-between', borderColor: '#051039', color: '#051039', fontWeight: 750, background: '#ffffff' }}>
                <span>Explore Investment Life</span>
                <ChevronRight size={16} />
              </Link>
            </div>

            {/* 5. Long Term Care */}
            <div className="feature-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="feature-icon bg-blue" style={{ width: '3.25rem', height: '3.25rem', marginBottom: '1rem' }}>
                <ShieldCheck size={24} />
              </div>
              <span className="badge badge-gold" style={{ alignSelf: 'flex-start', fontSize: '0.72rem', marginBottom: '0.5rem', fontWeight: 700 }}>
                Asset Defense
              </span>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: '#051039', fontWeight: 800 }}>Asset-Based Long Term Care</h3>
              <p style={{ fontSize: '0.92rem', flex: 1, marginBottom: '1.25rem', color: '#334155', lineHeight: 1.6 }}>
                Modern "use-it-or-leave-it" hybrid policies: if care is needed, receive tax-free benefits for home health or nursing care; if not, 100% of the benefit passes to your heirs.
              </p>
              <Link to="/services#long-term-care" className="btn btn-outline" style={{ padding: '0.65rem 1.1rem', fontSize: '0.88rem', width: '100%', justifyContent: 'space-between', borderColor: '#051039', color: '#051039', fontWeight: 750, background: '#ffffff' }}>
                <span>Explore Long Term Care</span>
                <ChevronRight size={16} />
              </Link>
            </div>

            {/* 6. Term Life Insurance */}
            <div className="feature-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="feature-icon bg-gold" style={{ width: '3.25rem', height: '3.25rem', marginBottom: '1rem' }}>
                <Clock size={24} />
              </div>
              <span className="badge badge-gold" style={{ alignSelf: 'flex-start', fontSize: '0.72rem', marginBottom: '0.5rem', fontWeight: 700 }}>
                Living Benefits
              </span>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: '#051039', fontWeight: 800 }}>Term Life with Living Benefits</h3>
              <p style={{ fontSize: '0.92rem', flex: 1, marginBottom: '1.25rem', color: '#334155', lineHeight: 1.6 }}>
                Guaranteed level term rates with built-in cash payouts if diagnosed with cancer, heart attack, or stroke, 15-minute digital approvals, and guaranteed conversion rights.
              </p>
              <Link to="/services#term-life" className="btn btn-outline" style={{ padding: '0.65rem 1.1rem', fontSize: '0.88rem', width: '100%', justifyContent: 'space-between', borderColor: '#051039', color: '#051039', fontWeight: 750, background: '#ffffff' }}>
                <span>Explore Term Life</span>
                <ChevronRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Our Team — Complete I Will Global Team Directory */}
      <PublicTeamDirectorySection />

      {/* Comprehensive Action Banner */}
      <section className="resources-highlight">
        <div className="container">
          <div className="action-banner">
            <h2>Ready to Protect Your Health & Secure Your Legacy?</h2>
            <p>Whether you're exploring Medicare options, securing health plans, or establishing a tax-free wealth strategy, our independent fiduciaries are standing by.</p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.25rem' }}>
              <Link to="/services" className="btn btn-primary" style={{ padding: '0.85rem 1.8rem', fontSize: '1rem', fontWeight: 800 }}>
                Explore All 6 Offerings
              </Link>
              <a 
                href="tel:(480) 331-9455" 
                className="btn btn-white" 
                style={{ padding: '0.85rem 1.8rem', fontSize: '1rem' }}
              >
                <PhoneCall size={18} /> Call (480) 331-9455
              </a>
              <Link 
                to="/medicare-resources" 
                className="btn btn-accent" 
                style={{ padding: '0.85rem 1.8rem', fontSize: '1rem', fontWeight: 800 }}
              >
                2027 Medicare Education Hub <ArrowRight size={16} className="ml-1" />
              </Link>
              <button 
                type="button" 
                className="btn btn-secondary shadow-glow" 
                onClick={() => setIsMedicareVideoOpen(true)}
                style={{ padding: '0.85rem 1.8rem', fontSize: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, borderColor: 'var(--accent)', color: '#ffd88a', background: 'rgba(5, 16, 57, 0.9)' }}
              >
                <PlayCircle size={16} color="#ffd88a" /> Watch Medicare Video
              </button>
              <a 
                href="#welcome-video" 
                className="btn btn-secondary" 
                style={{ padding: '0.85rem 1.8rem', fontSize: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, borderColor: 'rgba(255,255,255,0.35)', color: '#ffffff', background: 'rgba(5, 16, 57, 0.7)' }}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('welcome-video')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                <Play size={16} fill="#ffffff" color="#ffffff" /> Welcome Video
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Official 2027 Medicare Video Guide Modal */}
      <VideoGuideModal 
        isOpen={isMedicareVideoOpen} 
        onClose={() => setIsMedicareVideoOpen(false)}
        src="/videos/medicare-guide-2027.mp4"
        fileId="1MibMsPiM6X6i0uYCQBQYSLzTYdA9ITnz"
        title="Official 2027 Medicare Video Guide"
        subtitle="Complete Medicare Breakdown: Parts A, B, C, D & Medigap Pathways"
        badge="2027 Medicare Guide"
        loadingText="Loading Official Medicare Video Guide..."
      />
    </div>
  );
};

export default Home;
