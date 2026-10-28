import React, { useState, useEffect } from 'react';
import { 
  Heart, 
  Users, 
  TrendingUp, 
  ShieldCheck, 
  Clock, 
  CheckCircle, 
  PhoneCall, 
  FileText, 
  ArrowRight, 
  Sparkles, 
  Award, 
  DollarSign, 
  Briefcase, 
  Home, 
  Activity,
  Layers,
  ChevronRight,
  Mail
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import './OtherOfferings.css';

const OFFERINGS_DATA = [
  {
    id: 'individual-health',
    title: 'Individual Health Insurance',
    tabBadge: 'Personal & Family',
    icon: Heart,
    headline: 'Individual & Family Major Medical',
    tagline: 'ACA Marketplace, Off-Exchange Private PPO Networks, Subsidies & Comprehensive Family Care.',
    advantageSummary: 'Unlike online lead farms that sell your personal info to dozens of aggressive telemarketers, I Will Global pairs you with an independent certified broker who personally maximizes your ACA Premium Tax Credits (APTC)—often unlocking $0 or low-cost monthly premiums with zero robocalls.',
    keyPoints: [
      {
        title: 'ACA Marketplace & Subsidy Optimization',
        desc: 'We analyze your household income against federal poverty guidelines to capture the maximum Advanced Premium Tax Credit (APTC), and identify Silver CSR plans that drop deductibles to $0.',
        bullets: ['Maximized monthly premium tax credits', 'Silver Plan Cost-Sharing Reductions (CSR)', 'Preventive care covered at 100%']
      },
      {
        title: 'Off-Exchange Private Major Medical',
        desc: 'For individuals and self-employed professionals whose income exceeds subsidy limits, we access exclusive private PPO networks featuring top specialists with no referral constraints.',
        bullets: ['Nationwide PPO provider access', 'No primary care referrals required', 'Custom deductible & coinsurance designs']
      },
      {
        title: 'Year-Round Special Enrollment (SEP)',
        desc: 'Experienced a qualifying life event? Whether you lost employer health coverage, moved, married, turned 26, or welcomed a child, we enroll you immediately outside open enrollment.',
        bullets: ['Loss of group health coverage transition', 'Relocation & interstate coverage', '60-day SEP fast-track processing']
      },
      {
        title: 'Ancillary Dental, Vision & Supplemental Care',
        desc: 'Complete your health safety net with standalone dental, vision, hearing, and hospital indemnity plans that pay cash benefits directly to you during hospital stays.',
        bullets: ['Zero-copay preventive dental cleanings', 'Orthodontia & major dental coverage', 'Lump-sum critical care cash payouts']
      }
    ],
    comparisonTitle: 'IWG Individual Health vs. Market Competitors',
    comparisonRows: [
      { feature: 'Broker Relationship', iwg: 'Dedicated 1:1 licensed fiduciary advisor', comp: 'Anonymous call center / data resale' },
      { feature: 'Subsidy Calculation', iwg: 'Manual tax-optimization for maximum credit', comp: 'Automated generic estimate' },
      { feature: 'Network Verification', iwg: '100% Doctor & Rx formulary check before enrolling', comp: 'Self-service guess-and-check' },
      { feature: 'Year-Round Support', iwg: 'Included free: Billing, claims & renewal advocacy', comp: 'Disappears after enrollment' }
    ],
    ctaText: 'Find Out If You Qualify for a $0 or Low-Cost Health Plan'
  },
  {
    id: 'group-health',
    title: 'Group Health Insurance',
    tabBadge: 'Business Solutions',
    icon: Briefcase,
    headline: 'Group Health & Corporate Employee Benefits',
    tagline: 'Custom Employee Benefits for Businesses with 1 to 50+ Employees That Save 15% to 30%.',
    advantageSummary: 'Traditional corporate brokers push rigid, fully-insured plans with automatic 15% annual rate hikes. I Will Global introduces Level-Funded and ICHRA benefit structures that return unused claim reserves back to the business owner, slashing company healthcare overhead while upgrading coverage.',
    keyPoints: [
      {
        title: 'Small Business Plans (1–50 Employees)',
        desc: 'Attract and retain elite industry talent with premier health benefits. Employer contributions are 100% tax-deductible, significantly lowering corporate and payroll tax burdens.',
        bullets: ['100% tax-deductible business expense', 'Reduces company payroll taxes (FICA)', 'Composite or age-banded premium tiers']
      },
      {
        title: 'Level-Funded Health Plans (Cash Surplus Refunds)',
        desc: 'Fixed monthly payments with built-in stop-loss protection. If your team stays healthy and claims are low, your business receives cash back at the end of the policy year.',
        bullets: ['Average 15% to 30% savings vs fully-insured', 'Claims surplus refunded to employer', 'Comprehensive national PPO networks']
      },
      {
        title: 'ICHRA (Individual Coverage HRA)',
        desc: 'Set a defined monthly tax-free healthcare allowance for each employee class. Employees choose the personal health plan they want, eliminating company underwriting risk.',
        bullets: ['Predictable fixed employer budget', 'Zero claims risk or renewal surprises', 'Tailored classes for salary vs hourly']
      },
      {
        title: 'Turnkey Employee Onboarding & Compliance',
        desc: 'We handle digital onboarding, live employee benefit webinars, Section 125 POP cafeteria plan setup, COBRA administration, and year-round employee support.',
        bullets: ['Digital employee enrollment portal', 'Section 125 tax-exempt cafeteria plans', 'Dedicated account manager for HR support']
      }
    ],
    comparisonTitle: 'IWG Level-Funded & Group Plans vs. Traditional Fully-Insured',
    comparisonRows: [
      { feature: 'Unused Premiums', iwg: 'Surplus reserves refunded to business', comp: '100% kept by insurance company' },
      { feature: 'Annual Rate Hikes', iwg: 'Based on actual claims or ICHRA fixed budget', comp: 'Double-digit community rating spikes' },
      { feature: 'Plan Flexibility', iwg: 'PPO, Level-Funded, HSA & ICHRA options', comp: 'One-size-fits-all rigid packages' },
      { feature: 'Admin Burden', iwg: 'IWG handles onboarding & employee questions', comp: 'Shifts all workload onto company HR' }
    ],
    ctaText: 'Request a Free Small Business Benefits Audit & Rate Analysis'
  },
  {
    id: 'investment-grade-life',
    title: 'Investment Grade Life Insurance',
    tabBadge: 'Wealth Accumulation',
    icon: TrendingUp,
    headline: 'High Cash-Value Indexed Universal Life (IUL)',
    tagline: 'IRS Section 7702 Wealth Accumulation Architecture: 0% Floor Downside Protection & Tax-Free Retirement.',
    advantageSummary: 'Traditional financial planning locks your wealth into 401(k) accounts subject to heavy future income taxes and stock market crashes. Our structured Investment Grade IUL policies feature a guaranteed 0% downside floor with index upside, producing 100% tax-free retirement loans with zero IRS age restrictions.',
    keyPoints: [
      {
        title: '0% Downside Floor Guarantee',
        desc: 'Participate in the growth of leading indices like the S&P 500 without downside market exposure. When the stock market crashes 20%, your contractual floor guarantees a 0% return—you never lose a penny of principal.',
        bullets: ['Zero downside market loss guarantee', 'Index crediting up to competitive caps', 'Annual point-to-point gains locked in']
      },
      {
        title: '100% Tax-Free Retirement Distributions',
        desc: 'Under IRS Code Sections 7702 and 101(a), cash value accessed through policy loans and withdrawals is completely exempt from federal and state income tax, with zero capital gains tax.',
        bullets: ['Tax-free income during retirement years', 'Does not trigger Medicare IRMAA surcharges', 'Does not increase taxable Social Security']
      },
      {
        title: 'The Infinite Banking Concept (IBC)',
        desc: 'Become your own financial institution. Borrow against your accumulating cash value for real estate acquisitions, business expansions, or personal debt, while your entire balance keeps compounding uninterrupted.',
        bullets: ['Non-direct recognition uninterrupted growth', 'Flexible repayment on your own terms', 'No credit checks or loan applications']
      },
      {
        title: 'Executive Bonus & Generational Wealth Transfer',
        desc: 'Used by Fortune 500 companies and high-net-worth families for Section 162 executive retention, buy-sell agreements, and transferring substantial wealth outside probate completely income-tax-free.',
        bullets: ['Tax-free legacy transfer to heirs', 'Protects assets from creditor judgments', 'Key-person & corporate executive bonus']
      }
    ],
    comparisonTitle: 'Investment Grade IUL vs. Traditional 401(k) / IRA',
    comparisonRows: [
      { feature: 'Market Downside Risk', iwg: '0% Guaranteed Floor (Cannot lose principal)', comp: 'Full downside risk (Can drop 30-50%)' },
      { feature: 'Distribution Taxes', iwg: '100% Income-Tax-Free (IRS Sec 7702)', comp: '100% Taxable as ordinary income' },
      { feature: 'Contribution Limits', iwg: 'Unlimited (Based on financial underwriting)', comp: 'Strict IRS caps ($23,000 / $7,000)' },
      { feature: 'Liquidity Access', iwg: 'Access anytime with zero penalties', comp: '10% IRS penalty before age 59½' }
    ],
    ctaText: 'Request a Custom IUL Wealth Accumulation Illustration'
  },
  {
    id: 'long-term-care',
    title: 'Long Term Care (LTC)',
    tabBadge: 'Asset Defense',
    icon: ShieldCheck,
    headline: 'Asset-Based Hybrid Life + Long Term Care',
    tagline: 'Modern "Use-It-or-Leave-It" Policies: Protect Your Nest Egg from Depletion with Guaranteed Benefits.',
    advantageSummary: 'Old-fashioned traditional LTC was a "use-it-or-lose-it" trap with runaway 100%+ premium spikes. I Will Global utilizes Asset-Based Hybrid Life + LTC policies: if you need care, you receive hundreds of thousands tax-free; if you never need care, 100% of your money passes to your heirs as a tax-free death benefit.',
    keyPoints: [
      {
        title: 'The 70% Care Reality & Cost Defense',
        desc: 'Over 70% of Americans turning 65 will require long-term care services in their lifetime. With private nursing facilities averaging $108,000+/year, an LTC policy prevents rapid retirement portfolio liquidation.',
        bullets: ['Defends retirement savings from depletion', 'Guaranteed monthly care benefit pools', 'Covers cognitive impairment & ADLs']
      },
      {
        title: 'In-Home Care, Assisted Living & Memory Care',
        desc: 'Enjoy total freedom of care setting. Benefits cover licensed home health aides, visiting nurses, physical therapy, assisted living communities, adult day care, and memory care facilities.',
        bullets: ['Remain in your home with private nurses', 'Assisted living and memory care covered', 'Care coordination & respite assistance']
      },
      {
        title: 'Asset-Based "Never Lost" Architecture',
        desc: 'Built on a permanent life insurance or annuity chassis with guaranteed level premiums. If you pass away without needing care, 100% of the benefit passes to your family as an income-tax-free death benefit.',
        bullets: ['Guaranteed level premiums that never rise', 'Full death benefit to heirs if care is unused', 'Asset-based return of premium options']
      },
      {
        title: 'Medicaid Spend-Down & Partnership Protection',
        desc: 'Qualifying partnership policies protect your home, liquid savings, and family inheritance dollar-for-dollar against state Medicaid spend-down requirements (which otherwise mandate spending down to $2,000).',
        bullets: ['Dollar-for-dollar asset protection', 'Shields primary home & savings', 'Eliminates Medicaid estate recovery claims']
      }
    ],
    comparisonTitle: 'IWG Asset-Based Hybrid LTC vs. Traditional LTC Policies',
    comparisonRows: [
      { feature: 'If Never Used', iwg: '100% Life insurance payout to children', comp: 'Zero refund (All premiums lost forever)' },
      { feature: 'Premium Rate Hikes', iwg: 'Guaranteed level premiums locked for life', comp: 'Frequent 50% to 120%+ rate increases' },
      { feature: 'Care Flexibility', iwg: 'In-home care, assisted living, family caregivers', comp: 'Strictly limited facility-only rules' },
      { feature: 'Cash Benefit Option', iwg: 'Indemnity model: spend funds as you see fit', comp: 'Tedious receipt-based reimbursements' }
    ],
    ctaText: 'Calculate Your Long Term Care Asset Protection Strategy'
  },
  {
    id: 'term-life',
    title: 'Term Life Insurance',
    tabBadge: 'Family Security',
    icon: Clock,
    headline: 'Modern Term Life with Built-In Living Benefits',
    tagline: 'High-Value Financial Protection That Pays While You Are Alive, with Rapid Digital Approvals.',
    advantageSummary: 'Competitors sell obsolete term insurance with tedious 6-week medical exams that only pays out when you die. I Will Global provides Modern Term with Accelerated Living Benefits: access up to 80% to 90% of your cash while alive if diagnosed with a heart attack, stroke, or cancer, with approvals in under 15 minutes.',
    keyPoints: [
      {
        title: 'Guaranteed Level Premium Terms (10–35 Years)',
        desc: 'Lock in your monthly premium on day one. Your rates are contractually guaranteed never to increase for 10, 15, 20, 25, 30, or 35 years, shielding your family through the critical mortgage and college years.',
        bullets: ['Level death benefit guaranteed', 'Premiums never increase during term', 'Coverage amounts from $100K to $10M+']
      },
      {
        title: 'Living Benefits Included at Zero Extra Cost',
        desc: 'Accelerate a significant portion of your death benefit cash while you are alive if diagnosed with a critical illness (cancer, heart attack, stroke), chronic condition, or terminal diagnosis.',
        bullets: ['Critical illness lump-sum payout', 'Chronic illness monthly care funding', 'Terminal illness accelerated benefits']
      },
      {
        title: 'Accelerated Digital Underwriting (No Medical Exam)',
        desc: 'Skip the needles, blood draws, and weeks of waiting. Qualified applicants can secure instant digital policy approvals in 15 minutes using secure algorithmic health verification.',
        bullets: ['Instant online approvals available', 'No medical exams or blood tests for most', 'Immediate policy binding & delivery']
      },
      {
        title: 'Guaranteed Conversion Privilege & ROP Options',
        desc: 'Every policy includes the contractual right to convert into permanent Investment Grade Life Insurance with no medical questions asked. Optional Return of Premium (ROP) refunds 100% of premiums paid.',
        bullets: ['Convert to permanent IUL without health exam', 'Optional Return of Premium (ROP) feature', 'Laddered term strategies for peak savings']
      }
    ],
    comparisonTitle: 'IWG Modern Term Life vs. Traditional Competitor Term',
    comparisonRows: [
      { feature: 'Living Benefits', iwg: 'Included: Pays cash for heart attack, stroke, cancer', comp: 'None: Pays only upon death' },
      { feature: 'Underwriting Time', iwg: 'Minutes via digital accelerated underwriting', comp: '4 to 8 weeks with physical exams' },
      { feature: 'Conversion Rights', iwg: 'Guaranteed conversion to cash-value IUL', comp: 'Limited or costly conversion periods' },
      { feature: 'Premium Cost', iwg: 'Multi-carrier wholesale broker pricing', comp: 'Higher single-carrier markup rates' }
    ],
    ctaText: 'Compare Rates Across 25+ Term Life Insurance Carriers'
  }
];

export const OtherOfferingsPage = () => {
  const [activeTab, setActiveTab] = useState('individual-health');
  const location = useLocation();

  // Handle URL hash changes
  useEffect(() => {
    const hash = location.hash.replace('#', '');
    if (hash && OFFERINGS_DATA.some(o => o.id === hash)) {
      setActiveTab(hash);
      const el = document.getElementById('offerings-content');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  }, [location]);

  const currentOffering = OFFERINGS_DATA.find(o => o.id === activeTab) || OFFERINGS_DATA[0];

  const handleTabChange = (id, e) => {
    setActiveTab(id);
    if (e && e.currentTarget) {
      try {
        e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } catch {
        // fallback
      }
    }
  };

  return (
    <div className="offerings-page animate-fade-in">
      {/* Hero Header */}
      <section className="offerings-hero">
        <div className="offerings-hero-bg"></div>
        <div className="container offerings-hero-content">
          <div className="offerings-eyebrow">
            <Sparkles size={14} /> Comprehensive Insurance & Wealth Protection
          </div>
          <h1>
            Beyond Medicare: <span>Complete Healthcare & Life Solutions</span>
          </h1>
          <p className="offerings-hero-lead">
            I Will Global provides premier, independent brokerage across all stages of life and business. Explore our five specialized coverage divisions—designed to outperform all market alternatives in pricing, benefits, and personalized advocacy.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="tel:(480) 331-9455" className="btn btn-accent btn-large shadow-glow" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <PhoneCall size={18} /> Speak With a Licensed Advisor: (480) 331-9455
            </a>
            <a href="#offerings-content" className="btn btn-dark-outline">
              Explore All 5 Divisions ↓
            </a>
          </div>
        </div>
      </section>

      {/* Main Interactive Offerings Section */}
      <div className="offerings-container" id="offerings-content">
        {/* Quote Routing Notice Banner */}
        <div style={{
          background: 'linear-gradient(135deg, #0a163b 0%, #051039 100%)',
          border: '1.5px solid var(--accent, #c8963e)',
          borderRadius: '14px',
          padding: '1.25rem 1.75rem',
          margin: '0 0 2rem 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.25rem',
          flexWrap: 'wrap',
          boxShadow: '0 8px 30px rgba(5, 16, 57, 0.25)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '1 1 360px' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'rgba(200, 150, 62, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffd88a', flexShrink: 0 }}>
              <ShieldCheck size={22} />
            </div>
            <div>
              <div style={{ color: '#ffd88a', fontWeight: 800, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                Important Quoting Notice
              </div>
              <div style={{ color: '#f1f5f9', fontSize: '0.9rem', lineHeight: 1.5, marginTop: '3px' }}>
                The online <strong>"Find a Plan"</strong> tool is specifically for Medicare. For all other insurance quotes (Individual & Family Health, Group Benefits, Life Insurance, Annuities, or Long-Term Care), please call <strong>(480) 331-9455</strong> or email <strong>info@iwillglobal.com</strong> for a custom personalized illustration.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
            <a href="tel:(480) 331-9455" className="btn btn-accent btn-small" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
              <PhoneCall size={14} /> (480) 331-9455
            </a>
            <a href="mailto:info@iwillglobal.com?subject=Quote%20Request%20-%20Other%20Offerings" className="btn btn-secondary btn-small" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}>
              <Mail size={14} /> Email info@iwillglobal.com
            </a>
          </div>
        </div>

        {/* Floating 5-Tab Selector Strip */}
        <div className="offerings-tabs-wrapper">
          <div className="offerings-tabs-bar" role="tablist">
            {OFFERINGS_DATA.map((offering) => {
              const Icon = offering.icon;
              const isActive = activeTab === offering.id;
              return (
                <button
                  key={offering.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`offering-tab-btn ${isActive ? 'active' : ''}`}
                  onClick={(e) => handleTabChange(offering.id, e)}
                >
                  <div className="tab-icon-wrap">
                    <Icon size={20} />
                  </div>
                  <span className="tab-btn-title">{offering.title}</span>
                  <span className="tab-btn-badge">{offering.tabBadge}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Offering Detail Box */}
        <div className="offering-detail-card animate-fade-in" key={currentOffering.id} id={currentOffering.id}>
          {/* Header */}
          <div className="offering-detail-header">
            <div className="header-meta-left">
              <span className="offering-main-badge">
                <Sparkles size={13} /> {currentOffering.tabBadge} Division
              </span>
              <h2>{currentOffering.headline}</h2>
              <p className="offering-tagline">{currentOffering.tagline}</p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <a href="tel:(480) 331-9455" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                <PhoneCall size={15} /> (480) 331-9455
              </a>
              <a href={`mailto:info@iwillglobal.com?subject=Quote%20Request%20-%20${encodeURIComponent(currentOffering.title)}`} className="btn btn-accent" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700 }}>
                <Mail size={15} /> Request Quote by Email
              </a>
            </div>
          </div>

          {/* Competitive Advantage Callout */}
          <div className="competitive-advantage-banner">
            <div className="competitive-advantage-icon">
              <Award size={24} />
            </div>
            <div className="competitive-advantage-text">
              <h4>
                <Sparkles size={16} /> Why I Will Global Outperforms All Competitors:
              </h4>
              <p>{currentOffering.advantageSummary}</p>
            </div>
          </div>

          {/* 4 Pillars / Core Features Quad Grid */}
          <div className="features-quad-grid">
            {currentOffering.keyPoints.map((point, i) => (
              <div key={i} className="feature-quad-card">
                <div className="quad-card-header">
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(200,150,62,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                    <CheckCircle size={18} />
                  </div>
                  <h4>{point.title}</h4>
                </div>
                <p>{point.desc}</p>
                <ul className="quad-bullets">
                  {point.bullets.map((bullet, idx) => (
                    <li key={idx}>
                      <ChevronRight size={14} />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Comparison Matrix Table */}
          <div className="comparison-matrix-box">
            <div className="comparison-matrix-header">
              <h3>{currentOffering.comparisonTitle}</h3>
              <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>
                Fiduciary Advantage
              </span>
            </div>
            <div className="comparison-table-wrapper">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th style={{ width: '25%' }}>Key Consideration</th>
                    <th className="iwg-col" style={{ width: '37.5%' }}>I Will Global Advantage</th>
                    <th style={{ width: '37.5%' }}>Traditional Market Competitors</th>
                  </tr>
                </thead>
                <tbody>
                  {currentOffering.comparisonRows.map((row, idx) => (
                    <tr key={idx}>
                      <td><strong>{row.feature}</strong></td>
                      <td className="iwg-col">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <CheckCircle size={15} color="#10b981" />
                          <span>{row.iwg}</span>
                        </div>
                      </td>
                      <td style={{ color: '#1e293b', fontWeight: 500 }}>
                        <span>{row.comp}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Call to Action inside Detail */}
          <div className="offering-cta-footer">
            <div className="offering-cta-info">
              <h4>Ready to Get a Custom Quote for {currentOffering.title}?</h4>
              <p style={{ color: '#0f172a', fontWeight: 500 }}>
                <em>Notice: Our online "Find a Plan" tool is specifically for Medicare.</em> For all other custom quotes, our licensed fiduciaries evaluate your needs across top carriers and provide custom illustrations with zero fees and zero pressure.
              </p>
            </div>
            <div className="offering-cta-actions">
              <a href="tel:(480) 331-9455" className="btn btn-accent" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                <PhoneCall size={16} /> Call (480) 331-9455
              </a>
              <a href={`mailto:info@iwillglobal.com?subject=Quote%20Request%20-%20${encodeURIComponent(currentOffering.title)}`} className="btn btn-dark-outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <Mail size={16} /> Email info@iwillglobal.com
              </a>
            </div>
          </div>
        </div>

        {/* Global Bottom Consultation Banner */}
        <div style={{ marginTop: '4rem', background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '16px', padding: '3rem 2rem', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Multi-Carrier Independence
          </span>
          <h2 style={{ color: '#051039', fontSize: '2rem', fontWeight: 800, margin: '0.5rem 0 1rem' }}>
            One Trusted Advisory Team for All Your Insurance Needs
          </h2>
          <p style={{ maxWidth: '720px', margin: '0 auto 1.75rem', color: '#0f172a', fontSize: '1.08rem', fontWeight: 600, lineHeight: '1.65' }}>
            From Medicare and individual ACA health coverage to small business employee benefits, asset-based long term care, and tax-free wealth accumulation life insurance—I Will Global protects what matters most.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="tel:(480) 331-9455" className="btn btn-primary" style={{ padding: '0.85rem 1.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
              <PhoneCall size={16} /> Call: (480) 331-9455
            </a>
            <a href="mailto:info@iwillglobal.com?subject=Quote%20Request%20-%20Insurance%20Advisory" className="btn btn-accent" style={{ padding: '0.85rem 1.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700 }}>
              <Mail size={16} /> Email: info@iwillglobal.com
            </a>
            <Link to="/about-us" className="btn btn-secondary" style={{ padding: '0.85rem 1.75rem' }}>
              Learn About Our Mission
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OtherOfferingsPage;
