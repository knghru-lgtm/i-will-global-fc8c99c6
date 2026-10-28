import { daysUntil65, inIEP, ageOn } from './enrollment.ts';

/**
 * Explainable lead score (0–100). Deterministic so it works without AI; Gemini can add narrative on top.
 * Signals: enrollment window urgency, intent/source quality, engagement, contactability.
 */
export function scoreLead(lead: any, on = new Date()): { score: number; score_reason: string } {
  let score = 30;
  const reasons: string[] = [];

  if (lead.dob) {
    try {
      const d65 = daysUntil65(lead.dob, on);
      if (inIEP(lead.dob, on)) { score += 25; reasons.push('In Initial Enrollment Period'); }
      else if (d65 > 0 && d65 <= 180) { score += 18; reasons.push(`Turns 65 in ${d65} days`); }
      else if (ageOn(lead.dob, on) >= 65) { score += 8; reasons.push('Medicare-eligible (AEP/SEP)'); }
      else if (d65 > 180) { score -= 10; reasons.push('Not yet near Medicare eligibility'); }
    } catch {
      // Safe fallback if dob is unparseable
    }
  }

  const src = String(lead.source || '').toLowerCase();
  if (src.includes('referral')) { score += 15; reasons.push('Referral source'); }
  else if (src.includes('website') || src.includes('chat')) { score += 10; reasons.push('Inbound web inquiry'); }
  else if (src.includes('event') || src.includes('seminar')) { score += 8; reasons.push('Seminar/event attendee'); }
  else if (src.includes('purchased') || src.includes('list')) { score -= 5; reasons.push('Purchased list'); }

  if (lead.tcpa_consent) { score += 8; reasons.push('TCPA consent on file'); }
  const status = String(lead.status || '');
  if (status === 'SOA Signed') { score += 15; reasons.push('SOA signed'); }
  else if (status === 'Appointment Set') { score += 12; reasons.push('Appointment set'); }
  else if (status === 'Contacted') { score += 5; reasons.push('Has been reached'); }

  const ld = String(lead.last_disposition || '');
  if (/interested|callback/i.test(ld) && !/not interested/i.test(ld)) { score += 8; reasons.push(`Last call: ${ld}`); }
  if (/not interested|not eligible/i.test(ld)) { score -= 20; reasons.push(`Last call: ${ld}`); }

  const attempts = Number(lead.attempts || 0);
  if (attempts >= 6) { score -= 12; reasons.push(`${attempts} attempts without conversion`); }
  else if (attempts >= 3) { score -= 5; }

  if (lead.dnc) { score = 0; reasons.unshift('Do Not Call'); }
  if (lead.phone_invalid && !lead.email) { score -= 15; reasons.push('No valid phone'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, score_reason: reasons.slice(0, 4).join(' • ') || 'Baseline score' };
}
