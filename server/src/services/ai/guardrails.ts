/** Compliance guardrails for AI (customer-facing and agent-facing). */

const SSN_RE = /\b(?!000|666|9\d\d)\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g;
// Medicare Beneficiary Identifier: 11 chars, pattern C A AN N A AN N A A N N (excludes S,L,O,I,B,Z)
const MBI_RE = /\b[1-9][AC-HJKMNP-RT-Yac-hjkmnp-rt-y][AC-HJKMNP-RT-Yac-hjkmnp-rt-y0-9]\d-?[AC-HJKMNP-RT-Yac-hjkmnp-rt-y][AC-HJKMNP-RT-Yac-hjkmnp-rt-y0-9]\d-?[AC-HJKMNP-RT-Yac-hjkmnp-rt-y]{2}\d{2}\b/g;
const CARD_RE = /\b(?:\d[ -]?){13,16}\b/g;

export function redactSensitive(text: string): { text: string; found: string[] } {
  const found: string[] = [];
  let out = text;
  if (MBI_RE.test(out)) { found.push('Medicare number'); out = out.replace(MBI_RE, '[MBI REDACTED]'); }
  MBI_RE.lastIndex = 0;
  if (SSN_RE.test(out)) { found.push('Social Security number'); out = out.replace(SSN_RE, '[SSN REDACTED]'); }
  SSN_RE.lastIndex = 0;
  if (CARD_RE.test(out)) { found.push('card/account number'); out = out.replace(CARD_RE, '[NUMBER REDACTED]'); }
  CARD_RE.lastIndex = 0;
  return { text: out, found };
}

/** Requests that require a licensed agent with an SOA on file (plan-specific benefits / recommendations / enrollment). */
export function needsLicensedAgent(text: string): boolean {
  const t = text.toLowerCase();
  return /(which|what|best|recommend|should i (get|choose|pick|enroll)|compare).{0,40}(plan|advantage|supplement|medigap|part d|carrier)/.test(t)
    || /(enroll|sign me up|switch (my )?plan|apply for)/.test(t)
    || /(humana|aetna|unitedhealthcare|uhc|wellcare|blue cross|cigna|devoted|scan|alignment|aarp).{0,30}(plan|cover|premium|copay|benefit)/.test(t)
    || /(premium|copay|deductible|out of pocket|formulary|network).{0,30}(plan|for me|my)/.test(t);
}

export function wantsHuman(text: string): boolean {
  return /\b(human|real person|agent|representative|someone|call me|speak|talk to)\b/i.test(text);
}

/** Phrases unlicensed schedulers must avoid (benefit discussion). */
const BENEFIT_TERMS = ['premium', 'copay', 'co-pay', 'deductible', 'formulary', 'giveback', 'dental benefit', 'out-of-pocket', 'moop', 'star rating', 'network'];

export function schedulerBenefitFlags(text: string): string[] {
  const t = text.toLowerCase();
  return BENEFIT_TERMS.filter((w) => t.includes(w));
}

export const CUSTOMER_AI_DISCLAIMER =
  'I\'m an AI assistant for I Will Global, a licensed insurance agency. I can share general Medicare information and connect you with a licensed agent.';
