import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function resolveRepoRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(currentDir, '..'),
    path.resolve(currentDir, '../..'),
  ];
  for (const dir of candidates) {
    try {
      const pkgPath = path.join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const raw = readFileSync(pkgPath, 'utf8');
        if (raw.includes('"workspaces"')) {
          return dir;
        }
      }
    } catch {
      // ignore
    }
  }
  return process.cwd();
}

export const repoRoot = resolveRepoRoot();

function loadEnvPath(p: string) {
  if (!existsSync(p)) return;
  if (typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile(p);
    return;
  }
  const raw = readFileSync(p, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

// Automatically load .env from repo root or server/ whether started via api/index.js or server/src/index.ts
try {
  const candidates = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'server', '.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'server', '.env'),
  ];
  for (const p of candidates) {
    loadEnvPath(p);
  }
} catch {
  // ignore in environments where env vars are injected directly
}

// Central Google Cloud configuration. All external integrations are optional; missing keys activate resilient fallback mode.
export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'iwg-dev-secret-change-me',
  appUrl: process.env.APP_URL || 'https://voice.iwillglobal.com',
  apiUrl: process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 4000}`,
  databaseUrl: process.env.DATABASE_URL || '',
  dataDir: process.env.DATA_DIR || path.join(repoRoot, 'server', 'data', 'pg'),
  gemini: {
    apiKey: process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || '',
    model:
      process.env.GEMINI_MODEL &&
      process.env.GEMINI_MODEL !== 'gemini-2.5-flash' &&
      process.env.GEMINI_MODEL !== 'gemini-3.5-flash'
        ? process.env.GEMINI_MODEL
        : 'gemini-3.8-flash',
    liveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
    ttsModel: process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts',
  },
  telephony: {
    publicHostFqdn: process.env.PUBLIC_HOST_FQDN || 'voice.iwillglobal.com',
    googleVoiceNumber: process.env.GOOGLE_VOICE_NUMBER || '+14803319455',
    cloudHeadlessOnly:
      process.env.CLOUD_TELEPHONY_MODE === 'true' ||
      process.platform !== 'win32',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    allowedDomain: process.env.GOOGLE_ALLOWED_DOMAIN || 'iwillglobal.com',
  },
  agency: {
    name: 'I Will Global',
    phone: '(480) 331-9455',
    phoneE164: '+14803319455',
    email: 'info@iwillglobal.com',
    website: 'https://iwillglobal.com',
    address: '3033 N Central Ave, Phoenix, AZ 85012',
    timezone: process.env.OFFICE_TIMEZONE || 'America/Phoenix',
    officeHoursStart: process.env.OFFICE_HOURS_START || '08:00',
    officeHoursEnd: process.env.OFFICE_HOURS_END || '17:00',
    officeDays: process.env.OFFICE_DAYS || '1,2,3,4,5',
  },
};

export const isAIEnabled = () => Boolean(config.gemini.apiKey);
export const isGoogleEnabled = () => Boolean(config.google.clientId && config.google.clientSecret);

/** CMS-required TPMO disclaimer (verify current wording with your FMO/compliance team). */
export const TPMO_DISCLAIMER =
  'We do not offer every plan available in your area. Any information we provide is limited to those plans we do offer in your area. ' +
  'Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.';
