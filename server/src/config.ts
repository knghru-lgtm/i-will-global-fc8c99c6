import { fileURLToPath } from 'node:url';

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
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    allowedDomain: process.env.GOOGLE_ALLOWED_DOMAIN || 'iwillglobal.com',
  },
  agency: {
    name: 'I Will Global',
    phone: '(480) 331-9455',
    email: 'info@iwillglobal.com',
    website: 'https://iwillglobal.com',
    address: '3033 N Central Ave, Phoenix, AZ 85012',
    timezone: 'America/Phoenix',
  },
};

export const isAIEnabled = () => Boolean(config.gemini.apiKey);
export const isGoogleEnabled = () => Boolean(config.google.clientId && config.google.clientSecret);

/** CMS-required TPMO disclaimer (verify current wording with your FMO/compliance team). */
export const TPMO_DISCLAIMER =
  'We do not offer every plan available in your area. Any information we provide is limited to those plans we do offer in your area. ' +
  'Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.';
