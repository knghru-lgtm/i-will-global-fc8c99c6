// API Client for IWG CRM client

const API_BASE = '/api';

export function getAuthToken(): string | null {
  return localStorage.getItem('iwg_token');
}

export function setAuthToken(token: string | null) {
  if (token) localStorage.setItem('iwg_token', token);
  else localStorage.removeItem('iwg_token');
}

export async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }

  if (!res.ok) {
    throw new Error(json?.error || `Request failed with status ${res.status}`);
  }
  return json as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>(url, { method: 'GET' }),
  post: <T = any>(url: string, body?: any) => request<T>(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T = any>(url: string, body?: any) => request<T>(url, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T = any>(url: string) => request<T>(url, { method: 'DELETE' }),
};

export function formatPhone(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

export type GvAccountSlot = '0' | '1' | '2' | 'email' | 'default';

export function getStoredGvSlot(): GvAccountSlot {
  if (typeof window === 'undefined') return '0';
  const val = localStorage.getItem('iwg_gv_slot') as GvAccountSlot;
  if (val === '0' || val === '1' || val === '2' || val === 'email' || val === 'default') {
    return val;
  }
  return '0';
}

export function setStoredGvSlot(slot: GvAccountSlot) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('iwg_gv_slot', slot);
  }
}

export function googleVoiceWebUrl(phone: string, emailOrSlot?: string | number): string {
  if (!phone) return 'https://voice.google.com';
  const digits = phone.replace(/\D/g, '');
  const e164 = digits.length === 10 ? `%2B1${digits}` : `%2B${digits}`;

  let slot: GvAccountSlot = getStoredGvSlot();
  let explicitEmail: string | undefined = undefined;

  if (typeof emailOrSlot === 'number') {
    slot = String(emailOrSlot) as GvAccountSlot;
  } else if (typeof emailOrSlot === 'string') {
    if (emailOrSlot === '0' || emailOrSlot === '1' || emailOrSlot === '2' || emailOrSlot === 'email' || emailOrSlot === 'default') {
      slot = emailOrSlot as GvAccountSlot;
    } else if (emailOrSlot.includes('@')) {
      explicitEmail = emailOrSlot.trim().toLowerCase();
    }
  }

  // Account slot routing
  if (slot === '1') {
    return `https://voice.google.com/u/1/calls?a=nc,${e164}`;
  }
  if (slot === '2') {
    return `https://voice.google.com/u/2/calls?a=nc,${e164}`;
  }
  if (slot === 'email' && explicitEmail) {
    return `https://voice.google.com/calls?a=nc,${e164}&authuser=${encodeURIComponent(explicitEmail)}`;
  }
  if (slot === 'default') {
    return `https://voice.google.com/calls?a=nc,${e164}`;
  }

  // Canonical Google Voice outbound URL (Primary account: /u/0/calls?a=nc,%2B[number])
  return `https://voice.google.com/u/0/calls?a=nc,${e164}`;
}

export function telDialUrl(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return `tel:${e164}`;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function googleVoiceAppUrl(phone: string): string {
  if (!phone) return 'googlevoice://';
  const digits = phone.replace(/\D/g, '');
  const e164 = digits.length === 10 ? `1${digits}` : digits;

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    // Android: target Google Voice application package dial intent
    if (/Android/i.test(ua)) {
      return `intent://+${e164}#Intent;scheme=tel;package=com.google.android.apps.googlevoice;action=android.intent.action.DIAL;end;`;
    }
    // iOS (iPhone / iPad): native Google Voice custom URL scheme
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return `googlevoice:${e164}`;
    }
  }

  return `googlevoice:${e164}`;
}

export function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|CriOS|FxiOS/.test(ua);
}

export function isAppleDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Macintosh|iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function copyToClipboard(text: string): boolean {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(el);
    return successful;
  } catch (err) {
    return false;
  }
}

export function openGoogleVoiceWindow(phone: string, emailOrSlot?: string | number): boolean {
  if (!phone) return false;
  const url = googleVoiceWebUrl(phone, emailOrSlot);

  // Safari & WebKit optimization: programmatic link click passes through popup blockers
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (err) {}
    }, 100);
    return true;
  } catch (e) {}

  try {
    const win = window.open(url, '_blank');
    if (!win || win.closed || typeof win.closed === 'undefined') {
      return false;
    }
    win.focus();
    return true;
  } catch (e) {
    return false;
  }
}
