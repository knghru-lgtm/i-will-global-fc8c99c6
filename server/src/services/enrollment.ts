/** Medicare enrollment-period engine (IEP / AEP / MA-OEP). Dates are ISO 'YYYY-MM-DD'. */

const pad = (n: number) => String(n).padStart(2, '0');

export const isoDate = (d: Date): string => {
  if (!d || isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function parse(raw: any): Date {
  if (raw === null || raw === undefined || raw === '') return new Date(NaN);
  
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? new Date(NaN) : raw;
  }

  if (typeof raw === 'number') {
    // Excel date serial number (e.g. 21935 to 45000)
    if (raw > 1000 && raw < 100000) {
      // Excel epoch begins Dec 30 1899
      const excelEpoch = new Date(1899, 11, 30);
      return new Date(excelEpoch.getTime() + raw * 86400000);
    }
    // Unix timestamp in seconds or ms
    const ms = raw < 10000000000 ? raw * 1000 : raw;
    return new Date(ms);
  }

  const str = String(raw).trim();
  if (!str) return new Date(NaN);

  // Match YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1], 10);
    const m = parseInt(ymdMatch[2], 10);
    const d = parseInt(ymdMatch[3], 10);
    return new Date(y, m - 1, d);
  }

  // Match MM/DD/YYYY or M/D/YYYY or MM-DD-YYYY
  const mdyMatch = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (mdyMatch) {
    const m = parseInt(mdyMatch[1], 10);
    const d = parseInt(mdyMatch[2], 10);
    const y = parseInt(mdyMatch[3], 10);
    return new Date(y, m - 1, d);
  }

  // Fallback native Date parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date(NaN);
}

export function ageOn(dob: any, on = new Date()): number {
  const b = parse(dob);
  if (isNaN(b.getTime())) return 0;
  let age = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) age--;
  return age;
}

export function turning65Date(dob: any): string {
  const b = parse(dob);
  if (isNaN(b.getTime())) return '';
  return isoDate(new Date(b.getFullYear() + 65, b.getMonth(), b.getDate()));
}

/**
 * Initial Enrollment Period: 7 months — 3 months before the month of the 65th birthday,
 * the birthday month, and 3 months after. (Birthday on the 1st shifts one month earlier.)
 */
export function iepWindow(dob: any): { start: string; end: string; birthday65: string } {
  const b = parse(dob);
  if (isNaN(b.getTime())) return { start: '', end: '', birthday65: '' };
  let year = b.getFullYear() + 65;
  let month = b.getMonth();
  if (b.getDate() === 1) { month -= 1; if (month < 0) { month = 11; year -= 1; } }
  const start = new Date(year, month - 3, 1);
  const end = new Date(year, month + 4, 0); // last day of month+3
  return { start: isoDate(start), end: isoDate(end), birthday65: turning65Date(dob) };
}

export function isAEP(on = new Date()): boolean {
  const m = on.getMonth() + 1, d = on.getDate();
  return (m === 10 && d >= 15) || m === 11 || (m === 12 && d <= 7);
}

export function isMAOEP(on = new Date()): boolean {
  const m = on.getMonth() + 1;
  return m >= 1 && m <= 3;
}

export function currentPeriod(on = new Date()): { code: string; label: string; start: string; end: string; daysLeft: number } | null {
  const y = on.getFullYear();
  const mk = (code: string, label: string, s: Date, e: Date) => ({
    code, label, start: isoDate(s), end: isoDate(e),
    daysLeft: Math.ceil((e.getTime() - new Date(on.getFullYear(), on.getMonth(), on.getDate()).getTime()) / 86400000),
  });
  if (isAEP(on)) return mk('AEP', 'Annual Enrollment Period', new Date(y, 9, 15), new Date(y, 11, 7));
  if (isMAOEP(on)) return mk('OEP', 'Medicare Advantage Open Enrollment', new Date(y, 0, 1), new Date(y, 2, 31));
  return null;
}

export function nextPeriod(on = new Date()): { code: string; label: string; start: string; daysUntil: number } {
  const y = on.getFullYear();
  const today = new Date(y, on.getMonth(), on.getDate());
  const candidates = [
    { code: 'OEP', label: 'MA Open Enrollment', start: new Date(y, 0, 1) },
    { code: 'AEP', label: 'Annual Enrollment Period', start: new Date(y, 9, 15) },
    { code: 'OEP', label: 'MA Open Enrollment', start: new Date(y + 1, 0, 1) },
  ].filter((c) => c.start > today);
  const n = candidates[0];
  return { code: n.code, label: n.label, start: isoDate(n.start), daysUntil: Math.ceil((n.start.getTime() - today.getTime()) / 86400000) };
}

/** Days until 65th birthday (negative if already passed). */
export function daysUntil65(dob: any, on = new Date()): number {
  const turning = turning65Date(dob);
  if (!turning) return 9999;
  const t = parse(turning);
  if (isNaN(t.getTime())) return 9999;
  const today = new Date(on.getFullYear(), on.getMonth(), on.getDate());
  return Math.round((t.getTime() - today.getTime()) / 86400000);
}

export function inIEP(dob: any, on = new Date()): boolean {
  const w = iepWindow(dob);
  if (!w.start || !w.end) return false;
  const t = isoDate(on);
  return t >= w.start && t <= w.end;
}
