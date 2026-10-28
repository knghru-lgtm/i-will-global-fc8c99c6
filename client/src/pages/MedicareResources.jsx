import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  Calendar, 
  HelpCircle, 
  Activity, 
  Heart, 
  Shield, 
  PlusCircle, 
  CheckCircle, 
  AlertCircle, 
  ArrowRight, 
  PhoneCall, 
  FileText,
  ShieldCheck,
  PlayCircle
} from 'lucide-react';
import { VideoGuideModal } from '../components/VideoGuideModal';
import { IWGBrandedVideoPlayer } from '../components/IWGBrandedVideoPlayer';
import './Page.css';

const resources = [
  { 
    id: '2027-medicare-costs',
    title: '2027 Medicare.gov Costs', 
    icon: ShieldCheck, 
    desc: 'Official 2027 Medicare Part A, Part B, and Part D costs, deductibles, and caps.',
    shortDesc: 'Complete 2027 CMS cost standards: hospital deductibles, Part B premiums, and the $2,400 Part D cap.',
    badge: '2027 CMS & Medicare.gov Standards',
    keyPoints: [
      {
        title: 'Part A (Hospital Inpatient) Costs',
        text: 'Monthly Premium: $0 for 99%+ of beneficiaries (with 40+ work quarters). Inpatient Hospital Deductible: $1,788 per benefit period (covers the first 60 days of hospitalization). Daily Hospital Coinsurance: Days 1–60: $0/day; Days 61–90: $447/day; Days 91–150 (60 Lifetime Reserve Days): $894/day; Beyond Day 150: 100% of all costs.'
      },
      {
        title: 'Part A Skilled Nursing Facility (SNF) & Hospice',
        text: 'Skilled Nursing Facility Coinsurance: Days 1–20: $0 copay/day; Days 21–100: $223.50/day coinsurance; Beyond Day 100: 100% of costs. Hospice Care is $0 copay for certified palliative services, with nominal copays (up to $5) for symptom-relief prescription medications.'
      },
      {
        title: 'Part B (Medical Outpatient) Premium & Deductible',
        text: 'Standard Monthly Premium: Projected $209.50/month (automatically deducted from Social Security). Annual Deductible: Projected $292.00/year. After the $292 annual deductible, you pay 20% coinsurance for doctor visits, outpatient clinics, labs, and medical equipment.'
      },
      {
        title: 'Original Medicare Has No Maximum Out-of-Pocket Cap',
        text: 'Original Medicare (Parts A & B) has NO annual out-of-pocket spending limit. Your 20% Part B coinsurance and $1,788 hospital deductibles continue without ceiling unless you protect yourself with a Medigap (Supplement) policy or a Medicare Advantage (Part C) plan.'
      },
      {
        title: 'Part D (Prescription Drugs) $2,400 Federal Out-of-Pocket Cap',
        text: 'Under the Inflation Reduction Act statutory formulas, out-of-pocket prescription drug spending is capped at $2,400 annually for 2027. Once your out-of-pocket costs reach $2,400, you pay $0 (100% covered) for all covered formulary drugs for the rest of the calendar year!'
      },
      {
        title: 'Part D $700 Deductible, $35 Insulin & $0 Vaccines',
        text: 'The 2027 statutory maximum Part D deductible is $700. All covered insulin formulations are legally capped at no more than $35 per 30-day supply. In addition, all ACIP-recommended adult vaccines (Shingrix, RSV, Pneumococcal, Tdap, COVID-19, and Flu) are 100% free ($0 copay).'
      },
      {
        title: 'Medicare Prescription Payment Plan (M3P) Monthly Smoothing',
        text: 'Beneficiaries have the statutory right to opt into the M3P program on any Part D or MAPD plan, allowing you to spread out-of-pocket prescription expenses across manageable, interest-free monthly installments throughout the calendar year.'
      },
      {
        title: 'Medigap Plan G & Plan N Protection Against 2027 Gaps',
        text: 'Medigap Plan G covers 100% of the $1,788 Part A hospital deductible, hospital daily coinsurance, and the 20% Part B coinsurance (you pay only the $292 Part B deductible). Plan N provides lower premiums with copays of up to $20 for office visits.'
      }
    ],
    callout: '2027 Financial Protection: The $1,788 hospital deductible and uncapped 20% Part B coinsurance can quickly erode retirement savings. I Will Global independent advisors compare 104+ plans to protect your health and wealth at $0 cost to you.'
  },
  { 
    id: 'getting-started',
    title: 'Getting Started', 
    icon: BookOpen, 
    desc: 'Answers to common questions such as: When should you enroll?',
    shortDesc: 'Understand eligibility, how to enroll, and what to do if you are turning 65.',
    badge: 'Step 1: The Basics',
    keyPoints: [
      {
        title: 'Who is Eligible for Medicare?',
        text: 'U.S. citizens and permanent legal residents who have lived in the U.S. for at least 5 continuous years and are: (1) Age 65 or older, (2) Under 65 with qualifying disabilities (receiving SSDI for 24 months), or (3) Diagnosed with End-Stage Renal Disease (ESRD) or ALS (Lou Gehrig’s disease).'
      },
      {
        title: 'Initial Enrollment Period (IEP)',
        text: 'Your Initial Enrollment Period is a 7-month window: it begins 3 months before your 65th birthday month, includes your birth month, and continues for 3 months after. Enrolling during the first 3 months guarantees your coverage begins on the first day of your birth month.'
      },
      {
        title: 'Automatic vs. Manual Enrollment',
        text: 'If you are already receiving Social Security retirement benefits, you will be automatically enrolled in Medicare Parts A and B. If you are not yet drawing Social Security, you must actively sign up online through SSA.gov or by visiting your local Social Security office.'
      },
      {
        title: 'Working Past 65?',
        text: 'If you or your spouse actively work and have qualifying group health coverage through an employer with 20 or more employees, you can often delay Part B without paying a late-enrollment penalty. Ask your benefits administrator if your plan is considered creditable.'
      }
    ],
    callout: 'Important Tip: Enrolling on time protects you from lifetime late-enrollment penalties on Part B (10% per full 12-month period delayed) and Part D (1% per month delayed).'
  },
  { 
    id: 'enrollment-periods',
    title: 'Enrollment Periods', 
    icon: Calendar, 
    desc: 'Learn the dates when Medicare allows you to make changes to your coverage.',
    shortDesc: 'Deadlines for AEP, OEP, IEP, and Special Enrollment Periods (SEP).',
    badge: 'Key Deadlines & Dates',
    keyPoints: [
      {
        title: 'Annual Enrollment Period (AEP): Oct 15 – Dec 7',
        text: 'The primary national window when all Medicare beneficiaries can join, switch, or drop a Medicare Advantage plan or a Part D Prescription Drug plan. Any plan changes you make during AEP take effect on January 1st of the following year.'
      },
      {
        title: 'Medicare Advantage Open Enrollment (OEP): Jan 1 – Mar 31',
        text: 'If you are already enrolled in a Medicare Advantage plan as of January 1, this period allows you to make a one-time switch to another Medicare Advantage plan or return to Original Medicare and add a Part D prescription plan.'
      },
      {
        title: 'Special Enrollment Periods (SEP): Year-Round',
        text: 'Qualifying life events grant you a Special Enrollment Period outside standard dates. Examples include: moving out of your current plan’s service area, losing employer-sponsored coverage, qualifying for Medicaid or Extra Help, or entering/leaving a long-term care facility.'
      },
      {
        title: 'General Enrollment Period (GEP): Jan 1 – Mar 31',
        text: 'If you missed your Initial Enrollment Period and do not qualify for a Special Enrollment Period, you can sign up for Part A and Part B during GEP. Coverage begins the month after you submit your application.'
      }
    ],
    callout: 'AEP Reminder: Medicare Advantage and Part D plans change every calendar year. Even if you love your current plan, reviewing your formulary and benefit changes every October can save you hundreds in out-of-pocket costs.'
  },
  { 
    id: 'defining-the-abcs',
    title: 'Defining the ABC’s', 
    icon: HelpCircle, 
    desc: 'Learn the "ABC’s", how they work, and your options with each part.',
    shortDesc: 'A clear guide to Medicare Part A, Part B, Part C, and Part D for 2027.',
    badge: 'Coverage Breakdown',
    keyPoints: [
      {
        title: 'Part A: Hospital Inpatient Insurance (2027: $1,788 Deductible)',
        text: 'Covers inpatient hospital stays, care in a skilled nursing facility, hospice care, and home healthcare. Most people receive Part A premium-free ($0/mo with 40+ work quarters). The 2027 hospital deductible is $1,788 per benefit period.'
      },
      {
        title: 'Part B: Medical Outpatient Insurance (2027: $209.50/mo & $292 Deductible)',
        text: 'Covers doctors’ services, outpatient hospital care, screenings, lab tests, ambulance, physical therapy, and durable medical equipment. Standard monthly premium is projected at $209.50/month with an annual deductible of $292.00, followed by 20% coinsurance.'
      },
      {
        title: 'Part C: Medicare Advantage Plans (All-in-One with MOOP)',
        text: 'An all-in-one alternative to Original Medicare offered by Medicare-approved private insurance carriers. Combines Part A, Part B, and usually Part D, while providing legally mandated annual Maximum Out-of-Pocket (MOOP) protection plus dental, vision, and hearing.'
      },
      {
        title: 'Part D: Prescription Drug Coverage (2027: $2,400 Out-of-Pocket Cap)',
        text: 'Covers brand-name and generic prescription medications. Under federal law, out-of-pocket drug spending is capped at $2,400 annually, after which covered drugs are $0. Also includes $35/month insulin and $0 adult vaccines.'
      }
    ],
    callout: 'Original Medicare (Parts A & B) covers 80% of approved medical costs after the $292 Part B deductible, but does NOT have an annual out-of-pocket maximum. A Medigap Supplement (like Plan G) or Medicare Advantage (Part C) plan is essential to cap your financial risk.'
  },
  { 
    id: 'advantage-plans',
    title: 'Advantage Plans', 
    icon: PlusCircle, 
    desc: 'Provided by private companies, Advantage Plans can often save you money.',
    shortDesc: 'Explore $0 premium plans, comprehensive dental, vision, and out-of-pocket caps.',
    badge: 'Part C Options',
    keyPoints: [
      {
        title: 'What is Medicare Advantage (Part C)?',
        text: 'Private insurance companies contracted with Medicare (such as Humana, UnitedHealthcare, Aetna, Cigna, Wellcare) administer your Part A and Part B benefits. Many plans feature $0 monthly plan premiums.'
      },
      {
        title: 'Annual Maximum Out-of-Pocket (MOOP)',
        text: 'Unlike Original Medicare which has no cap on your 20% coinsurance liability, Medicare Advantage plans legally cap your total out-of-pocket spending for medical services in a calendar year, protecting you against catastrophic illness.'
      },
      {
        title: 'Comprehensive Additional Benefits',
        text: 'Most Medicare Advantage plans include coverage for routine dental cleanings and dentures, vision exams and glasses allowances, hearing aids, OTC pharmacy allowances, transportation assistance, and fitness club memberships.'
      },
      {
        title: 'Plan Types: HMO vs. PPO',
        text: 'HMO plans typically require you to receive care from in-network doctors and select a Primary Care Physician (PCP). PPO plans give you greater flexibility to see specialists and out-of-network providers without referrals.'
      }
    ],
    callout: 'Network Verification: When comparing Medicare Advantage plans, always ensure your preferred physicians, specialists, and hospitals participate in the plan’s provider network.'
  },
  { 
    id: 'medicare-part-d',
    title: 'Medicare Part D', 
    icon: Activity, 
    desc: 'Coverage for your medication needs provided by private insurance carriers.',
    shortDesc: '2027 rules: $2,400 federal out-of-pocket cap, $700 deductible, M3P monthly smoothing, and $35 insulin.',
    badge: '2027 Prescription Drug Plans',
    keyPoints: [
      {
        title: 'How Prescription Drug Plans Work',
        text: 'Medicare Part D plans are administered by private insurers. Each plan publishes a formulary (list of covered drugs) organized into 5 tiers: Tier 1 (Preferred Generic), Tier 2 (Generic), Tier 3 (Preferred Brand), Tier 4 (Non-Preferred), and Tier 5 (Specialty).'
      },
      {
        title: 'The Federal $2,400 Out-of-Pocket Maximum (2027)',
        text: 'Under the Inflation Reduction Act statutory formulas, out-of-pocket prescription drug spending is capped at $2,400 annually for 2027. Once you reach $2,400 out-of-pocket, you pay $0 for all covered formulary medications for the rest of the calendar year.'
      },
      {
        title: 'Donut Hole Permanently Eliminated',
        text: 'The historical coverage gap ("donut hole") is completely gone. Beneficiaries proceed directly from their initial coverage phase into the catastrophic phase where Medicare and plans pay 100% of covered drug costs once the $2,400 cap is satisfied.'
      },
      {
        title: 'Medicare Prescription Payment Plan (M3P) Monthly Smoothing',
        text: 'Beneficiaries can opt into the M3P program with any Part D or MAPD plan to divide their out-of-pocket drug costs into predictable, interest-free monthly payments instead of paying large sums at the pharmacy counter.'
      },
      {
        title: '$35 Monthly Insulin Cap & $0 Adult Vaccines',
        text: 'Every Part D plan legally caps out-of-pocket costs at $35 per month per covered insulin product, with no deductible applied. In addition, ACIP-recommended adult vaccines (Shingrix, RSV, Pneumococcal, Tdap, COVID-19, and Flu) are 100% free ($0 copay).'
      },
      {
        title: 'Avoiding the Late Enrollment Penalty (LEP)',
        text: 'If you go without creditable prescription drug coverage for 63 or more consecutive days after your Initial Enrollment Period ends, Medicare permanently assesses a late enrollment penalty added to your monthly premium.'
      }
    ],
    callout: 'Formulary Review: Bring your list of daily prescriptions to your I Will Global consultation. Our advisors check every medication across every available plan to find your lowest annual drug costs.'
  },
  { 
    id: 'supplement-plans',
    title: 'Supplement Plans', 
    icon: Shield, 
    desc: 'Insurance sold by private carriers to cover Medicare’s gaps (MediGap).',
    shortDesc: 'See any doctor nationwide with no network restrictions, covering 2027 deductibles and coinsurance.',
    badge: 'Medigap Policies',
    keyPoints: [
      {
        title: 'What is a Medicare Supplement (Medigap)?',
        text: 'Medigap policies are standardized insurance plans that work alongside Original Medicare. Medicare pays its share of approved health costs first, and your Medigap policy pays its share (such as the 20% Part B coinsurance and the $1,788 Part A hospital deductible).'
      },
      {
        title: 'Nationwide Freedom: No Network Restrictions',
        text: 'With a Medigap plan, you can visit any hospital, doctor, or medical specialist anywhere in the United States, as long as they accept Medicare. No primary care referrals or pre-authorizations are required.'
      },
      {
        title: 'Plan G: 100% Coverage After the $292 Part B Deductible',
        text: 'Plan G is the gold standard for comprehensive coverage. It pays 100% of the $1,788 Part A hospital deductible, hospital daily coinsurance, and the 20% Part B coinsurance. Your only annual medical out-of-pocket expense is the $292 Part B deductible.'
      },
      {
        title: 'Plan N: Lower Premiums with Modest Copayments',
        text: 'Plan N offers lower monthly premiums than Plan G while covering the $1,788 Part A deductible and Part B coinsurance, in exchange for small copayments (up to $20 for office visits and up to $50 for emergency room visits).'
      },
      {
        title: 'The Medigap Open Enrollment Window',
        text: 'You have a 6-month Medigap Open Enrollment Period starting the first month you are both 65 and enrolled in Part B. During this period, insurers cannot reject you or charge more due to pre-existing conditions (guaranteed issue).'
      }
    ],
    callout: 'Budgeting Peace of Mind: While Medigap plans usually require a higher monthly premium than Advantage plans, they provide predictable healthcare costs with virtually no surprise out-of-pocket medical bills.'
  },
  { 
    id: 'special-needs-plans',
    title: 'Special Needs Plans', 
    icon: Heart, 
    desc: 'Tailored plans to meet the needs of individuals with certain health conditions.',
    shortDesc: 'Enhanced benefits for dual eligibles (Medicare + Medicaid) and chronic health conditions.',
    badge: 'Specialized Coverage',
    keyPoints: [
      {
        title: 'Dual Eligible Special Needs Plans (D-SNP)',
        text: 'Designed specifically for individuals who have both Medicare and state Medicaid assistance (such as AHCCCS in Arizona). Benefits often include $0 copays on doctor visits, comprehensive dental and vision, and substantial monthly food/utility allowances.'
      },
      {
        title: 'Chronic Condition Special Needs Plans (C-SNP)',
        text: 'Customized plans for people diagnosed with specific chronic illnesses, including Diabetes, Cardiovascular Disease, Chronic Heart Failure, or Chronic Lung Disorders. C-SNPs feature tailored drug formularies, lower copays on condition treatments, and dedicated care managers.'
      },
      {
        title: 'Institutional Special Needs Plans (I-SNP)',
        text: 'Formulated for beneficiaries who live in a nursing home, long-term care facility, or require nursing-level care at home. Brings healthcare providers and clinical coordination directly to your care residence.'
      },
      {
        title: 'Special Enrollment Year-Round',
        text: 'Individuals who qualify for D-SNPs or C-SNPs often have ongoing Special Enrollment Periods, allowing them to enroll or adjust their plan throughout the year rather than waiting for annual fall enrollment.'
      }
    ],
    callout: 'Find Out If You Qualify: If you receive state Medicaid, food stamps (SNAP), SSI, or have a qualifying chronic condition, our agents can verify your eligibility for enhanced SNP benefits immediately.'
  }
];

const MedicareResources = () => {
  const [activeTab, setActiveTab] = useState('2027-medicare-costs');
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);

  // Handle URL hash changes or direct deep links
  useEffect(() => {
    if (window.location.hash === '#video-guide' || window.location.hash === '#video') {
      setIsVideoModalOpen(true);
    }
    const hash = window.location.hash.replace('#', '');
    if (hash && resources.some((r) => r.id === hash)) {
      setActiveTab(hash);
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const scrollToDetails = () => {
    const el = document.getElementById('details-section');
    if (el) {
      const navHeight = 90;
      const elementPosition = el.getBoundingClientRect().top + window.pageYOffset;
      window.scrollTo({
        top: Math.max(0, elementPosition - navHeight),
        behavior: 'smooth'
      });
    }
  };

  const handleCardClick = (id) => {
    setActiveTab(id);
    scrollToDetails();
  };

  const handleTabClick = (id, e) => {
    setActiveTab(id);
    if (e && e.currentTarget) {
      try {
        e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } catch {
        // fallback
      }
    }
  };

  const currentResource = resources.find((r) => r.id === activeTab) || resources[0];
  const DetailIcon = currentResource.icon || BookOpen;

  return (
    <div className="page-container animate-fade-in">
      {/* Header Banner */}
      <div className="page-header">
        <div className="container">
          <h1 style={{ color: '#ffffff', fontWeight: 800, textShadow: '0 2px 14px rgba(0, 0, 0, 0.8)' }}>
            Medicare Education & Resource Center
          </h1>
          <p style={{ color: '#f8fafc', fontSize: '1.18rem', fontWeight: 400, maxWidth: '800px', margin: '0.65rem auto 0', lineHeight: 1.6, textShadow: '0 1px 6px rgba(0, 0, 0, 0.7)' }}>
            Explore official 2027 Medicare.gov cost standards, key enrollment dates, and clear answers to your Medicare questions.
          </p>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button 
              type="button" 
              className="btn btn-accent"
              onClick={() => { setActiveTab('2027-medicare-costs'); scrollToDetails(); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}
            >
              <ShieldCheck size={18} /> Official 2027 Medicare Costs
            </button>
            <button 
              type="button" 
              className="btn btn-secondary shadow-glow" 
              onClick={() => setIsVideoModalOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontWeight: 700, borderColor: 'var(--accent)', color: '#ffd88a', background: 'rgba(5, 16, 57, 0.85)' }}
            >
              <PlayCircle size={18} color="#ffd88a" /> Watch Video Guide
            </button>
            <a 
              href="tel:(480) 331-9455" 
              className="btn btn-white"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <PhoneCall size={18} /> Call (480) 331-9455
            </a>
          </div>
        </div>
      </div>
      
      <div className="container page-content">
        {/* Interactive Topic Cards Grid */}
        <div className="resources-grid">
          {resources.map((res) => {
            const Icon = res.icon;
            const isSelected = activeTab === res.id;
            return (
              <div 
                key={res.id} 
                className={`resource-card ${isSelected ? 'active-card' : ''}`}
                style={{
                  cursor: 'pointer',
                  borderColor: isSelected ? 'var(--accent)' : undefined,
                  boxShadow: isSelected ? '0 10px 25px rgba(200, 150, 62, 0.15)' : undefined
                }}
                onClick={() => handleCardClick(res.id)}
              >
                <div className="resource-icon" style={{ backgroundColor: isSelected ? 'var(--accent)' : undefined, color: isSelected ? '#051039' : undefined }}>
                  <Icon size={28} />
                </div>
                <div className="resource-text">
                  <h3>{res.title}</h3>
                  <p>{res.desc}</p>
                  <button 
                    type="button"
                    className="text-accent underline-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCardClick(res.id);
                    }}
                  >
                    Learn More &rarr;
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detailed Information & Interactive Tabs Section */}
        <div id="details-section" className="resources-tabs-container">
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              In-Depth Medicare Guide
            </span>
            <h2 style={{ fontSize: '2rem', color: '#051039', fontWeight: 800, marginTop: '0.25rem' }}>
              Explore Topics & Information
            </h2>
            <p style={{ color: '#0f172a', fontSize: '1.05rem', fontWeight: 600, maxWidth: '750px', margin: '0.5rem auto 0', lineHeight: 1.6 }}>
              Select any tab below to review detailed plan options, key rules, and enrollment instructions.
            </p>
          </div>

          {/* Quick Switch Tabs Bar */}
          <div className="tabs-nav" role="tablist" aria-label="Medicare Guide Tabs">
            {resources.map((res) => {
              const TabIcon = res.icon;
              const isActive = activeTab === res.id;
              return (
                <button
                  key={res.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`tab-btn ${isActive ? 'active' : ''}`}
                  onClick={(e) => handleTabClick(res.id, e)}
                >
                  <TabIcon size={16} />
                  <span>{res.title}</span>
                </button>
              );
            })}
          </div>

          {/* Active Detail Display Box */}
          <div className="resource-detail-box animate-fade-in" key={currentResource.id} id={currentResource.id}>
            <div className="resource-detail-header">
              <div className="resource-icon" style={{ width: '4rem', height: '4rem' }}>
                <DetailIcon size={32} />
              </div>
              <div>
                <span className="badge badge-gold" style={{ fontSize: '0.75rem', marginBottom: '0.35rem', display: 'inline-block' }}>
                  {currentResource.badge}
                </span>
                <h2 style={{ color: '#051039', fontWeight: 800 }}>{currentResource.title}</h2>
                <p style={{ color: '#0f172a', margin: '0.35rem 0 0', fontSize: '1.05rem', fontWeight: 600, lineHeight: 1.5 }}>
                  {currentResource.shortDesc}
                </p>
              </div>
            </div>

            {/* Key Information Cards Grid */}
            <div className="info-cards-grid">
              {currentResource.keyPoints.map((point, idx) => (
                <div key={idx} className="info-card">
                  <h4>
                    <CheckCircle size={18} color="var(--accent)" />
                    {point.title}
                  </h4>
                  <p>{point.text}</p>
                </div>
              ))}
            </div>

            {/* Callout Alert / Pro-Tip */}
            {currentResource.callout && (
              <div className="resource-callout">
                <strong>Expert Insight: </strong>
                {currentResource.callout}
              </div>
            )}

            {/* Official 2027 Medicare Video Guide Player Showcase */}
            {currentResource.id === '2027-medicare-costs' && (
              <div style={{ marginTop: '2rem', marginBottom: '1rem', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 15px 45px rgba(0,0,0,0.5)' }}>
                <IWGBrandedVideoPlayer 
                  src="/videos/medicare-guide-2027.mp4"
                  fileId="1MibMsPiM6X6i0uYCQBQYSLzTYdA9ITnz"
                  title="Official 2027 Medicare Video Guide"
                  subtitle="Complete Medicare Breakdown: Parts A, B, C, D & Medigap Pathways"
                  badge="2027 Medicare Guide"
                  loadingText="Loading Official Medicare Video Guide..."
                />
              </div>
            )}

            {/* Official 2027 Medicare.gov Quick Reference Table */}
            {currentResource.id === '2027-medicare-costs' && (
              <div style={{ marginTop: '2rem', background: '#0a163b', borderRadius: '12px', border: '1.5px solid var(--accent)', padding: '1.5rem', overflowX: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.45)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
                  <ShieldCheck size={24} color="var(--accent)" />
                  <div>
                    <h3 style={{ color: '#ffffff', margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                      Official 2027 Medicare.gov Costs & Benefit Parameters
                    </h3>
                    <div style={{ fontSize: '0.82rem', color: '#ffd88a', fontWeight: 600 }}>
                      Based on CMS Statutory Formulas & The Inflation Reduction Act
                    </div>
                  </div>
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ffffff', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ background: '#051039', borderBottom: '2px solid var(--accent)', textAlign: 'left' }}>
                      <th style={{ padding: '0.85rem 1rem', color: '#ffd88a', fontWeight: 800 }}>Medicare Program</th>
                      <th style={{ padding: '0.85rem 1rem', color: '#ffd88a', fontWeight: 800 }}>2027 Premium</th>
                      <th style={{ padding: '0.85rem 1rem', color: '#ffd88a', fontWeight: 800 }}>2027 Deductible</th>
                      <th style={{ padding: '0.85rem 1rem', color: '#ffd88a', fontWeight: 800 }}>2027 Coinsurance / Out-of-Pocket Cap</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <td style={{ padding: '0.9rem 1rem', fontWeight: 700 }}>
                        <div>Part A: Hospital Insurance</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Inpatient hospital & skilled nursing</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <span className="badge badge-success" style={{ fontWeight: 700 }}>$0 / month</span>
                        <div style={{ fontSize: '0.72rem', color: '#cbd5e1', marginTop: '2px' }}>With 40+ work quarters</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <strong style={{ color: '#ffd88a' }}>$1,788</strong> per benefit period
                        <div style={{ fontSize: '0.72rem', color: '#cbd5e1', marginTop: '2px' }}>Covers first 60 hospital days</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem', fontSize: '0.85rem' }}>
                        <div>Days 1–60: <strong>$0/day</strong></div>
                        <div>Days 61–90: <strong>$447/day</strong></div>
                        <div>Days 91–150: <strong>$894/day</strong> (Lifetime reserve)</div>
                        <div>SNF Days 21–100: <strong>$223.50/day</strong></div>
                      </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <td style={{ padding: '0.9rem 1rem', fontWeight: 700 }}>
                        <div>Part B: Medical Insurance</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Doctors, clinics, labs & therapy</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <strong>$209.50 / month</strong>
                        <div style={{ fontSize: '0.72rem', color: '#cbd5e1', marginTop: '2px' }}>Projected standard base premium</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <strong style={{ color: '#ffd88a' }}>$292.00 / year</strong>
                        <div style={{ fontSize: '0.72rem', color: '#cbd5e1', marginTop: '2px' }}>Annual outpatient deductible</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem', fontSize: '0.85rem' }}>
                        <strong style={{ color: '#f87171' }}>20% Coinsurance</strong> after deductible
                        <div style={{ color: '#fca5a5', fontSize: '0.78rem', fontWeight: 600 }}>⚠️ NO ANNUAL OUT-OF-POCKET CAP</div>
                      </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <td style={{ padding: '0.9rem 1rem', fontWeight: 700 }}>
                        <div>Part D: Prescription Drugs</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Formulary brand & generic Rx</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        Varies by plan
                        <div style={{ fontSize: '0.72rem', color: '#cbd5e1', marginTop: '2px' }}>$41.33 base statutory benchmark</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        Max <strong>$700.00 / year</strong>
                        <div style={{ fontSize: '0.72rem', color: '#cbd5e1', marginTop: '2px' }}>Many plans offer $0 on Tiers 1 & 2</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem', fontSize: '0.85rem' }}>
                        <span className="badge badge-success" style={{ fontWeight: 800, fontSize: '0.82rem' }}>$2,400 Out-of-Pocket Cap</span>
                        <div style={{ color: '#6ee7b7', fontSize: '0.78rem', marginTop: '3px', fontWeight: 600 }}>
                          100% Covered ($0 copay) after $2,400
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '2px' }}>
                          $35/mo Insulin Cap | $0 Adult Vaccines | M3P Monthly Smoothing
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '0.9rem 1rem', fontWeight: 700 }}>
                        <div>Medigap Plan G</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Medicare Supplement policy</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        Carrier monthly premium
                        <div style={{ fontSize: '0.72rem', color: '#cbd5e1', marginTop: '2px' }}>Age & location rated</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <strong style={{ color: '#6ee7b7' }}>Covers Part A ($1,788)</strong>
                        <div style={{ fontSize: '0.72rem', color: '#cbd5e1', marginTop: '2px' }}>You only pay $292 Part B deductible</div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem', fontSize: '0.85rem' }}>
                        <strong style={{ color: '#6ee7b7' }}>100% Coverage</strong> for hospital coinsurance, SNF copays, and the 20% Part B coinsurance nationwide.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Next Steps & Advisor Contact Call-to-Action */}
            <div className="resource-cta-row">
              <div>
                <div style={{ fontWeight: 800, color: '#051039', fontSize: '1.1rem' }}>
                  Have questions about {currentResource.title}?
                </div>
                <div style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 600, marginTop: '4px' }}>
                  Our licensed agents will compare all available carrier plans in your area at no cost to you.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <a href="tel:(480) 331-9455" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <PhoneCall size={16} /> Call (480) 331-9455
                </a>
                <a href="https://my.destinationrx.com/hub/s/SMPJW7R2A" target="_blank" rel="noreferrer" className="btn btn-accent" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FileText size={16} /> Find a Plan (Medicare) ↗
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Banner */}
        <div className="mt-4 content-card text-center bg-light">
          <h2 style={{ color: '#051039', fontWeight: 800 }}>Need Personalized 2027 Guidance?</h2>
          <p style={{ color: '#0f172a', fontSize: '1.05rem', fontWeight: 500, lineHeight: 1.6 }}>
            Medicare does not have to be confusing. I Will Global represents major carriers across Arizona, Texas, California, Nevada, Florida, New Mexico, and Colorado to help you find the plan that fits your doctors, medications, and budget.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.25rem', flexWrap: 'wrap' }}>
            <button 
              type="button" 
              className="btn btn-accent"
              onClick={() => { setActiveTab('2027-medicare-costs'); scrollToDetails(); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}
            >
              <ShieldCheck size={16} /> View 2027 Medicare Costs
            </button>
            <button 
              type="button" 
              className="btn btn-secondary"
              onClick={() => setIsVideoModalOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, borderColor: 'var(--accent)', color: '#ffd88a', background: 'rgba(5, 16, 57, 0.85)' }}
            >
              <PlayCircle size={16} color="#ffd88a" /> Watch Video Guide
            </button>
            <a href="tel:(480) 331-9455" className="btn btn-primary">
              Speak With a Licensed Agent: (480) 331-9455
            </a>
            <a href="https://my.destinationrx.com/hub/s/SMPJW7R2A" target="_blank" rel="noreferrer" className="btn btn-secondary" title="Find a Medicare Plan Online via DestinationRx">
              Find a Medicare Plan Online ↗
            </a>
          </div>
          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.08)', fontSize: '0.85rem', color: '#475569' }}>
            * Note: "Find a Plan" is specifically for Medicare. For all other quotes (Life, Group, Health, Annuities, LTC), please call <strong>(480) 331-9455</strong> or email <strong>info@iwillglobal.com</strong>.
          </div>
        </div>
      </div>

      {/* Official 2027 Medicare Video Guide Modal */}
      <VideoGuideModal 
        isOpen={isVideoModalOpen} 
        onClose={() => setIsVideoModalOpen(false)}
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

export default MedicareResources;
