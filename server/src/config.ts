import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Automatically load root .env if started from server/ workspace without --env-file=..
try {
  for (const rel of ['../../.env', '../.env']) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p) && typeof (process as any).loadEnvFile === 'function') {
      (process as any).loadEnvFile(p);
    }
  }
} catch {
  // ignore in serverless environments where env vars are injected directly
}

// Central configuration. All integrations are optional; missing keys put features into demo mode.
export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'iwg-dev-secret-change-me',
  appUrl: process.env.APP_URL || 'https://iwillglobal.com',
  apiUrl: process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`,
  databaseUrl: process.env.DATABASE_URL || '',
  dataDir: process.env.DATA_DIR || fileURLToPath(new URL('../data/pg', import.meta.url)),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model:
      process.env.GEMINI_MODEL &&
      process.env.GEMINI_MODEL !== 'gemini-2.5-flash' &&
      process.env.GEMINI_MODEL !== 'gemini-3.5-flash'
        ? process.env.GEMINI_MODEL
        : 'gemini-3.8-flash',
    ttsModel: process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts',
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
    officeHoursEnd: process.env.OFFICE_HOURS_END || '20:00',
    officeDays: process.env.OFFICE_DAYS || '1,2,3,4,5',
  },
};

export const isAIEnabled = () => Boolean(config.gemini.apiKey);
export const isGoogleEnabled = () => Boolean(config.google.clientId && config.google.clientSecret);

/** CMS-required TPMO disclaimer (verify current wording with your FMO/compliance team). */
export const TPMO_DISCLAIMER =
  'We do not offer every plan available in your area. Any information we provide is limited to those plans we do offer in your area. ' +
  'Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.';
