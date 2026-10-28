# IWG CRM — AI-First Medicare Insurance CRM

Built specifically for **I Will Global** ([iwillglobal.com](https://iwillglobal.com)), a Medicare-focused insurance agency in Arizona ((480) 331-9455).

## Features

- **Salesforce-Parity Core CRM**: Leads, Clients (Policyholders), Opportunities (Pipeline), Policies, Commissions, Activities, Campaigns, Email Templates.
- **Medicare & Insurance Specifics**:
  - Turning-65 (IEP) window calculator and notifications
  - Annual Enrollment Period (AEP Oct 15 – Dec 7) & MA-OEP tracking
  - Scope of Appointment (SOA) e-sign generation & beneficiary landing page (`/soa/:token`)
  - Medications & Doctors lists per client for plan reviews
  - Carrier catalog (Humana, UHC/AARP, Aetna, BCBS AZ, Wellcare, Cigna, Devoted)
  - Team management for **20 agents & schedulers** with NPN numbers, state licensing, AHIP certifications, carrier appointments, and ready-to-sell status
- **Google Voice Telephony Integration**:
  - One-click desktop dialing via Google Voice deep links (`https://voice.google.com/u/0/calls?a=nc,+1...`)
  - Slide-over **Call Panel** with call timer, mandatory CMS TPMO disclaimer checklist, call script tab, call notes, and **required dispositions**
  - **Power Dialer** for working through lead queues with TCPA calling-window checks (8am–9pm recipient time)
  - Schedulers book appointments that auto-route to licensed agents based on state licensing and load
- **AI Engine ("IWG Copilot" & "Global Assistant")**:
  - **Agent Copilot**: Natural language Q&A over CRM data, lead ranking, AI call summaries, AI email drafting, CMS compliance auditing, and pre-call briefs
  - **Customer "Global Assistant"**: Embeddable website chat widget for `iwillglobal.com` providing general Medicare education, intake with TCPA consent, AI appointment booking, and live human agent takeover
- **Google Workspace (Gmail & Calendar)**:
  - OAuth 2.0 integration restricted to `@iwillglobal.com` accounts
  - Two-way Gmail sync and internal email drafting
  - Google Calendar event creation for appointments
- **Cross-Platform Mobile Apps**:
  - Powered by Capacitor for Android (Google Play) and iOS (Apple App Store)

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Seed database with 20 Team Members, Leads, Carriers & Sample Data
npm run seed

# 3. Start API Server (port 4000) and React Client (port 5173)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Demo Logins (Password: `Welcome123!`)

- **Admin**: `admin@iwillglobal.com`
- **Scheduler**: `erostova@iwillglobal.com`
- **Licensed Agent**: `rchen@iwillglobal.com`

> Use the **Role Selector** in the top header to instantly switch between Admin, Manager, Licensed Agent, and Scheduler views for testing.

## Environment Variables (`.env`)

Copy `.env.example` to `.env` or `server/.env`:

```env
PORT=4000
JWT_SECRET=iwg-dev-secret-key
APP_URL=http://localhost:5173
API_URL=http://localhost:4000

# Optional: Add your Gemini API key from https://aistudio.google.com/apikey
GEMINI_API_KEY=

# Optional: Google Workspace OAuth (client ID & secret from Google Cloud Console)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_ALLOWED_DOMAIN=iwillglobal.com
```

## Running Tests

```bash
npm run test
```

Runs the Node.js test suite covering auth, enrollment calculations, call dispositions, scheduler appointment routing, AI guardrails, website chat, and SOA e-signing.

## Bland AI Agent Workspace

The Bland AI agent definition (`bland.json`) and Norm tooling (`.bland/norm`) configure the voice telephony agent for inbound/outbound calls (`setup 3b13b658-e85d-4d14-a24a-868b61040c42`). To validate Bland configuration changes locally:

```bash
node scripts/validate.cjs
```
