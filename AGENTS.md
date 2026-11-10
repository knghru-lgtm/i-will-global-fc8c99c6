# IWG Cloud CRM & 24/7 Sarah Voice AI Receptionist (`https://iwillglobal.com`)

This repository powers the 100% cloud-native IWG Insurance & Financial Services CRM and Sarah (`Vindemiatrix`) 24/7 Receptionist & Outbound Caller on `(480) 331-9455` (`+14803319455`).

## Core Architecture (100% Cloud-Native — Zero Laptop Dependency, Zero Bland Code)

- **Frontend & Serverless API (`https://iwillglobal.com`):** Built with Vite + React (`client/`) and Express/Node (`server/src/index.ts` bundled to `api/index.js`), backed by **Neon Cloud Postgres** (`DATABASE_URL`).
- **24/7 Cloud VoIP Daemon (`cloud-voip-daemon/` -> Vercel Daemons `sarah-voip`):** Runs continuously inside Vercel's cloud data center (`iad1`) using headless virtual-display Chromium (`Xvfb` + `PulseAudio null-sink` + `webrtc-bridge.js` Pure Digital WebRTC Isolation) connected directly to `https://voice.google.com/u/0/calls` and `https://iwillglobal.com/api/sarah/*`.
- **Zero-Echo Pure Digital Isolation:** Outgoing WebRTC audio transmits only Sarah's digital `Vindemiatrix` WAV stream (`0.85` studio gain + soft limiter + `0.0` DC constant source) with zero physical microphone input and zero speaker output.
- **Work Hours Enforcement:** Inbound calls to `(480) 331-9455` are answered 24/7 on the 1st ring. Live warm transfers (`+16024569681` and the 42-member IWG Team Directory) are permitted strictly Monday–Friday, 8:00 AM–8:00 PM Arizona time (`America/Phoenix`); outside those hours, Sarah books Telephone (30m), In-Person (60m), or Video (30m) appointments and sends the initial confirmation text.
- **Validation & Build:** Run `npm run build` and `node scripts/validate.cjs` before deploying to production (`npx vercel --prod --yes`). Keep tokens, cookies, and real customer fixtures out of Git.
