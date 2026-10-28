import { promises as dns } from 'node:dns';
import { config } from '../config.ts';

export interface DnsCheckResult {
  domain: string;
  timestamp: string;
  overallScore: number; // 0 - 100
  status: 'OPTIMAL' | 'ACTION_REQUIRED' | 'CRITICAL';
  spf: {
    status: 'PASS' | 'WARN' | 'FAIL';
    record?: string;
    details: string;
    recommendation?: string;
  };
  dkim: {
    status: 'PASS' | 'WARN' | 'FAIL';
    record?: string;
    details: string;
    recommendation?: string;
  };
  dmarc: {
    status: 'PASS' | 'WARN' | 'FAIL';
    record?: string;
    details: string;
    recommendation?: string;
  };
  mx: {
    status: 'PASS' | 'WARN' | 'FAIL';
    records: Array<{ exchange: string; priority: number }>;
    details: string;
  };
  googleYahooCompliance2024: {
    compliant: boolean;
    missingRequirements: string[];
  };
  recommendedDnsRecords: Array<{
    type: 'TXT' | 'MX' | 'CNAME';
    host: string;
    value: string;
    priority?: number;
    purpose: string;
    status: 'ACTIVE' | 'MISSING' | 'UPDATE_RECOMMENDED';
  }>;
}

export interface ContentSpamAnalysis {
  spamScore: number; // 0 (clean) to 100 (extreme spam risk)
  deliverabilityRating: 'Excellent' | 'Good' | 'Moderate Risk' | 'High Spam Risk';
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  canSpamCompliant: boolean;
  googleYahooCompliant: boolean;
  issues: string[];
  suggestions: string[];
  detectedTriggerWords: string[];
  cleanSubjectRecommendation?: string;
}

// Known high-risk and medium-risk spam trigger words common in insurance / sales
const HIGH_RISK_TRIGGERS = [
  '100% free', 'guaranteed', 'risk-free', 'risk free', 'no catch', 'act now', 'urgent',
  'apply now', 'instant approval', 'cash prize', '$$$', 'earn money', 'unlimited',
  'exclusive deal', 'winner', 'miracle', 'lowest price', 'secret', 'no obligation whatsoever',
  'congratulations!', 'call immediately', 'act immediately', 'you have been selected'
];

const MEDIUM_RISK_TRIGGERS = [
  'free', 'affordable', 'cheap', 'bonus', 'save big', 'discount', 'special promotion',
  'rates dropped', 'limited time', 'dont delete', 'opportunity', 'certified', 'pure profit',
  'click here', 'click below', 'dear friend', 'as seen on', 'cancel at any time'
];

/**
 * Check live DNS records for iwillglobal.com (or custom domain) for SPF, DKIM, DMARC, and MX
 */
export async function checkDomainDeliverability(domain = 'iwillglobal.com'): Promise<DnsCheckResult> {
  const cleanDomain = domain.trim().toLowerCase();
  let spfStatus: 'PASS' | 'WARN' | 'FAIL' = 'FAIL';
  let spfRecord = '';
  let spfDetails = 'No SPF record found.';

  let dkimStatus: 'PASS' | 'WARN' | 'FAIL' = 'FAIL';
  let dkimRecord = '';
  let dkimDetails = 'No Google Workspace DKIM record found at google._domainkey.' + cleanDomain;

  let dmarcStatus: 'PASS' | 'WARN' | 'FAIL' = 'FAIL';
  let dmarcRecord = '';
  let dmarcDetails = 'No DMARC record found at _dmarc.' + cleanDomain;

  let mxStatus: 'PASS' | 'WARN' | 'FAIL' = 'FAIL';
  let mxRecords: Array<{ exchange: string; priority: number }> = [];
  let mxDetails = 'No MX records found.';

  // 1. Check MX Records
  try {
    const rawMx = await dns.resolveMx(cleanDomain);
    mxRecords = rawMx.map((m) => ({ exchange: m.exchange, priority: m.priority }));
    if (mxRecords.some((m) => m.exchange.toLowerCase().includes('google'))) {
      mxStatus = 'PASS';
      mxDetails = `Google Workspace MX active (${mxRecords.map((m) => m.exchange).join(', ')}).`;
    } else if (mxRecords.length > 0) {
      mxStatus = 'PASS';
      mxDetails = `MX records active (${mxRecords.map((m) => m.exchange).join(', ')}).`;
    }
  } catch (err: any) {
    mxDetails = `MX query failed: ${err.message}`;
  }

  // 2. Check SPF (TXT on root domain)
  try {
    const txts = await dns.resolveTxt(cleanDomain);
    const flat = txts.map((chunks) => chunks.join(''));
    const foundSpf = flat.find((t) => t.toLowerCase().startsWith('v=spf1'));
    if (foundSpf) {
      spfRecord = foundSpf;
      if (foundSpf.includes('_spf.google.com')) {
        spfStatus = 'PASS';
        spfDetails = 'SPF record is active and authorizes Google Workspace (_spf.google.com).';
      } else {
        spfStatus = 'WARN';
        spfDetails = 'SPF record exists but does not explicitly include Google Workspace (_spf.google.com).';
      }
    }
  } catch (err: any) {
    spfDetails = `SPF query failed: ${err.message}`;
  }

  // 3. Check DKIM (TXT on google._domainkey.domain)
  try {
    const dkimTxts = await dns.resolveTxt(`google._domainkey.${cleanDomain}`);
    const flatDkim = dkimTxts.map((chunks) => chunks.join(''));
    const foundDkim = flatDkim.find((t) => t.includes('v=DKIM1') || t.includes('p=MIIB'));
    if (foundDkim) {
      dkimRecord = foundDkim;
      dkimStatus = 'PASS';
      dkimDetails = '2048-bit Google Workspace DKIM cryptographic public key is published in DNS.';
    }
  } catch (err: any) {
    dkimDetails = `DKIM record not detected at google._domainkey.${cleanDomain}: ${err.message}`;
  }

  // 4. Check DMARC (TXT on _dmarc.domain)
  try {
    const dmarcTxts = await dns.resolveTxt(`_dmarc.${cleanDomain}`);
    const flatDmarc = dmarcTxts.map((chunks) => chunks.join(''));
    const foundDmarc = flatDmarc.find((t) => t.toLowerCase().startsWith('v=dmarc1'));
    if (foundDmarc) {
      dmarcRecord = foundDmarc;
      dmarcStatus = foundDmarc.includes('p=reject') || foundDmarc.includes('p=quarantine') ? 'PASS' : 'WARN';
      dmarcDetails = `DMARC record is published (${foundDmarc}).`;
    }
  } catch (err: any) {
    dmarcStatus = 'FAIL';
    dmarcDetails = `DMARC is missing in DNS. Google and Yahoo mandate a DMARC policy for all sending domains since Feb 2024.`;
  }

  // Calculate Overall Deliverability Score
  let score = 0;
  if (mxStatus === 'PASS') score += 20;
  if (spfStatus === 'PASS') score += 25;
  else if (spfStatus === 'WARN') score += 15;

  if (dkimStatus === 'PASS') score += 30;
  if (dmarcStatus === 'PASS') score += 25;
  else if (dmarcStatus === 'WARN') score += 15;

  // Google & Yahoo 2024 Compliance Check
  const missingRequirements: string[] = [];
  if (spfStatus === 'FAIL') missingRequirements.push('SPF Record authorizing Google Workspace');
  if (dkimStatus === 'FAIL') missingRequirements.push('DKIM 2048-bit authentication record');
  if (dmarcStatus === 'FAIL') missingRequirements.push('DMARC policy record at _dmarc.' + cleanDomain);
  if (mxStatus === 'FAIL') missingRequirements.push('Valid incoming MX mail exchanger');

  const recommendedDnsRecords = [
    {
      type: 'TXT' as const,
      host: '_dmarc',
      value: `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${cleanDomain}; pct=100; adkim=r; aspf=r`,
      purpose: 'DMARC Policy (Strictly mandated by Google & Yahoo to prevent emails going to spam/rejection)',
      status: dmarcStatus === 'PASS' ? ('ACTIVE' as const) : ('MISSING' as const),
    },
    {
      type: 'TXT' as const,
      host: '@',
      value: 'v=spf1 include:_spf.google.com ~all',
      purpose: 'SPF Record (Authorizes Google Workspace to deliver outbound email)',
      status: spfStatus === 'PASS' ? ('ACTIVE' as const) : ('MISSING' as const),
    },
    {
      type: 'TXT' as const,
      host: 'google._domainkey',
      value: dkimRecord || 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1UulItN...',
      purpose: 'DKIM Signature Record (Signs all outbound messages with RSA cryptographic key)',
      status: dkimStatus === 'PASS' ? ('ACTIVE' as const) : ('MISSING' as const),
    },
    {
      type: 'MX' as const,
      host: '@',
      priority: 1,
      value: 'smtp.google.com.',
      purpose: 'Google Workspace Primary Mail Exchanger',
      status: mxStatus === 'PASS' ? ('ACTIVE' as const) : ('MISSING' as const),
    },
  ];

  return {
    domain: cleanDomain,
    timestamp: new Date().toISOString(),
    overallScore: score,
    status: score >= 90 ? 'OPTIMAL' : score >= 60 ? 'ACTION_REQUIRED' : 'CRITICAL',
    spf: {
      status: spfStatus,
      record: spfRecord || undefined,
      details: spfDetails,
      recommendation: spfStatus !== 'PASS' ? 'Add TXT record at host "@" with value "v=spf1 include:_spf.google.com ~all"' : undefined,
    },
    dkim: {
      status: dkimStatus,
      record: dkimRecord || undefined,
      details: dkimDetails,
      recommendation: dkimStatus !== 'PASS' ? 'Generate 2048-bit DKIM key in Google Admin Console and publish at google._domainkey.' + cleanDomain : undefined,
    },
    dmarc: {
      status: dmarcStatus,
      record: dmarcRecord || undefined,
      details: dmarcDetails,
      recommendation: dmarcStatus === 'FAIL' ? `Add TXT record at host "_dmarc" with value "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${cleanDomain}; pct=100; adkim=r; aspf=r"` : undefined,
    },
    mx: {
      status: mxStatus,
      records: mxRecords,
      details: mxDetails,
    },
    googleYahooCompliance2024: {
      compliant: missingRequirements.length === 0,
      missingRequirements,
    },
    recommendedDnsRecords,
  };
}

/**
 * Scan email subject and body for spam triggers, CAN-SPAM violations, and formatting flags
 */
export function analyzeEmailSpamRisk(subject: string = '', body: string = ''): ContentSpamAnalysis {
  let score = 0; // 0 = pristine, 100 = severe spam
  const issues: string[] = [];
  const suggestions: string[] = [];
  const detectedTriggers: string[] = [];

  const textToScan = `${subject} ${body}`.toLowerCase();

  // 1. Check High-Risk Trigger Phrases
  for (const trigger of HIGH_RISK_TRIGGERS) {
    if (textToScan.includes(trigger)) {
      score += 18;
      detectedTriggers.push(`High risk: "${trigger}"`);
      issues.push(`Detected high-risk spam phrase: "${trigger}"`);
    }
  }

  // 2. Check Medium-Risk Trigger Phrases
  for (const trigger of MEDIUM_RISK_TRIGGERS) {
    if (textToScan.includes(trigger)) {
      score += 7;
      detectedTriggers.push(`Medium risk: "${trigger}"`);
    }
  }

  // 3. Subject Line Formatting Checks
  if (subject) {
    // All-caps check
    const uppercaseLetters = subject.replace(/[^A-Za-z]/g, '');
    if (uppercaseLetters.length >= 8 && uppercaseLetters === uppercaseLetters.toUpperCase()) {
      score += 25;
      issues.push('Subject line is ALL CAPS (Spam filters immediately penalize shouting)');
      suggestions.push('Change subject line to title case or sentence case');
    }

    // Exclamation / dollar signs in subject
    if (/(!{2,}|\${2,}|\?{2,})/.test(subject)) {
      score += 20;
      issues.push('Excessive exclamation or punctuation marks in subject line');
      suggestions.push('Use single standard punctuation marks only');
    }

    if (/\b(free|guaranteed|urgent|act now|\$\$\$)\b/i.test(subject)) {
      score += 15;
      issues.push('Spam trigger word in subject line');
      suggestions.push('Use professional, descriptive subject lines (e.g. "Your Medicare Review Appointment Confirmation")');
    }
  } else {
    score += 30;
    issues.push('Missing subject line');
  }

  // 4. CAN-SPAM Physical Address Check
  const hasPhysicalAddress = /(scottsdale|suite|85251|az|street|rd|blvd|box|office)/i.test(body);
  if (!hasPhysicalAddress) {
    score += 15;
    issues.push('Missing agency physical postal address (Required by CAN-SPAM law)');
    suggestions.push('Include agency address in email footer: "I Will Global, 4800 N Scottsdale Rd, Scottsdale, AZ 85251"');
  }

  // 5. Unsubscribe Mechanism Check
  const hasUnsubscribe = /(unsubscribe|opt-out|manage preferences|reply stop)/i.test(body);
  if (!hasUnsubscribe) {
    score += 15;
    issues.push('Missing explicit unsubscribe or opt-out mechanism');
    suggestions.push('Include a clear one-click unsubscribe link in the footer');
  }

  // 6. Link Safety & Quantity
  const httpLinks = body.match(/http:\/\/[^\s]+/g);
  if (httpLinks && httpLinks.length > 0) {
    score += 20;
    issues.push('Insecure (HTTP) links detected in email body');
    suggestions.push('Always use secure HTTPS links (e.g., https://iwillglobal.com)');
  }

  const cappedScore = Math.min(100, Math.max(0, score));

  let deliverabilityRating: 'Excellent' | 'Good' | 'Moderate Risk' | 'High Spam Risk' = 'Excellent';
  let riskLevel: 'Low' | 'Medium' | 'High' | 'Critical' = 'Low';

  if (cappedScore >= 60) {
    deliverabilityRating = 'High Spam Risk';
    riskLevel = 'Critical';
  } else if (cappedScore >= 35) {
    deliverabilityRating = 'Moderate Risk';
    riskLevel = 'High';
  } else if (cappedScore >= 15) {
    deliverabilityRating = 'Good';
    riskLevel = 'Medium';
  }

  let cleanSubjectRecommendation: string | undefined;
  if (subject && (subject === subject.toUpperCase() || detectedTriggers.some((t) => subject.toLowerCase().includes(t.toLowerCase())))) {
    cleanSubjectRecommendation = subject
      .replace(/!+/g, '')
      .replace(/\$+/g, '')
      .toLowerCase()
      .replace(/(^\w|\s\w)/g, (m) => m.toUpperCase());
  }

  return {
    spamScore: cappedScore,
    deliverabilityRating,
    riskLevel,
    canSpamCompliant: hasPhysicalAddress && hasUnsubscribe,
    googleYahooCompliant: hasUnsubscribe && !issues.some((i) => i.includes('ALL CAPS')),
    issues,
    suggestions,
    detectedTriggerWords: detectedTriggers,
    cleanSubjectRecommendation,
  };
}

/**
 * Clean & Format Outbound Email Body with Standard CAN-SPAM Footer and Unsubscribe Link
 */
export function formatCompliantEmailBody(
  rawBody: string,
  options: {
    recipientEmail?: string;
    senderName?: string;
    isMarketing?: boolean;
    includeTpmo?: boolean;
  } = {}
) {
  const { recipientEmail, senderName = 'King Amen Ra', includeTpmo = false } = options;
  const addressFooter = `\r\n\r\n--------------------------------------------------\r\nI Will Global | Agency Principal: ${senderName}\r\n4800 N Scottsdale Rd, Suite 100, Scottsdale, AZ 85251\r\nPhone: (602) 456-9681 | Email: info@iwillglobal.com\r\nWebsite: https://iwillglobal.com`;

  const unsubUrl = `${config.appUrl}/api/public/unsubscribe?email=${encodeURIComponent(recipientEmail || '')}`;
  const unsubFooter = `\r\n\r\nTo manage your email preferences or unsubscribe from future emails: ${unsubUrl}`;

  const tpmoFooter = includeTpmo
    ? `\r\n\r\n${config.agency.name} is a licensed insurance agency. We do not offer every plan available in your area. Currently we represent carriers offering Medicare Advantage and Part D products. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Program (SHIP) to get information on all of your options.`
    : '';

  let finalBody = rawBody.trim();
  if (!/(4800 N Scottsdale|Scottsdale, AZ 85251)/i.test(finalBody)) {
    finalBody += addressFooter;
  }
  if (!/unsubscribe/i.test(finalBody)) {
    finalBody += unsubFooter;
  }
  if (includeTpmo && !/Medicare\.gov/i.test(finalBody)) {
    finalBody += tpmoFooter;
  }

  return finalBody;
}
