/** Curated, general Medicare education used by the customer-facing assistant (demo mode + grounding for Gemini). */
export const MEDICARE_KB: Array<{ id: string; keywords: RegExp; answer: string }> = [
  {
    id: 'parts',
    keywords: /\b(parts?|abc|a b c|what is medicare|how does medicare work|part a|part b|part c|part d)\b/i,
    answer:
      'Medicare has four main parts:\n\n• **Part A** — hospital insurance (inpatient stays, skilled nursing, hospice).\n• **Part B** — medical insurance (doctor visits, outpatient care, preventive services).\n• **Part C (Medicare Advantage)** — private plans that bundle A and B, often with drug coverage and extras.\n• **Part D** — prescription drug coverage from private insurers.\n\nWould you like a licensed agent to walk through how these apply to you?',
  },
  {
    id: 'aep',
    keywords: /\b(aep|annual enrollment|open enrollment|when can i (change|switch)|october|december|enrollment period)\b/i,
    answer:
      'The **Annual Enrollment Period (AEP)** runs **October 15 – December 7** each year. During AEP you can join, switch, or drop a Medicare Advantage or Part D plan, with changes effective January 1.\n\nThere\'s also the **Medicare Advantage Open Enrollment Period, January 1 – March 31**, when people already in an Advantage plan can make one change.',
  },
  {
    id: 'iep',
    keywords: /\b(turning 65|turn 65|new to medicare|initial enrollment|iep|first time|when (should|do) i (sign up|enroll))\b/i,
    answer:
      'Your **Initial Enrollment Period** is 7 months long: it starts **3 months before** the month you turn 65, includes your birthday month, and ends **3 months after**. Enrolling early helps avoid gaps in coverage and possible late-enrollment penalties.\n\nOur licensed agents help people turning 65 at no cost — want me to set up a time?',
  },
  {
    id: 'medigap',
    keywords: /\b(medigap|supplement|supplemental|plan g|plan n|plan f)\b/i,
    answer:
      '**Medicare Supplement (Medigap)** plans are sold by private insurers to help pay costs Original Medicare doesn\'t cover, like deductibles and coinsurance. They work alongside Parts A and B, and drug coverage usually comes from a separate Part D plan.\n\nThe best time to buy is often your Medigap Open Enrollment Period — the 6 months after your Part B starts.',
  },
  {
    id: 'advantage',
    keywords: /\b(advantage|mapd|part c|hmo|ppo)\b/i,
    answer:
      '**Medicare Advantage (Part C)** plans are offered by private companies approved by Medicare. They include Part A and B coverage and often add prescription drug coverage and extra benefits. Plans use provider networks (like HMO or PPO), so it\'s important to check your doctors and medications.\n\nA licensed agent can compare the options we offer in your area.',
  },
  {
    id: 'partd',
    keywords: /\b(drug|prescription|medication|pharmacy|rx|pdp)\b/i,
    answer:
      '**Part D** covers prescription drugs and is offered by private insurers, either as a standalone plan or included in many Medicare Advantage plans. Each plan has its own list of covered drugs (formulary) and pharmacy network, so reviewing your medications each year is a smart move.',
  },
  {
    id: 'snp',
    keywords: /\b(snp|special needs|dual|medicaid|d-snp|chronic)\b/i,
    answer:
      '**Special Needs Plans (SNPs)** are Medicare Advantage plans designed for people with specific needs — for example, those who have both Medicare and Medicaid (D-SNP), certain chronic conditions (C-SNP), or who live in an institution (I-SNP).',
  },
  {
    id: 'cost',
    keywords: /\b(cost|charge|fee|free|pay you|how much (do|does) (you|it)|no cost)\b/i,
    answer:
      'Working with I Will Global is **free** — our licensed agents provide Medicare guidance and enrollment assistance at no cost and no obligation to you.',
  },
  {
    id: 'about',
    keywords: /\b(who are you|about (you|i will global)|what do you do|i will global|iwg)\b/i,
    answer:
      'I Will Global is an independent insurance agency. Our licensed agents shop multiple carriers to help you find Medicare coverage that fits your needs — at no cost to you. You can reach us at (480) 331-9455 or info@iwillglobal.com.',
  },
];

export function kbLookup(text: string) {
  return MEDICARE_KB.find((k) => k.keywords.test(text)) || null;
}

export const KB_TEXT = MEDICARE_KB.map((k) => k.answer.replace(/\*\*/g, '')).join('\n\n');
