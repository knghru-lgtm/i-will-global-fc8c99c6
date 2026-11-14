# IWG Cloud CRM & 24/7 Sarah Voice AI Receptionist (`https://voice.iwillglobal.com` / `https://iwillglobal.com`)

This repository powers the 100% cloud-native IWG Insurance & Financial Services CRM and Sarah (`Vindemiatrix`) 24/7 Receptionist & Outbound Caller on `(480) 331-9455` (`+14803319455`).

## Permanent Infrastructure & Architecture Rules (Google Cloud + Google Voice ONLY)

- **100% Google Cloud + Google Voice Only (Zero Bland, Zero Twilio, Zero Render):**
  - **NEVER** add or use Bland AI, Twilio, Render (`render.yaml`), Retell, or ElevenLabs code, webhooks, or dependencies.
  - Voice backend & 24/7 VoIP bridge run on **Google Cloud** (`35.253.150.41` / `https://voice.iwillglobal.com`, `~/sarah-server`) connected directly to **Google Voice `(480) 331-9455`** (`https://voice.google.com/u/0/calls`) and **Google GenAI (`@google/genai`)**.
- **PM2 Process Management (`ecosystem.config.cjs`):**
  - Always manage processes via `ecosystem.config.cjs` (`sarah-server` running pre-bundled `./api/index.js` on `:4000` + `cloud-voip-daemon` running `./cloud-voip-daemon/start.sh` under `nice -n 10`). Never run duplicate `npm run start` / `tsx` processes alongside `sarah-server` on `:4000`.
  - Keep a 2 GB `/swapfile` active and TCP MSS clamped (`--set-mss 1200`, `net.ipv4.tcp_mtu_probing=2`) on the Google Cloud VM so cellular/DNS64 TLS handshakes and Chrome WebRTC sessions never stall or OOM.
- **24/7 Headless Google Voice Bridge (`cloud-voip-daemon/` & `google-voice-extension/`):**
  - Answers every inbound call to `(480) 331-9455` on the **1st ring (`<150ms`)** with zero laptop dependency.
  - Uses `webrtc-bridge.js` Pure Digital WebRTC Isolation (`0.85` studio gain + soft limiter + `0.0` DC constant source, zero physical microphone input, zero speaker output).
  - In `worker.mjs` CDP cookie sync (`normalizeCookiesForCdp`), `__Host-*` cookies MUST use `url` (without `domain`) and fall back per-cookie via `Network.setCookie`.
  - Inbound callers captured by Sarah are tagged **`Inbound Lead`** (`resolveInboundLeadSource`).
- **Strict Arizona Time Routing (`America/Phoenix` — MST, UTC-7 year-round, No DST):**
  - **Business Hours (`Monday–Friday, 8:00 AM – 5:00 PM MST`, excluding weekends & US holidays):** Full interactive Sarah receptionist conversation (`Vindemiatrix` natural female voice), 6-division insurance/financial funnel, CRM appointment booking, and live warm transfers (`+16024569681` and the 42-member IWG Team Directory).
  - **After Hours (Evenings after 5:00 PM MST, Weekends, Holidays):** Answers on Ring 1, plays the exact deterministic closed greeting (`"Thank you for calling I Will Global. Our office is currently closed. Our regular business hours are Monday through Friday, from 8 AM to 5 PM Arizona time. Please call us back during normal business hours. Have a wonderful day."`), and hangs up cleanly.
- **Zero-Downtime AI Credit Resilience:**
  - If `@google/genai` returns `402 / 1011` (prepayment credits depleted), `sarahVoiceService.ts` automatically trips a 60-second self-healing circuit breaker to the deterministic Sarah Fiduciary Engine + Google neural `audio/mpeg` TTS (`gemini-2.5-flash` STT with non-404 WebRTC speech fallback) so callers never experience dead air.
- **Validation & Build:** Run `npm run build:api` (which also syncs `api/schema.sql` from `server/src/db/schema.sql`) and `node scripts/validate.cjs` before deploying. Keep tokens, API keys, cookies, and real customer data out of Git.
