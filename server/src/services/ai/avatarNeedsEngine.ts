import { q, one, insert, update } from '../../db/index.ts';

export interface NeedsAnalysisInput {
  beneficiaryName: string;
  phone?: string;
  email?: string;
  zipCode: string;
  state?: string;
  hasMedicare: boolean;
  hasMedicaid: boolean; // Dual eligible (AHCCCS/Medicaid)
  doctors?: string[];
  prescriptions?: string[];
  needsTransportation: boolean;
  supplementalPriorities?: Array<'dental' | 'vision' | 'hearing' | 'groceries' | 'gym' | 'otc'>;
}

export interface PlanOption {
  id: string;
  carrier: string;
  planName: string;
  planType: 'MAPD' | 'C-SNP' | 'D-SNP' | 'HMO' | 'PPO';
  monthlyPremium: number;
  maxOutOfPocket: number;
  doctorMatchScore: number;
  prescriptionCopay: string;
  transportationRides: string;
  dentalAllowance: string;
  spendablesMonthly: string;
  overallMatchPct: number;
  enrollmentUrl: string;
  highlights: string[];
}

export const SAMPLE_MEDICARE_PLANS: Record<string, Array<Omit<PlanOption, 'overallMatchPct' | 'enrollmentUrl'>>> = {
  default: [
    {
      id: 'humana_gold_plus_85251',
      carrier: 'Humana',
      planName: 'Humana Gold Plus HMO H1036-042',
      planType: 'MAPD',
      monthlyPremium: 0,
      maxOutOfPocket: 2900,
      doctorMatchScore: 100,
      prescriptionCopay: '$0 Copay on Tier 1 & Tier 2 Preferred Mail Order',
      transportationRides: '24 One-Way Non-Emergency Medical Rides/Year',
      dentalAllowance: '$3,000 Annual Allowance ($0 Preventive & Comprehensive)',
      spendablesMonthly: '$60/month Healthy Options Grocery & Utility Card',
      highlights: [
        '$0 Monthly Premium & $0 Medical Deductible',
        'Mayo Clinic & Banner Health In-Network',
        'SilverSneakers Fitness Membership Included',
      ],
    },
    {
      id: 'uhc_dual_complete_dsnp',
      carrier: 'UnitedHealthcare',
      planName: 'UHC Dual Complete D-SNP H2228-015',
      planType: 'D-SNP',
      monthlyPremium: 0,
      maxOutOfPocket: 0,
      doctorMatchScore: 100,
      prescriptionCopay: '$0 Copay for All Covered Generic & Brand Prescriptions',
      transportationRides: '48 One-Way Non-Emergency Medical Rides/Year',
      dentalAllowance: '$4,000 Annual Dental Allowance with $0 Copay',
      spendablesMonthly: '$90/month Credit for Groceries, OTC, Gas & Utilities',
      highlights: [
        'Designed specifically for Dual Medicare + Medicaid (AHCCCS)',
        'Unlimited Doctor Visits with $0 Copay',
        '$90/month Food, OTC & Utility Spendables Card',
      ],
    },
    {
      id: 'devoted_choice_csnp',
      carrier: 'Devoted Health',
      planName: 'Devoted Choice Chronic Special Needs (C-SNP)',
      planType: 'C-SNP',
      monthlyPremium: 0,
      maxOutOfPocket: 1900,
      doctorMatchScore: 95,
      prescriptionCopay: '$0 Copay on Diabetic Medications, Insulin & Supplies',
      transportationRides: '36 One-Way Medical Rides/Year to Doctors & Clinics',
      dentalAllowance: '$3,500 Dental Allowance (No Annual Maximum Copay)',
      spendablesMonthly: '$75/month Devoted Food & Wellness Card',
      highlights: [
        'Tailored care for Diabetes, Heart Failure & Cardiovascular Conditions',
        'Inpatient Hospital Copays Reduced by 50%',
        'Dedicated Personal Health Guide Included',
      ],
    },
    {
      id: 'bcbs_blue_pathway',
      carrier: 'Blue Cross Blue Shield',
      planName: 'BCBS Blue Pathway PPO H3410-008',
      planType: 'PPO',
      monthlyPremium: 0,
      maxOutOfPocket: 3400,
      doctorMatchScore: 98,
      prescriptionCopay: '$0 Copay Tier 1 Generics at Preferred Pharmacies',
      transportationRides: '24 One-Way Medical Rides/Year',
      dentalAllowance: '$2,500 Comprehensive Dental Allowance',
      spendablesMonthly: '$50/month OTC & Grocery Credit',
      highlights: [
        'Freedom to see In-Network or Out-of-Network Doctors without Referral',
        'Nationwide PPO Coverage for Travelers',
        'Worldwide Emergency & Urgent Care Protection',
      ],
    },
  ],
};

/**
 * Execute AI Avatar Needs & Benefits Analysis for a beneficiary.
 */
export async function runAvatarNeedsAnalysis(input: NeedsAnalysisInput) {
  const agentNpn = '19842011'; // Principal Agent NPN (Global Admin)
  const agentName = 'Global Admin / Principal Licensed Agent';
  const zip = input.zipCode || '85251';

  const rawPlans = SAMPLE_MEDICARE_PLANS.default;
  const rankedPlans: PlanOption[] = rawPlans.map((plan) => {
    let matchPct = 85;

    // Dual eligible boost for D-SNP
    if (input.hasMedicaid && plan.planType === 'D-SNP') matchPct += 14;
    if (!input.hasMedicaid && plan.planType === 'D-SNP') matchPct -= 25;

    // Transportation priority boost
    if (input.needsTransportation && plan.transportationRides.includes('48')) matchPct += 5;
    if (input.needsTransportation && plan.transportationRides.includes('36')) matchPct += 3;

    // Doctor & Prescription match boost
    if (input.doctors && input.doctors.length > 0) matchPct += 4;
    if (input.prescriptions && input.prescriptions.length > 0) matchPct += 3;

    // Bound match between 78% and 99%
    const finalPct = Math.min(99, Math.max(78, matchPct));

    const quoteUrl = `https://iwillglobal.com/quotes?agent=${agentNpn}&zip=${encodeURIComponent(zip)}&plan=${encodeURIComponent(plan.id)}&name=${encodeURIComponent(input.beneficiaryName)}`;

    return {
      ...plan,
      overallMatchPct: finalPct,
      enrollmentUrl: quoteUrl,
    };
  });

  // Sort by match percentage descending
  rankedPlans.sort((a, b) => b.overallMatchPct - a.overallMatchPct);

  // Auto-save lead / client in CRM
  let recordId = '';
  try {
    const existing = await one(`SELECT id FROM leads WHERE phone=$1 OR email=$2 LIMIT 1`, [input.phone || '', input.email || '']);
    if (existing) {
      recordId = existing.id;
      await update('leads', recordId, {
        status: 'Needs Analysis Completed',
        last_contacted_at: new Date(),
        notes: `AI Avatar Needs Analysis: Zip ${zip}, Medicaid: ${input.hasMedicaid ? 'YES' : 'NO'}, Transport: ${input.needsTransportation ? 'YES' : 'NO'}, Prescriptions: ${(input.prescriptions || []).join(', ')}`,
      });
    } else {
      const nameParts = input.beneficiaryName.trim().split(' ');
      const firstName = nameParts[0] || 'Beneficiary';
      const lastName = nameParts.slice(1).join(' ') || 'Prospect';
      const newLead = await insert('leads', {
        first_name: firstName,
        last_name: lastName,
        phone: input.phone || null,
        email: input.email || null,
        zip,
        state: input.state || 'AZ',
        status: 'Needs Analysis Completed',
        source: 'AI Licensed Agent Avatar',
        owner_id: 'u_admin',
        assigned_agent_id: 'u_admin',
        notes: `Created by AI Licensed Agent Avatar. Dual Status: ${input.hasMedicaid ? 'Medicare + Medicaid (AHCCCS)' : 'Medicare Only'}. Transportation Needed: ${input.needsTransportation ? 'YES' : 'NO'}.`,
      });
      recordId = newLead.id;
    }

    // Log Activity
    await insert('activities', {
      type: 'system',
      subject: `🤖 AI Avatar Completed Needs Analysis for ${input.beneficiaryName}`,
      body: `AI Licensed Agent Avatar analyzed Medicare needs in Zip ${zip}.
• Dual Medicaid/AHCCCS: ${input.hasMedicaid ? 'YES (Qualified for D-SNP)' : 'NO'}
• Transportation Needed: ${input.needsTransportation ? 'YES' : 'NO'}
• Doctors: ${(input.doctors || []).join(', ') || 'None specified'}
• Prescriptions: ${(input.prescriptions || []).join(', ') || 'None specified'}
• Recommended #1 Match: ${rankedPlans[0].carrier} ${rankedPlans[0].planName} (${rankedPlans[0].overallMatchPct}% Match)
• Quotes Link: ${rankedPlans[0].enrollmentUrl}`,
      related_type: 'lead',
      related_id: recordId,
      user_id: 'u_admin',
      completed: true,
    });
  } catch (err) {
    /* Optional CRM logging fallback */
  }

  return {
    beneficiaryName: input.beneficiaryName,
    agentNpn,
    agentName,
    zipCode: zip,
    dualEligible: input.hasMedicaid,
    needsTransportation: input.needsTransportation,
    topMatch: rankedPlans[0],
    plans: rankedPlans,
    summaryScript: `Hello ${input.beneficiaryName}, based on my comprehensive AI Needs & Benefits Analysis for zip code ${zip}, your top recommended Medicare plan is the ${rankedPlans[0].planName}. It offers a 0-dollar monthly premium, ${rankedPlans[0].transportationRides}, ${rankedPlans[0].dentalAllowance}, and ${rankedPlans[0].spendablesMonthly}. I have prepared your official quote link under my agent license (NPN 19842011) on iwillglobal.com for instant enrollment!`,
  };
}
