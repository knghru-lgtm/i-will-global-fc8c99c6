/** Phone helpers: E.164 normalization, Google Voice deep links, TCPA calling-window checks. */

export function toE164(raw: string | null | undefined, defaultCountry = '1'): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function formatPhone(raw: string | null | undefined): string {
  const e = toE164(raw);
  if (!e || !e.startsWith('+1')) return raw || '';
  const d = e.slice(2);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Google Voice deep links with account/authuser targeting. */
export function googleVoiceWebUrl(e164: string, emailOrIndex?: string | number): string {
  if (typeof emailOrIndex === 'string' && emailOrIndex.includes('@')) {
    const cleanEmail = emailOrIndex.trim().toLowerCase();
    return `https://voice.google.com/calls?a=nc,${encodeURIComponent(e164)}&authuser=${encodeURIComponent(cleanEmail)}`;
  }
  const idx = typeof emailOrIndex === 'number' ? emailOrIndex : 0;
  return `https://voice.google.com/u/${idx}/calls?a=nc,${encodeURIComponent(e164)}`;
}

export function telUrl(e164: string): string {
  return `tel:${e164}`;
}

// Approximate state -> IANA timezone (dominant zone). Arizona does not observe DST.
const STATE_TZ: Record<string, string> = {
  AZ: 'America/Phoenix', CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  NM: 'America/Denver', CO: 'America/Denver', UT: 'America/Denver', ID: 'America/Boise', MT: 'America/Denver', WY: 'America/Denver',
  TX: 'America/Chicago', OK: 'America/Chicago', KS: 'America/Chicago', NE: 'America/Chicago', SD: 'America/Chicago', ND: 'America/Chicago',
  MN: 'America/Chicago', IA: 'America/Chicago', MO: 'America/Chicago', AR: 'America/Chicago', LA: 'America/Chicago', WI: 'America/Chicago',
  IL: 'America/Chicago', MS: 'America/Chicago', AL: 'America/Chicago', TN: 'America/Chicago',
  FL: 'America/New_York', GA: 'America/New_York', SC: 'America/New_York', NC: 'America/New_York', VA: 'America/New_York',
  NY: 'America/New_York', NJ: 'America/New_York', PA: 'America/New_York', OH: 'America/New_York', MI: 'America/Detroit',
  IN: 'America/Indiana/Indianapolis', KY: 'America/New_York', WV: 'America/New_York', MD: 'America/New_York', DE: 'America/New_York',
  CT: 'America/New_York', RI: 'America/New_York', MA: 'America/New_York', VT: 'America/New_York', NH: 'America/New_York', ME: 'America/New_York',
  DC: 'America/New_York', HI: 'Pacific/Honolulu', AK: 'America/Anchorage',
};

export function timezoneForState(state?: string | null): string {
  return STATE_TZ[(state || 'AZ').toUpperCase()] || 'America/Phoenix';
}

export function localHour(state: string | null | undefined, at = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezoneForState(state) }).format(at);
  return Number(h) % 24;
}

/** TCPA quiet hours: calls allowed 8:00am–9:00pm recipient local time. */
export function isWithinCallingHours(state: string | null | undefined, at = new Date()): boolean {
  const h = localHour(state, at);
  return h >= 8 && h < 21;
}
