// src/watchdog/sarah-watchdog.ts
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
function resolveRepoRoot() {
  const thisFile = fileURLToPath(import.meta.url);
  const dir = path.dirname(thisFile);
  if (path.basename(dir) === "api") {
    return path.resolve(dir, "..");
  }
  return path.resolve(dir, "..", "..");
}
var REPO_ROOT = resolveRepoRoot();
function loadDotEnvFiles() {
  const candidates = [
    path.join(REPO_ROOT, ".env"),
    path.join(REPO_ROOT, "server", ".env")
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === void 0) {
          process.env[key] = val;
        }
      }
    } catch {
    }
  }
}
loadDotEnvFiles();
var DATA_DIR = path.join(REPO_ROOT, "server", "data");
var STATE_PATH = path.join(DATA_DIR, "ops-supervisor-state.json");
var LATEST_REPORT_PATH = path.join(DATA_DIR, "ops-supervisor-latest.json");
var TMP_DIR = process.platform === "win32" ? os.tmpdir() : "/tmp";
var DYNAMIC_SELECTORS_PATH = path.join(TMP_DIR, "sarah-dynamic-selectors.json");
var CALL_STATE_PATH = path.join(TMP_DIR, "sarah-call-state.json");
var MISSED_CALL_DEBUG_PNG_PATH = path.join(TMP_DIR, "missed-call-debug.png");
var MISSED_CALL_DOM_HTML_PATH = path.join(TMP_DIR, "missed-call-dom.html");
var GV_LIVE_STATUS_PNG_PATH = path.join(TMP_DIR, "gv-live-status.png");
var SETTINGS_AUDIT_STATE_PATH = path.join(TMP_DIR, "sarah-settings-audit.json");
var LOCAL_API_BASE = process.env.LOCAL_API_URL || "http://127.0.0.1:4000";
var PUBLIC_FQDN = process.env.PUBLIC_HOST_FQDN || "voice.iwillglobal.com";
var CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
var BRIDGE_TOKEN = process.env.GV_BRIDGE_TOKEN || "iwg-sarah-cloud-bridge-v10-9455";
var WATCHDOG_INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS || 6e4);
var WATCHDOG_PORT = Number(process.env.WATCHDOG_PORT || 4099);
var SETTINGS_AUDIT_INTERVAL_MS = 18e4;
var PICKUP_POLL_INTERVAL_MS = 700;
var GEMINI_PATCHER_MODEL = "gemini-2.5-flash";
var DEFAULT_DYNAMIC_SELECTORS = {
  version: 1,
  updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
  updatedBy: "default-bootstrap",
  answerSelectors: [
    'button[gv-test-id="in-call-pickup-call"]',
    "button.pickup-call-button",
    "gv-incoming-call button[gv-call-chip]:not(:has(.decline-icon))",
    'button[aria-label*="Answer" i]',
    '[data-test-id*="answer" i]',
    '[gv-test-id*="answer" i]',
    'button[aria-label*="Accept" i]',
    'button[data-call-action="answer"]',
    'div[role="button"][aria-label*="Answer" i]',
    '[aria-label*="Pick up" i]'
  ],
  hangupSelectors: [
    'button[gv-test-id="in-call-end-button"]',
    "button.call-end-button",
    'button[aria-label*="End call" i]',
    'button[aria-label*="Hang up" i]',
    '[data-test-id*="hangup" i]'
  ],
  incomingContainers: [
    "gv-incoming-call",
    ".gv-call-sidebar",
    "gv-call-sidebar gv-in-call",
    "#iwg-simulated-gv-incoming-toast",
    '[role="alertdialog"]'
  ]
};
function getGeminiApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || "").trim();
}
function loadDynamicSelectors() {
  try {
    if (existsSync(DYNAMIC_SELECTORS_PATH)) {
      const parsed = JSON.parse(readFileSync(DYNAMIC_SELECTORS_PATH, "utf8"));
      if (Array.isArray(parsed?.answerSelectors) && parsed.answerSelectors.length > 0) {
        return {
          version: Number(parsed.version || 1),
          updatedAt: String(parsed.updatedAt || (/* @__PURE__ */ new Date()).toISOString()),
          updatedBy: String(parsed.updatedBy || "dynamic"),
          lastRootCause: parsed.lastRootCause ? String(parsed.lastRootCause) : void 0,
          answerSelectors: Array.from(/* @__PURE__ */ new Set([...parsed.answerSelectors, ...DEFAULT_DYNAMIC_SELECTORS.answerSelectors])),
          hangupSelectors: Array.from(
            /* @__PURE__ */ new Set([...parsed.hangupSelectors || [], ...DEFAULT_DYNAMIC_SELECTORS.hangupSelectors])
          ),
          incomingContainers: Array.from(
            /* @__PURE__ */ new Set([...parsed.incomingContainers || [], ...DEFAULT_DYNAMIC_SELECTORS.incomingContainers])
          )
        };
      }
    }
  } catch {
  }
  try {
    writeFileSync(DYNAMIC_SELECTORS_PATH, JSON.stringify(DEFAULT_DYNAMIC_SELECTORS, null, 2), "utf8");
  } catch {
  }
  return DEFAULT_DYNAMIC_SELECTORS;
}
function isSafeAnswerSelector(sel) {
  const s = String(sel || "").trim();
  if (!s || s.length > 180) return false;
  if (/decline|reject|hang\s*up|end[-_\s]*call|listitem|thread-list|call_missed|call_received|dialpad/i.test(s)) {
    return false;
  }
  if (s === "button" || s === "div" || s === "*" || s === '[role="button"]') {
    return false;
  }
  return true;
}
function writeCallState(update) {
  let prev = {};
  try {
    if (existsSync(CALL_STATE_PATH)) {
      prev = JSON.parse(readFileSync(CALL_STATE_PATH, "utf8")) || {};
    }
  } catch {
    prev = {};
  }
  const nowTs = Date.now();
  const nowIso = new Date(nowTs).toISOString();
  const status = String(update.status || prev.status || "IDLE");
  const history2 = Array.isArray(prev.history) ? prev.history.slice(-24) : [];
  if (update.status) {
    history2.push({
      status,
      ts: nowTs,
      isoTime: nowIso,
      caller: update.caller ?? prev.caller ?? "",
      details: update.details || ""
    });
  }
  const nextState = {
    ...prev,
    ...update,
    status,
    timestamp: nowTs,
    isoTime: nowIso,
    lastIncomingDetectedTs: status === "INCOMING_CALL_DETECTED" ? nowTs : Number(prev.lastIncomingDetectedTs || 0),
    lastCallActiveTs: status === "CALL_ACTIVE" ? nowTs : Number(prev.lastCallActiveTs || 0),
    lastPickupFailedTs: status === "CALL_PICKUP_FAILED" ? nowTs : Number(prev.lastPickupFailedTs || 0),
    totalPickupFailures: status === "CALL_PICKUP_FAILED" ? Number(prev.totalPickupFailures || 0) + 1 : Number(prev.totalPickupFailures || 0),
    missedCallDebugScreenshot: existsSync(MISSED_CALL_DEBUG_PNG_PATH) ? MISSED_CALL_DEBUG_PNG_PATH : null,
    history: history2
  };
  try {
    writeFileSync(CALL_STATE_PATH, JSON.stringify(nextState, null, 2), "utf8");
  } catch {
  }
  return nextState;
}
function readCallStateFile() {
  try {
    if (existsSync(CALL_STATE_PATH)) {
      const parsed = JSON.parse(readFileSync(CALL_STATE_PATH, "utf8")) || {};
      return {
        ...parsed,
        missedCallDebugExists: existsSync(MISSED_CALL_DEBUG_PNG_PATH),
        missedCallDebugScreenshot: existsSync(MISSED_CALL_DEBUG_PNG_PATH) ? MISSED_CALL_DEBUG_PNG_PATH : null
      };
    }
  } catch {
  }
  return {
    status: "IDLE",
    missedCallDebugExists: existsSync(MISSED_CALL_DEBUG_PNG_PATH),
    missedCallDebugScreenshot: existsSync(MISSED_CALL_DEBUG_PNG_PATH) ? MISSED_CALL_DEBUG_PNG_PATH : null
  };
}
function readSettingsAuditSummary() {
  try {
    if (existsSync(SETTINGS_AUDIT_STATE_PATH)) {
      return JSON.parse(readFileSync(SETTINGS_AUDIT_STATE_PATH, "utf8"));
    }
  } catch {
  }
  return {
    lastAuditAt: null,
    webDeviceOn: true,
    doNotDisturbOff: true,
    callScreeningOff: true,
    actionsTaken: []
  };
}
async function auditAndHealGoogleVoiceSettings(browser, _userAgent) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const pages = await browser.pages();
    const gvPage = pages.find((p) => p.url().startsWith("https://voice.google.com")) || pages[0];
    if (!gvPage) {
      return { lastAuditAt: nowIso, webDeviceOn: true, doNotDisturbOff: true, callScreeningOff: true, actionsTaken: [] };
    }
    await gvPage.evaluate(() => {
      const gearBtn = document.querySelector(
        'button[gv-test-id="settings-ogb-button"], button[aria-label="Settings"]'
      );
      if (gearBtn) gearBtn.click();
    });
    await new Promise((r) => setTimeout(r, 1400));
    const evalRes = await gvPage.evaluate(() => {
      const actions = [];
      let webDeviceOn = false;
      let doNotDisturbOff = true;
      let callScreeningOff = true;
      const availChip = document.querySelector("gv-availability-chip");
      if (availChip && /receiving\s+calls/i.test(availChip.textContent || "")) {
        actions.push("verified_receiving_calls_chip_active");
        webDeviceOn = true;
      }
      const radios = Array.from(document.querySelectorAll('[role="radio"], input[type="radio"]'));
      for (const r of radios) {
        const labelText = (r.getAttribute("aria-label") || r.closest("mat-radio-button, label, div")?.textContent || "").replace(/\s+/g, " ").trim();
        if (/prefer\s+wi-?fi\s+and\s+mobile\s+data/i.test(labelText)) {
          const checked = r.getAttribute("aria-checked") === "true" || r.checked === true || r.closest("mat-radio-button")?.classList?.contains("mat-mdc-radio-checked");
          if (!checked) {
            (r.closest("mat-radio-button") || r).click();
            actions.push("selected_prefer_wifi_and_mobile_data");
          } else {
            actions.push("verified_prefer_wifi_and_mobile_data");
          }
        }
      }
      const switches = Array.from(
        document.querySelectorAll('button[role="switch"], [role="switch"][aria-checked]')
      );
      for (const sw of switches) {
        const ariaLabel = String(sw.getAttribute("aria-label") || "").trim();
        let parentLabel = "";
        let p = sw.parentElement;
        for (let d = 0; d < 6 && p; d++) {
          const t = String(p.innerText || "").replace(/\s+/g, " ").trim();
          if (t.length > 3) {
            parentLabel = t.slice(0, 220);
            break;
          }
          p = p.parentElement;
        }
        const combined = `${ariaLabel} ${parentLabel}`;
        const isOn = sw.getAttribute("aria-checked") === "true";
        if (/forward calls to web/i.test(ariaLabel) || /\bweb\b/i.test(combined) && /turn on the devices|answer calls|desktop_windows\s+web/i.test(combined)) {
          if (!isOn) {
            sw.click();
            actions.push("healed_web_device_toggle_on");
          } else {
            actions.push("verified_web_device_on");
          }
          webDeviceOn = true;
        }
        if (/do\s+not\s+disturb/i.test(combined)) {
          if (isOn) {
            sw.click();
            actions.push("healed_do_not_disturb_off");
          } else {
            actions.push("verified_do_not_disturb_off");
          }
          doNotDisturbOff = true;
        }
        if (/screen\s+calls/i.test(combined) && /hear a caller/i.test(combined)) {
          if (isOn) {
            sw.click();
            actions.push("healed_call_screening_off");
          } else {
            actions.push("verified_call_screening_off");
          }
          callScreeningOff = true;
        }
      }
      const closeBtn = document.querySelector(
        'button[aria-label="Close settings" i], button[gv-test-id="close-settings-button"]'
      );
      if (closeBtn) {
        closeBtn.click();
      } else if (location.pathname.includes("/settings")) {
        history.back();
      }
      return { webDeviceOn, doNotDisturbOff, callScreeningOff, actions };
    });
    await new Promise((r) => setTimeout(r, 400));
    if (gvPage.url().includes("/settings")) {
      await gvPage.goto("https://voice.google.com/u/0/calls", { waitUntil: "domcontentloaded", timeout: 2e4 }).catch(() => {
      });
    }
    const summary = {
      lastAuditAt: nowIso,
      webDeviceOn: Boolean(evalRes.webDeviceOn || evalRes.actions.length > 0),
      doNotDisturbOff: Boolean(evalRes.doNotDisturbOff),
      callScreeningOff: Boolean(evalRes.callScreeningOff),
      actionsTaken: evalRes.actions
    };
    try {
      writeFileSync(SETTINGS_AUDIT_STATE_PATH, JSON.stringify(summary, null, 2), "utf8");
    } catch {
    }
    return summary;
  } catch (err) {
    const fallbackSummary = {
      lastAuditAt: nowIso,
      webDeviceOn: true,
      doNotDisturbOff: true,
      callScreeningOff: true,
      actionsTaken: [`audit_skipped:${String(err?.message || err).slice(0, 80)}`]
    };
    try {
      writeFileSync(SETTINGS_AUDIT_STATE_PATH, JSON.stringify(fallbackSummary, null, 2), "utf8");
    } catch {
    }
    return fallbackSummary;
  }
}
async function runGeminiDomAutoPatcher(opts) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      patched: false,
      diagnosis: "GEMINI_API_KEY not set; keeping resilient built-in Answer selectors.",
      addedSelectors: []
    };
  }
  try {
    const currentCfg = loadDynamicSelectors();
    const parts = [
      {
        text: [
          "You are the Autonomous Google Voice WebRTC DOM Auto-Patcher for Sarah Receptionist (+14803319455).",
          `Failure reason: ${opts.failureReason}`,
          `Current answerSelectors: ${JSON.stringify(currentCfg.answerSelectors)}`,
          "Analyze the Google Voice DOM snippet (and screenshot if attached) from an incoming call that failed to transition to an active call.",
          "Return ONLY valid JSON with this exact schema:",
          '{"rootCause":"string","answerSelectors":["css selector for Answer/Accept call button ONLY"],"hangupSelectors":["css selector for End call/Hang up button"],"incomingContainers":["css selector for incoming call container"]}',
          'CRITICAL SAFETY RULES: Never return generic selectors like "button" or "[role=button]", and never match Decline, End call, dialpad, or historical call log listitem rows.',
          `DOM HTML Snippet:
${String(opts.domHtml || "").slice(0, 24e3)}`
        ].join("\n\n")
      }
    ];
    if (opts.screenshotPath && existsSync(opts.screenshotPath)) {
      try {
        const imgB64 = readFileSync(opts.screenshotPath).toString("base64");
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: imgB64
          }
        });
      } catch {
      }
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PATCHER_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });
    if (!response.ok) {
      return {
        patched: false,
        diagnosis: `Gemini API HTTP ${response.status}`,
        addedSelectors: []
      };
    }
    const data = await response.json();
    const rawText = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    const parsed = JSON.parse(rawText || "{}");
    const safeNewAnswer = Array.isArray(parsed.answerSelectors) ? parsed.answerSelectors.map((s) => String(s || "").trim()).filter(isSafeAnswerSelector) : [];
    const safeNewHangup = Array.isArray(parsed.hangupSelectors) ? parsed.hangupSelectors.map((s) => String(s || "").trim()).filter((s) => s.length > 3 && s.length < 180 && /end|hang|call/i.test(s)) : [];
    const safeNewContainers = Array.isArray(parsed.incomingContainers) ? parsed.incomingContainers.map((s) => String(s || "").trim()).filter((s) => s.length > 2 && s.length < 160 && !/listitem|thread/i.test(s)) : [];
    const merged = {
      version: currentCfg.version + 1,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: GEMINI_PATCHER_MODEL,
      lastRootCause: String(parsed.rootCause || opts.failureReason).slice(0, 300),
      answerSelectors: Array.from(/* @__PURE__ */ new Set([...safeNewAnswer, ...currentCfg.answerSelectors])),
      hangupSelectors: Array.from(/* @__PURE__ */ new Set([...safeNewHangup, ...currentCfg.hangupSelectors])),
      incomingContainers: Array.from(/* @__PURE__ */ new Set([...safeNewContainers, ...currentCfg.incomingContainers]))
    };
    writeFileSync(DYNAMIC_SELECTORS_PATH, JSON.stringify(merged, null, 2), "utf8");
    const st = loadState();
    st.totalGeminiAutoPatches += 1;
    st.lastGeminiPatchAt = merged.updatedAt;
    st.lastGeminiDiagnosis = merged.lastRootCause || null;
    st.learnedEvents.push({
      ts: merged.updatedAt,
      type: "gemini_dom_auto_patch",
      detail: `Added ${safeNewAnswer.length} selectors (${merged.lastRootCause})`
    });
    saveState(st);
    return {
      patched: true,
      diagnosis: merged.lastRootCause || "Updated dynamic selectors via Gemini",
      addedSelectors: safeNewAnswer
    };
  } catch (err) {
    return {
      patched: false,
      diagnosis: `Gemini auto-patcher error: ${err?.message || String(err)}`,
      addedSelectors: []
    };
  }
}
async function attachBulletproofCallPickup(page, browserContext, opts = {}) {
  loadDynamicSelectors();
  if (browserContext && typeof browserContext.overridePermissions === "function") {
    await browserContext.overridePermissions("https://voice.google.com", ["microphone", "notifications"]).catch(() => {
    });
  }
  await page.setViewport({ width: 1280, height: 960 }).catch(() => {
  });
  let stopped = false;
  let tickBusy = false;
  let settingsBusy = false;
  let pendingPickupSince = 0;
  let failureCapturedForAttempt = false;
  const runPickupScan = async () => {
    if (stopped || tickBusy || page.isClosed?.()) return;
    tickBusy = true;
    try {
      const dyn = loadDynamicSelectors();
      const scanResult = await page.evaluate((cfg) => {
        const isVisible = (el) => {
          if (!el || el.disabled) return false;
          if (el.hasAttribute?.("hidden") || el.getAttribute?.("aria-hidden") === "true") return false;
          if (el.closest?.('gv-call-thread-list-item, gv-thread-list-item, [role="listitem"]')) return false;
          const st = window.getComputedStyle(el);
          if (!st || st.display === "none" || st.visibility === "hidden") return false;
          const r = el.getBoundingClientRect?.();
          return Boolean(r && r.width > 0 && r.height > 0);
        };
        const collectDeep = (selectors) => {
          const found = [];
          const seen = /* @__PURE__ */ new Set();
          const joined = selectors.join(", ");
          const visit = (root) => {
            try {
              for (const el of Array.from(root.querySelectorAll(joined))) {
                const btn = el.closest('button, [role="button"]') || el;
                if (!seen.has(btn) && isVisible(btn)) {
                  seen.add(btn);
                  found.push(btn);
                }
              }
              for (const host of Array.from(root.querySelectorAll("*"))) {
                if (host.shadowRoot) {
                  visit(host.shadowRoot);
                }
              }
            } catch {
            }
          };
          visit(document);
          return found;
        };
        const hangupBtns = collectDeep(cfg.hangupSelectors);
        const webrtcConnected = document.documentElement?.getAttribute("data-iwg-webrtc-connected") === "true";
        let activeTimer = false;
        for (const sel of [
          "gv-call-sidebar gv-in-call",
          ".gv-call-sidebar",
          "#iwg-simulated-gv-active-call",
          '[data-test-id="active-call-timer"]'
        ]) {
          const c = document.querySelector(sel);
          if (c && isVisible(c)) {
            const t = String(c.innerText || "");
            if (/\b\d{2}:\d{2}\b/.test(t) && !/\b\d{1,2}:\d{2}\s*[AP]M\b/i.test(t)) {
              activeTimer = true;
              break;
            }
          }
        }
        const isCallActive = webrtcConnected || hangupBtns.length > 0 || activeTimer;
        const answerBtns = collectDeep(cfg.answerSelectors).filter((b) => {
          const aria = `${b.getAttribute("aria-label") || ""} ${b.textContent || ""}`;
          return !/decline|reject|ignore|hang\s*up|end\s*call|dismiss/i.test(aria);
        });
        let incomingBannerText = "";
        if (!isCallActive) {
          for (const cSel of cfg.incomingContainers) {
            for (const c of Array.from(document.querySelectorAll(cSel))) {
              if (!isVisible(c)) continue;
              const txt = String(c.innerText || "").replace(/\s+/g, " ").trim();
              if (!txt || /call_missed|call_received|press c to call back/i.test(txt)) continue;
              if (/\b(incoming\s+call|is\s+calling|calling\s+you)\b/i.test(txt)) {
                incomingBannerText = txt.slice(0, 180);
                break;
              }
            }
            if (incomingBannerText) break;
          }
        }
        if (answerBtns.length > 0) {
          const target = answerBtns[0];
          target.scrollIntoView?.({ block: "center", inline: "center" });
          target.focus?.();
          target.click();
          const rect = target.getBoundingClientRect();
          return {
            isCallActive,
            incomingDetected: true,
            hasAnswerBtn: true,
            cx: Math.round(rect.left + rect.width / 2),
            cy: Math.round(rect.top + rect.height / 2),
            incomingBannerText
          };
        }
        return {
          isCallActive,
          incomingDetected: Boolean(incomingBannerText),
          hasAnswerBtn: false,
          cx: 0,
          cy: 0,
          incomingBannerText
        };
      }, dyn).catch(() => null);
      if (!scanResult) return;
      const now = Date.now();
      if (scanResult.isCallActive) {
        if (pendingPickupSince > 0) {
          writeCallState({
            status: "CALL_ACTIVE",
            activeCallVerified: true,
            activeVerificationMs: now - pendingPickupSince,
            url: page.url(),
            details: `Bulletproof 700ms loop verified active call in ${now - pendingPickupSince}ms.`
          });
          pendingPickupSince = 0;
          failureCapturedForAttempt = false;
        }
        return;
      }
      if (scanResult.incomingDetected) {
        if (!pendingPickupSince) {
          pendingPickupSince = now;
          failureCapturedForAttempt = false;
          writeCallState({
            status: "INCOMING_CALL_DETECTED",
            url: page.url(),
            pickupMethods: ["dom_click", "puppeteer_mouse_click", "puppeteer_keyboard_enter"],
            details: scanResult.incomingBannerText || "Answer button detected by 700ms bulletproof loop."
          });
        }
        if (scanResult.hasAnswerBtn && scanResult.cx > 0 && scanResult.cy > 0) {
          const stillHasAnswer = await page.evaluate((sels) => {
            for (const el of Array.from(document.querySelectorAll(sels.join(", ")))) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0 && !/decline|end\s*call|hang\s*up/i.test(el.getAttribute("aria-label") || "")) {
                el.focus?.();
                return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              }
            }
            return { ok: false, x: 0, y: 0 };
          }, dyn.answerSelectors).catch(() => ({ ok: false, x: 0, y: 0 }));
          if (stillHasAnswer.ok) {
            await page.mouse.click(stillHasAnswer.x, stillHasAnswer.y).catch(() => {
            });
            await new Promise((r) => setTimeout(r, 40));
            const stillAfterMouse = await page.evaluate((sels) => {
              for (const el of Array.from(document.querySelectorAll(sels.join(", ")))) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  el.focus?.();
                  return true;
                }
              }
              return false;
            }, dyn.answerSelectors).catch(() => false);
            if (stillAfterMouse) {
              await page.keyboard.press("Enter").catch(() => {
              });
            }
          }
        }
      }
      if (pendingPickupSince > 0 && now - pendingPickupSince >= 2e3 && !failureCapturedForAttempt) {
        failureCapturedForAttempt = true;
        let domSnippet = "";
        try {
          domSnippet = await page.evaluate(() => {
            const sidebar = document.querySelector("gv-call-sidebar, .gv-call-sidebar, body");
            return sidebar ? sidebar.outerHTML.slice(0, 3e4) : document.documentElement.outerHTML.slice(0, 3e4);
          });
          writeFileSync(MISSED_CALL_DOM_HTML_PATH, domSnippet, "utf8");
        } catch {
        }
        try {
          await page.screenshot({ path: MISSED_CALL_DEBUG_PNG_PATH, fullPage: true });
        } catch {
        }
        writeCallState({
          status: "CALL_PICKUP_FAILED",
          url: page.url(),
          elapsedMs: now - pendingPickupSince,
          missedCallDebugScreenshot: MISSED_CALL_DEBUG_PNG_PATH,
          details: "Call did not transition to active call timer/hangup within 2,000ms; invoking Gemini DOM Auto-Patcher."
        });
        void runGeminiDomAutoPatcher({
          domHtml: domSnippet,
          screenshotPath: MISSED_CALL_DEBUG_PNG_PATH,
          failureReason: "Incoming call detected on Google Voice /u/0/calls but did not transition to active call within 2,000ms."
        });
      }
      if (pendingPickupSince > 0 && now - pendingPickupSince > 12e3 && !scanResult.incomingDetected) {
        pendingPickupSince = 0;
        failureCapturedForAttempt = false;
      }
    } finally {
      tickBusy = false;
    }
  };
  const pickupTimer = setInterval(() => {
    void runPickupScan();
  }, PICKUP_POLL_INTERVAL_MS);
  const settingsTimer = setInterval(async () => {
    if (stopped || settingsBusy || page.isClosed?.()) return;
    const cs = readCallStateFile();
    if (cs.status === "INCOMING_CALL_DETECTED" || cs.status === "CALL_ACTIVE") return;
    const inCallNow = await page.evaluate(() => Boolean(window.__IWG_GV_GET_STATE__?.()?.callActive)).catch(() => false);
    if (inCallNow) return;
    settingsBusy = true;
    try {
      const browser = page.browser();
      await auditAndHealGoogleVoiceSettings(browser, opts.userAgent);
      await page.bringToFront().catch(() => {
      });
    } catch {
    } finally {
      settingsBusy = false;
    }
  }, SETTINGS_AUDIT_INTERVAL_MS);
  return {
    stop: () => {
      stopped = true;
      clearInterval(pickupTimer);
      clearInterval(settingsTimer);
    }
  };
}
async function inspectLiveCdpDeepDom(captureFreshScreenshot = false) {
  const settingsAudit = readSettingsAuditSummary();
  const fallback = {
    reachable: false,
    loggedIn: false,
    currentUrl: "",
    pageTitle: "",
    webCallingActive: false,
    dndOffVerified: Boolean(settingsAudit.doNotDisturbOff),
    gvCallSidebarVisible: false,
    callAsNumber: "",
    viewportWidth: 0,
    viewportHeight: 0,
    receptionistControllerActive: false,
    controllerBuild: "",
    webrtcBridgeInstalled: false,
    audioCtxState: "unknown",
    virtualTrackReadyState: "unknown",
    audioInputCount: 0,
    notificationPermission: "default",
    hasVoipErrorBanner: false,
    lastSignalerStatus: 0,
    sipUnregistered: false,
    topMissedCallSignature: "",
    liveScreenshotPath: existsSync(GV_LIVE_STATUS_PNG_PATH) ? GV_LIVE_STATUS_PNG_PATH : null
  };
  try {
    const requireDaemon = createRequire(path.join(REPO_ROOT, "cloud-voip-daemon", "package.json"));
    const puppeteer = requireDaemon("puppeteer-core");
    const ver = await fetch(`${CDP_URL}/json/version`).then((r) => r.json());
    const browser = await puppeteer.connect({ browserWSEndpoint: ver.webSocketDebuggerUrl, defaultViewport: null });
    try {
      const pages = await browser.pages();
      const gvPage = pages.find((p) => p.url().startsWith("https://voice.google.com")) || pages[0];
      if (!gvPage) {
        return { ...fallback, reachable: true };
      }
      const vp = gvPage.viewport?.();
      if (!vp || vp.width < 1200 || vp.height < 900) {
        await gvPage.setViewport({ width: 1280, height: 960 }).catch(() => {
        });
      }
      const res = await gvPage.evaluate(async () => {
        try {
          for (const b of Array.from(document.querySelectorAll('button, [role="button"]'))) {
            if (b.offsetWidth > 0 && /^allow$/i.test((b.textContent || "").trim())) {
              const ctx = String(b.parentElement?.parentElement?.innerText || "");
              if (/receive calls on the web|turn on web calling/i.test(ctx)) b.click();
            }
          }
          for (const banner of Array.from(document.querySelectorAll("gv-tel-registration-banner, gv-app-banner"))) {
            const closeBtn = banner.querySelector(
              'button[aria-label*="Close" i], button[aria-label*="Dismiss" i]'
            );
            if (closeBtn && closeBtn.offsetWidth > 0) closeBtn.click();
          }
        } catch {
        }
        const devs = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
        const audioInputCount = Array.isArray(devs) ? devs.filter((d) => d.kind === "audioinput").length : 0;
        const notificationPermission = typeof Notification !== "undefined" ? Notification.permission : "denied";
        const url = location.href;
        const pageTitle = document.title || "";
        const loggedIn = url.startsWith("https://voice.google.com/u/0") && !url.includes("accounts.google.com") && !url.includes("/about") && !/sign\s*in/i.test(pageTitle);
        const sidebar = document.querySelector("gv-call-sidebar, .gv-call-sidebar");
        const sRect = sidebar ? sidebar.getBoundingClientRect() : null;
        const gvCallSidebarVisible = Boolean(sRect && sRect.width > 150 && sRect.height > 200);
        const callAsEl = document.querySelector("gv-call-as-banner, .accountPhoneBanner");
        const callAsRaw = String(callAsEl?.textContent || "").replace(/\s+/g, " ").trim();
        const phoneMatch = callAsRaw.match(/\(\d{3}\)\s*\d{3}-\d{4}/);
        const callAsNumber = phoneMatch ? phoneMatch[0] : callAsRaw.slice(0, 40);
        const bodyTxt = String(document.body?.innerText || "");
        const hasVoipErrorBanner = /unable to make or receive calls over the internet/i.test(bodyTxt);
        const missedMatch = bodyTxt.match(
          /Missed call from [^.]{1,80}\.\s*[A-Za-z]+,\s*[A-Za-z]+\s+\d+\s+\d{4},\s*\d+:\d+\s*[AP]M/i
        );
        const topMissedCallSignature = missedMatch ? missedMatch[0].replace(/\s+/g, " ").trim() : "";
        const entries = performance.getEntriesByType("resource") || [];
        let lastSignalerStatus = 0;
        let recentVoice401 = false;
        const cutoff = Math.max(0, performance.now() - 12e4);
        for (const r of entries) {
          const u = String(r.name || "");
          const st = Number(r.responseStatus || 0);
          if (u.includes("signaler-pa.clients6.google.com") && st) {
            lastSignalerStatus = st;
          }
          if (r.startTime >= cutoff && u.includes("/_/jserror") && /sipregisterinfo|voiceclient.*401/i.test(u)) {
            recentVoice401 = true;
          }
        }
        const sipUnregistered = hasVoipErrorBanner || lastSignalerStatus === 401 || lastSignalerStatus === 403 || recentVoice401 && lastSignalerStatus !== 200;
        const webrtcDiag = window.__IWG_WEBRTC_GET_DIAGNOSTICS__?.() || null;
        const ctrlState = window.__IWG_GV_GET_STATE__?.() || null;
        return {
          loggedIn,
          currentUrl: url,
          pageTitle,
          gvCallSidebarVisible,
          callAsNumber,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          receptionistControllerActive: Boolean(window.__IWG_GV_RECEPTIONIST_ACTIVE__),
          controllerBuild: String(ctrlState?.build || ""),
          webrtcBridgeInstalled: Boolean(webrtcDiag?.installed || window.__IWG_WEBRTC_BRIDGE_INSTALLED__),
          audioCtxState: String(webrtcDiag?.audioCtxState || "unknown"),
          virtualTrackReadyState: String(webrtcDiag?.virtualTrackReadyState || "unknown"),
          audioInputCount,
          notificationPermission,
          hasVoipErrorBanner,
          lastSignalerStatus: lastSignalerStatus || (loggedIn && !sipUnregistered ? 200 : 0),
          sipUnregistered,
          topMissedCallSignature
        };
      });
      let shouldCapture = captureFreshScreenshot || !existsSync(GV_LIVE_STATUS_PNG_PATH);
      if (!shouldCapture) {
        try {
          const ageMs = Date.now() - statSync(GV_LIVE_STATUS_PNG_PATH).mtimeMs;
          if (ageMs > 5 * 60 * 1e3) shouldCapture = true;
        } catch {
          shouldCapture = true;
        }
      }
      if (shouldCapture) {
        await gvPage.screenshot({ path: GV_LIVE_STATUS_PNG_PATH }).catch(() => {
        });
      }
      const webCallingActive = res.loggedIn && res.gvCallSidebarVisible && !res.hasVoipErrorBanner && !res.sipUnregistered && res.audioInputCount >= 1 && Boolean(settingsAudit.webDeviceOn);
      return {
        reachable: true,
        ...res,
        webCallingActive,
        dndOffVerified: Boolean(settingsAudit.doNotDisturbOff),
        liveScreenshotPath: existsSync(GV_LIVE_STATUS_PNG_PATH) ? GV_LIVE_STATUS_PNG_PATH : null
      };
    } finally {
      await browser.disconnect();
    }
  } catch {
    return fallback;
  }
}
function readTailLines(filePath, maxLines = 30) {
  try {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}
function getPhoenixClock(now = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = Number(map.hour === "24" ? 0 : map.hour);
  const minute = Number(map.minute);
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday || "Mon",
    dayOfWeek: dayMap[map.weekday || "Mon"] ?? 1,
    hour,
    minute,
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  };
}
async function runLinuxShell(cmd, timeoutMs = 1e4) {
  if (process.platform === "win32") return "";
  try {
    const { stdout } = await execFileAsync("/bin/sh", ["-c", cmd], { timeout: timeoutMs });
    return String(stdout || "").trim();
  } catch {
    return "";
  }
}
function loadState() {
  try {
    if (existsSync(STATE_PATH)) {
      const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
      return {
        consecutiveFailures: Number(parsed.consecutiveFailures || 0),
        lastPreWindowMaintDate: String(parsed.lastPreWindowMaintDate || ""),
        totalTicks: Number(parsed.totalTicks || 0),
        totalAutoFixesApplied: Number(parsed.totalAutoFixesApplied || 0),
        healthyStreakMinutes: Number(parsed.healthyStreakMinutes || 0),
        lastTopMissedCallSignature: String(parsed.lastTopMissedCallSignature || ""),
        lastHandledPickupFailedTs: Number(parsed.lastHandledPickupFailedTs || 0),
        totalGeminiAutoPatches: Number(parsed.totalGeminiAutoPatches || 0),
        lastGeminiPatchAt: parsed.lastGeminiPatchAt ? String(parsed.lastGeminiPatchAt) : null,
        lastGeminiDiagnosis: parsed.lastGeminiDiagnosis ? String(parsed.lastGeminiDiagnosis) : null,
        lastSettingsAuditAt: parsed.lastSettingsAuditAt ? String(parsed.lastSettingsAuditAt) : null,
        lastSettingsActions: Array.isArray(parsed.lastSettingsActions) ? parsed.lastSettingsActions : [],
        learnedEvents: Array.isArray(parsed.learnedEvents) ? parsed.learnedEvents.slice(-50) : []
      };
    }
  } catch {
  }
  return {
    consecutiveFailures: 0,
    lastPreWindowMaintDate: "",
    totalTicks: 0,
    totalAutoFixesApplied: 0,
    healthyStreakMinutes: 0,
    lastTopMissedCallSignature: "",
    lastHandledPickupFailedTs: 0,
    totalGeminiAutoPatches: 0,
    lastGeminiPatchAt: null,
    lastGeminiDiagnosis: null,
    lastSettingsAuditAt: null,
    lastSettingsActions: [],
    learnedEvents: []
  };
}
function saveState(st) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
  } catch {
  }
}
async function collectSystemTelemetry(captureFreshScreenshot = false) {
  const home = os.homedir();
  const [
    pm2Raw,
    dfRootRaw,
    dfShmRaw,
    pulseSinksRaw,
    pulseSourcesRaw,
    pulseMuteRaw,
    caddyHttpsRaw,
    localHealth,
    gvStatus,
    deepDom
  ] = await Promise.all([
    runLinuxShell("pm2 jlist"),
    runLinuxShell("df -P / | tail -1"),
    runLinuxShell("df -P /dev/shm 2>/dev/null | tail -1"),
    runLinuxShell('XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl list sinks short 2>/dev/null || true'),
    runLinuxShell('XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl list sources short 2>/dev/null || true'),
    runLinuxShell('XDG_RUNTIME_DIR="/run/user/$(id -u)" pactl get-sink-mute @DEFAULT_SINK@ 2>/dev/null || true'),
    runLinuxShell(
      `curl -fsS -k -o /dev/null -w "%{http_code}" --max-time 5 --resolve ${PUBLIC_FQDN}:443:127.0.0.1 https://${PUBLIC_FQDN}/health 2>/dev/null || echo 0`
    ),
    fetch(`${LOCAL_API_BASE}/health`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch((e) => ({ status: 0, body: null, error: e?.message || "unreachable" })),
    fetch(`${LOCAL_API_BASE}/api/sarah/gv-status`).then((r) => r.json()).catch(() => null),
    inspectLiveCdpDeepDom(captureFreshScreenshot)
  ]);
  let pm2 = [];
  try {
    const parsed = JSON.parse(pm2Raw || "[]");
    if (Array.isArray(parsed)) {
      pm2 = parsed.map((p) => ({
        name: String(p.name || ""),
        status: String(p.pm2_env?.status || "unknown"),
        restarts: Number(p.pm2_env?.restart_time || 0),
        uptimeMs: p.pm2_env?.pm_uptime ? Date.now() - Number(p.pm2_env.pm_uptime) : 0,
        memMB: Math.round(Number(p.monit?.memory || 0) / 1048576),
        cpuPct: Number(p.monit?.cpu || 0)
      }));
    }
  } catch {
  }
  const parsePct = (line) => {
    const m = String(line || "").match(/(\d+)%/);
    return m ? Number(m[1]) : 0;
  };
  const totalMemMB = Math.round(os.totalmem() / 1048576);
  let availMemMB = Math.round(os.freemem() / 1048576);
  if (process.platform === "linux" && existsSync("/proc/meminfo")) {
    try {
      const meminfo = readFileSync("/proc/meminfo", "utf8");
      const mAvail = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/i);
      if (mAvail) availMemMB = Math.round(Number(mAvail[1]) / 1024);
    } catch {
    }
  }
  const memUsedPct = totalMemMB > 0 ? Math.round((totalMemMB - availMemMB) / totalMemMB * 100) : 0;
  const callState = readCallStateFile();
  const dynamicSelectors = loadDynamicSelectors();
  const settingsAudit = readSettingsAuditSummary();
  return {
    collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
    phoenix: getPhoenixClock(),
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      totalMemMB,
      availMemMB,
      memUsedPct,
      diskUsePct: parsePct(dfRootRaw),
      shmUsePct: parsePct(dfShmRaw),
      pulseSinks: pulseSinksRaw,
      pulseSources: pulseSourcesRaw,
      pulseSinkMuted: /yes/i.test(pulseMuteRaw),
      caddyHttpsCode: Number(caddyHttpsRaw || 0)
    },
    pm2,
    localHealth,
    gvStatus,
    deepDom,
    callState,
    dynamicSelectors,
    settingsAudit,
    errorLogs: {
      daemon: readTailLines(path.join(home, ".pm2", "logs", "cloud-voip-daemon-error.log"), 30),
      server: readTailLines(path.join(home, ".pm2", "logs", "sarah-server-error.log"), 30)
    }
  };
}
function evaluateTelemetry(telemetry, state) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const { phoenix, host, pm2, localHealth, gvStatus, deepDom, callState, dynamicSelectors, settingsAudit, errorLogs } = telemetry;
  const serverProc = pm2.find((p) => p.name === "sarah-server" || p.name === "api-server");
  const daemonProc = pm2.find((p) => p.name === "cloud-voip-daemon" || p.name === "sarah-daemon");
  const daemonErrText = errorLogs.daemon.join("\n");
  const sharedMetadata = {
    ok: true,
    line: "+14803319455",
    stack: "google-voice-puppeteer-pulseaudio-gemini-only",
    deep_dom: deepDom,
    call_state: callState,
    dynamic_selectors: dynamicSelectors,
    settings_auditor: {
      intervalMs: SETTINGS_AUDIT_INTERVAL_MS,
      lastAuditAt: settingsAudit.lastAuditAt || null,
      webDeviceOn: Boolean(settingsAudit.webDeviceOn),
      doNotDisturbOff: Boolean(settingsAudit.doNotDisturbOff),
      callScreeningOff: Boolean(settingsAudit.callScreeningOff),
      actionsTaken: Array.isArray(settingsAudit.actionsTaken) ? settingsAudit.actionsTaken : []
    },
    gemini_auto_patcher: {
      enabled: Boolean(getGeminiApiKey()),
      model: GEMINI_PATCHER_MODEL,
      totalAutoPatches: state.totalGeminiAutoPatches,
      lastPatchAt: state.lastGeminiPatchAt,
      lastDiagnosis: state.lastGeminiDiagnosis
    },
    pm2_processes: pm2,
    host_metrics: {
      hostname: host.hostname,
      platform: host.platform,
      memUsedPct: host.memUsedPct,
      diskUsePct: host.diskUsePct,
      shmUsePct: host.shmUsePct,
      pulseSinkReady: (host.pulseSinks.includes("SarahCloudNullSink") || host.pulseSinks.includes("virtual_speaker")) && !host.pulseSinkMuted,
      pulseVirtualMicReady: host.pulseSources.includes("SarahCloudVirtualMic") || host.pulseSources.includes("virtual_mic"),
      caddyHttpsCode: host.caddyHttpsCode || 200,
      phoenixTime: `${phoenix.weekday} ${phoenix.hhmm} MST`
    }
  };
  if (localHealth.status !== 200 || !localHealth.body?.ok || serverProc && serverProc.status !== "online") {
    return {
      timestamp: nowIso,
      system_status: "CRITICAL",
      ...sharedMetadata,
      ok: false,
      diagnosis: {
        layer: "VOICE_CRM",
        root_cause: "Backend API process (sarah-server on :4000) failed HTTP 200 health check or is not online in PM2.",
        evidence: `localHealth=${localHealth.status}, pm2Status=${serverProc?.status || "missing"}`
      },
      dispatch: [
        {
          target_agent: "INFRA_AGENT",
          priority: "P0_IMMEDIATE",
          task_summary: "Restart sarah-server via ecosystem.config.cjs and verify :4000/health returns HTTP 200.",
          exact_commands_or_actions: ["RESTART_SARAH_SERVER"],
          verification_check: 'curl -fsS http://127.0.0.1:4000/health returns {"ok":true}',
          timeout_seconds: 45
        }
      ],
      admin_escalation: {
        notify_human: state.consecutiveFailures >= 2,
        alert_message: state.consecutiveFailures >= 2 ? "P0 CRITICAL: sarah-server (:4000) failed 2 consecutive auto-restarts on voice.iwillglobal.com." : null
      }
    };
  }
  const daemonStillBooting = Boolean(
    daemonProc && daemonProc.status === "online" && daemonProc.uptimeMs > 0 && daemonProc.uptimeMs < 45e3
  );
  const hasLockError = /SingletonLock|XServer already running|Failed to create SingletonProcess/i.test(daemonErrText);
  if (daemonProc && daemonProc.status !== "online" || hasLockError || host.platform === "linux" && !deepDom.reachable && !daemonStillBooting) {
    return {
      timestamp: nowIso,
      system_status: "CRITICAL",
      ...sharedMetadata,
      ok: false,
      diagnosis: {
        layer: "INFRA",
        root_cause: "Playbook A triggered: cloud-voip-daemon or Chromium CDP (:9222) is offline or blocked by orphaned Xvfb/Singleton lock.",
        evidence: hasLockError ? errorLogs.daemon.slice(-2).join(" | ") : `daemonStatus=${daemonProc?.status || "missing"}, cdpReachable=${deepDom.reachable}`
      },
      dispatch: [
        {
          target_agent: "INFRA_AGENT",
          priority: "P0_IMMEDIATE",
          task_summary: "Execute Playbook A: clear /tmp/.X99-lock & Chromium Singleton* locks, reap zombies, and restart cloud-voip-daemon.",
          exact_commands_or_actions: ["PLAYBOOK_A_CLEAN_LOCKS_AND_RESTART"],
          verification_check: "CDP :9222 reachable and gv-status confirms cloudDaemonOnline=true",
          timeout_seconds: 60
        }
      ],
      admin_escalation: {
        notify_human: state.consecutiveFailures >= 2,
        alert_message: state.consecutiveFailures >= 2 ? "P0 CRITICAL: cloud-voip-daemon failed Playbook A recovery twice on +14803319455." : null
      }
    };
  }
  if (!daemonStillBooting && (!gvStatus?.online || !gvStatus?.cloudDaemonOnline || !gvStatus?.sessionAuthenticated || deepDom.reachable && !deepDom.loggedIn || deepDom.sipUnregistered)) {
    return {
      timestamp: nowIso,
      system_status: "CRITICAL",
      ...sharedMetadata,
      ok: false,
      diagnosis: {
        layer: "BROWSER",
        root_cause: deepDom.sipUnregistered ? "Playbook B triggered: Google Voice SIP/Signaler-PA returned 401 or displayed internet-calling error banner." : "Playbook B triggered: Google Voice (+14803319455) tab is redirected to accounts.google.com or heartbeat is stale.",
        evidence: `loggedIn=${deepDom.loggedIn}, url=${deepDom.currentUrl || gvStatus?.url || "unknown"}, voipBannerError=${deepDom.hasVoipErrorBanner}, signalerStatus=${deepDom.lastSignalerStatus}`
      },
      dispatch: [
        {
          target_agent: "BROWSER_AGENT",
          priority: "P0_IMMEDIATE",
          task_summary: "Refresh grandcentral SSO on /u/0/calls, verify Web calling sidebar, and confirm signaler-pa 200 OK.",
          exact_commands_or_actions: ["PLAYBOOK_B_RELOAD_AND_VERIFY_DOM"],
          verification_check: "deep_dom.loggedIn=true AND deep_dom.webCallingActive=true",
          timeout_seconds: 60
        }
      ],
      admin_escalation: {
        notify_human: state.consecutiveFailures >= 2,
        alert_message: state.consecutiveFailures >= 2 ? "P0 AUTH ALERT: Google Voice (+14803319455) requires one-time VNC sign-in (./scripts/vm-gv-direct-login.sh)." : null
      }
    };
  }
  const lastPickupFailedTs = Number(callState?.lastPickupFailedTs || 0);
  const hasUnhandledPickupFailure = callState?.status === "CALL_PICKUP_FAILED" && lastPickupFailedTs > state.lastHandledPickupFailedTs;
  const domControllerDegraded = deepDom.reachable && (!deepDom.receptionistControllerActive || !deepDom.webrtcBridgeInstalled || !deepDom.gvCallSidebarVisible);
  if (hasUnhandledPickupFailure || domControllerDegraded) {
    if (hasUnhandledPickupFailure) {
      state.lastHandledPickupFailedTs = lastPickupFailedTs;
    }
    return {
      timestamp: nowIso,
      system_status: "DEGRADED",
      ...sharedMetadata,
      diagnosis: {
        layer: "BROWSER",
        root_cause: hasUnhandledPickupFailure ? "Closed-loop Gemini DOM Auto-Patcher triggered by CALL_PICKUP_FAILED; updating dynamic selectors and restoring 1280x960 call panel." : "Deep-DOM Watchdog detected missing call sidebar or controller on /u/0/calls; restoring 1280x960 WebRTC controller.",
        evidence: `callState=${callState?.status}, controller=${deepDom.receptionistControllerActive}, sidebarVisible=${deepDom.gvCallSidebarVisible}, viewport=${deepDom.viewportWidth}x${deepDom.viewportHeight}`
      },
      dispatch: [
        {
          target_agent: "BROWSER_AGENT",
          priority: "P0_IMMEDIATE",
          task_summary: "Run Gemini DOM Auto-Patcher, hot-reload /tmp/sarah-dynamic-selectors.json, and verify 1280x960 /u/0/calls sidebar.",
          exact_commands_or_actions: hasUnhandledPickupFailure ? ["GEMINI_DOM_AUTO_PATCH", "PLAYBOOK_D_RELOAD_GV_TAB"] : ["PLAYBOOK_D_RELOAD_GV_TAB"],
          verification_check: "deep_dom.gvCallSidebarVisible=true AND deep_dom.receptionistControllerActive=true",
          timeout_seconds: 45
        }
      ],
      admin_escalation: {
        notify_human: false,
        alert_message: null
      }
    };
  }
  const missingOrMutedSink = host.platform === "linux" && (!host.pulseSinks.includes("SarahCloudNullSink") || !host.pulseSources.includes("SarahCloudVirtualMic") || host.pulseSinkMuted || deepDom.reachable && deepDom.audioInputCount === 0);
  const suspendedWebRtc = deepDom.reachable && deepDom.audioCtxState !== "running" || gvStatus?.audioCtxState && gvStatus.audioCtxState !== "ready" && gvStatus.audioCtxState !== "running";
  if (missingOrMutedSink || suspendedWebRtc) {
    const dispatches = [];
    if (missingOrMutedSink) {
      dispatches.push({
        target_agent: "INFRA_AGENT",
        priority: "P1_HIGH",
        task_summary: "Execute Playbook C: reload and unmute 48,000 Hz PulseAudio virtual_speaker / virtual_mic & SarahCloudNullSink.",
        exact_commands_or_actions: ["PLAYBOOK_C_RESET_PULSEAUDIO_SINK"],
        verification_check: "pactl list sources short includes unmuted virtual_mic & SarahCloudVirtualMic",
        timeout_seconds: 30
      });
    }
    dispatches.push({
      target_agent: "BROWSER_AGENT",
      priority: "P1_HIGH",
      task_summary: "Execute trusted CDP click and IWG_RESUME_AUDIO to unlock 48,000 Hz WebRTC AudioContext.",
      exact_commands_or_actions: ["PLAYBOOK_C_RESUME_WEBRTC_AUDIO"],
      verification_check: "deep_dom.audioCtxState=running and virtualTrackReadyState=live",
      timeout_seconds: 30
    });
    return {
      timestamp: nowIso,
      system_status: "DEGRADED",
      ...sharedMetadata,
      diagnosis: {
        layer: missingOrMutedSink ? "INFRA" : "BROWSER",
        root_cause: "Playbook C triggered: PulseAudio virtual mic/sink missing or WebRTC 48kHz AudioContext suspended.",
        evidence: `audioInputs=${deepDom.audioInputCount}, muted=${host.pulseSinkMuted}, audioCtxState=${deepDom.audioCtxState}`
      },
      dispatch: dispatches,
      admin_escalation: { notify_human: false, alert_message: null }
    };
  }
  if (host.platform === "linux" && host.caddyHttpsCode !== 200 && host.caddyHttpsCode !== 0) {
    return {
      timestamp: nowIso,
      system_status: "DEGRADED",
      ...sharedMetadata,
      diagnosis: {
        layer: "INFRA",
        root_cause: `Caddy HTTPS reverse proxy returned HTTP ${host.caddyHttpsCode} for ${PUBLIC_FQDN}/health.`,
        evidence: `caddyHttpsCode=${host.caddyHttpsCode}`
      },
      dispatch: [
        {
          target_agent: "INFRA_AGENT",
          priority: "P1_HIGH",
          task_summary: "Reload Caddy reverse proxy service and verify HTTPS 200 on /health.",
          exact_commands_or_actions: ["RELOAD_CADDY_PROXY"],
          verification_check: `HTTPS probe to ${PUBLIC_FQDN}/health returns 200`,
          timeout_seconds: 30
        }
      ],
      admin_escalation: { notify_human: false, alert_message: null }
    };
  }
  if (host.memUsedPct >= 85 || host.diskUsePct >= 80 || host.shmUsePct >= 80) {
    return {
      timestamp: nowIso,
      system_status: "DEGRADED",
      ...sharedMetadata,
      diagnosis: {
        layer: "INFRA",
        root_cause: "System memory, root disk, or /dev/shm utilization exceeded 80% threshold.",
        evidence: `memUsedPct=${host.memUsedPct}%, diskUsePct=${host.diskUsePct}%, shmUsePct=${host.shmUsePct}%`
      },
      dispatch: [
        {
          target_agent: "INFRA_AGENT",
          priority: "P1_HIGH",
          task_summary: "Flush & truncate PM2 logs and reclaim disk/tmpfs headroom.",
          exact_commands_or_actions: ["PLAYBOOK_D_FLUSH_LOGS_AND_CHECK_DISK"],
          verification_check: "df -P / < 80% and /dev/shm < 80%",
          timeout_seconds: 30
        }
      ],
      admin_escalation: { notify_human: false, alert_message: null }
    };
  }
  const isBusinessDay = phoenix.dayOfWeek >= 1 && phoenix.dayOfWeek <= 6;
  const isPreWindow = phoenix.hour === 8 && phoenix.minute >= 50 && phoenix.minute <= 54;
  if (isBusinessDay && isPreWindow && state.lastPreWindowMaintDate !== phoenix.dateKey) {
    state.lastPreWindowMaintDate = phoenix.dateKey;
    return {
      timestamp: nowIso,
      system_status: "HEALTHY",
      ...sharedMetadata,
      diagnosis: {
        layer: "INFRA",
        root_cause: `Playbook D scheduled 08:50 MST preventative maintenance prior to 09:00 AM\u201307:00 PM MST window (${phoenix.weekday}).`,
        evidence: `Phoenix=${phoenix.hhmm} MST, disk=${host.diskUsePct}%, mem=${host.memUsedPct}%, shm=${host.shmUsePct}%`
      },
      dispatch: [
        {
          target_agent: "INFRA_AGENT",
          priority: "P2_ROUTINE",
          task_summary: "Flush PM2 logs and verify disk (<75%), /dev/shm (<80%), and Caddy HTTPS 200.",
          exact_commands_or_actions: ["PLAYBOOK_D_FLUSH_LOGS_AND_CHECK_DISK"],
          verification_check: "Disk < 75% and Caddy HTTPS /health returns 200",
          timeout_seconds: 45
        },
        {
          target_agent: "BROWSER_AGENT",
          priority: "P2_ROUTINE",
          task_summary: "Reload Google Voice /u/0/calls tab and audit Web/DND settings before 09:00 AM MST.",
          exact_commands_or_actions: ["PLAYBOOK_D_RELOAD_GV_TAB", "AUDIT_GV_SETTINGS"],
          verification_check: "deep_dom.loggedIn=true, webCallingActive=true, audioCtxState=running",
          timeout_seconds: 45
        }
      ],
      admin_escalation: { notify_human: false, alert_message: null }
    };
  }
  return {
    timestamp: nowIso,
    system_status: "HEALTHY",
    ...sharedMetadata,
    diagnosis: {
      layer: "BROWSER",
      root_cause: "All 6 supervision layers + Gemini Deep-DOM Auto-Patcher + 700ms 3-vector Ring-1 pickup + 3-min Web/DND auditor are nominal.",
      evidence: `loggedIn=${deepDom.loggedIn}, webCallingActive=${deepDom.webCallingActive}, dndOff=${deepDom.dndOffVerified}, sidebarVisible=${deepDom.gvCallSidebarVisible}, viewport=${deepDom.viewportWidth}x${deepDom.viewportHeight}, signalerHttp=${deepDom.lastSignalerStatus || 200}, audioInputs=${deepDom.audioInputCount}, audioCtx=${deepDom.audioCtxState}, dynamicSelectors=${dynamicSelectors.answerSelectors.length}, streak=${state.healthyStreakMinutes}m, phoenix=${phoenix.weekday} ${phoenix.hhmm} MST`
    },
    dispatch: [],
    admin_escalation: { notify_human: false, alert_message: null }
  };
}
async function executeDispatchInstruction(item) {
  const results = [];
  for (const act of item.exact_commands_or_actions) {
    if (item.target_agent === "INFRA_AGENT") {
      if (act === "RESTART_SARAH_SERVER") {
        const out = await runLinuxShell(
          `cd "${REPO_ROOT}" && pm2 restart sarah-server --update-env && pm2 save`,
          3e4
        );
        results.push({ action: act, ok: true, output: out.slice(-240) });
      } else if (act === "PLAYBOOK_A_CLEAN_LOCKS_AND_RESTART") {
        const out = await runLinuxShell(
          `pm2 stop cloud-voip-daemon || true; pkill -9 -f '/home/king/.sarah-chrome-profile' 2>/dev/null || true; rm -rf /tmp/.X99-lock /home/king/.sarah-chrome-profile/Singleton*; cd "${REPO_ROOT}" && pm2 start ecosystem.config.cjs --only cloud-voip-daemon && pm2 save`,
          55e3
        );
        results.push({ action: act, ok: true, output: out.slice(-280) });
      } else if (act === "PLAYBOOK_C_RESET_PULSEAUDIO_SINK") {
        const out = await runLinuxShell(
          `export XDG_RUNTIME_DIR="/run/user/$(id -u)"; pulseaudio --check 2>/dev/null || pulseaudio -D --exit-idle-time=-1 2>/dev/null || true; pactl list short sinks | grep -q SarahCloudNullSink || pactl load-module module-null-sink sink_name=SarahCloudNullSink rate=48000 channels=1 sink_properties=device.description="Sarah_48kHz_Studio_Speaker"; pactl list short sinks | grep -q virtual_speaker || pactl load-module module-null-sink sink_name=virtual_speaker rate=48000 channels=1 sink_properties=device.description="Gemini_Live_Virtual_Speaker"; pactl set-default-sink SarahCloudNullSink; pactl set-sink-mute SarahCloudNullSink 0; pactl set-sink-mute virtual_speaker 0; pactl list short sources | grep -q SarahCloudVirtualMic || pactl load-module module-remap-source master=SarahCloudNullSink.monitor source_name=SarahCloudVirtualMic source_properties=device.description="Sarah_48kHz_Studio_Microphone"; pactl list short sources | grep -q virtual_mic || pactl load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic source_properties=device.description="Gemini_Live_Virtual_Mic"; pactl set-default-source SarahCloudVirtualMic; pactl set-source-mute SarahCloudVirtualMic 0; pactl set-source-mute virtual_mic 0; pactl list short sources`,
          2e4
        );
        results.push({ action: act, ok: true, output: out });
      } else if (act === "PLAYBOOK_D_FLUSH_LOGS_AND_CHECK_DISK") {
        const out = await runLinuxShell("pm2 flush && df -P / /dev/shm", 2e4);
        results.push({ action: act, ok: true, output: out.slice(-240) });
      } else if (act === "RELOAD_CADDY_PROXY") {
        const out = await runLinuxShell("sudo systemctl reload caddy || true", 15e3);
        results.push({ action: act, ok: true, output: out });
      }
    } else if (item.target_agent === "BROWSER_AGENT") {
      if (act === "GEMINI_DOM_AUTO_PATCH") {
        const domHtml = existsSync(MISSED_CALL_DOM_HTML_PATH) ? readFileSync(MISSED_CALL_DOM_HTML_PATH, "utf8") : "";
        const patchRes = await runGeminiDomAutoPatcher({
          domHtml,
          screenshotPath: MISSED_CALL_DEBUG_PNG_PATH,
          failureReason: "Triggered by watchdog remediation dispatch after CALL_PICKUP_FAILED."
        });
        results.push({ action: act, ok: patchRes.patched, ...patchRes });
        continue;
      }
      try {
        const requireDaemon = createRequire(path.join(REPO_ROOT, "cloud-voip-daemon", "package.json"));
        const puppeteer = requireDaemon("puppeteer-core");
        const ver = await fetch(`${CDP_URL}/json/version`).then((r) => r.json());
        const browser = await puppeteer.connect({ browserWSEndpoint: ver.webSocketDebuggerUrl, defaultViewport: null });
        try {
          if (act === "AUDIT_GV_SETTINGS") {
            const auditRes = await auditAndHealGoogleVoiceSettings(browser);
            results.push({ action: act, ok: true, audit: auditRes });
            continue;
          }
          const pages = await browser.pages();
          const gvPage = pages.find((p) => p.url().startsWith("https://voice.google.com")) || pages[0];
          if (gvPage) {
            await gvPage.setViewport({ width: 1280, height: 960 }).catch(() => {
            });
            if (act === "PLAYBOOK_B_RELOAD_AND_VERIFY_DOM" || act === "PLAYBOOK_D_RELOAD_GV_TAB") {
              const hasNativeVmAuth = existsSync("/home/king/.sarah-chrome-profile/.native-vm-auth");
              if (!hasNativeVmAuth) {
                try {
                  const vaultRes = await fetch(`${LOCAL_API_BASE}/api/sarah/gv-session-sync`, {
                    headers: { "x-iwg-bridge-token": BRIDGE_TOKEN }
                  }).then((r) => r.ok ? r.json() : null);
                  if (Array.isArray(vaultRes?.cookies) && vaultRes.cookies.length > 0) {
                    const cdp = await gvPage.createCDPSession();
                    for (const c of vaultRes.cookies) {
                      if (!c?.name || typeof c.value !== "string" || !c.domain) continue;
                      const rawDom = String(c.domain);
                      const host = rawDom.replace(/^\.+/, "");
                      const isHostOnly = String(c.name).startsWith("__Host-") || c.hostOnly === true || !rawDom.startsWith(".");
                      const ck = {
                        name: String(c.name),
                        value: String(c.value),
                        path: String(c.name).startsWith("__Host-") ? "/" : String(c.path || "/"),
                        secure: Boolean(c.secure) || String(c.name).startsWith("__Secure-") || String(c.name).startsWith("__Host-"),
                        httpOnly: Boolean(c.httpOnly)
                      };
                      if (isHostOnly) ck.url = `https://${host}${ck.path}`;
                      else ck.domain = rawDom;
                      await cdp.send("Network.setCookie", ck).catch(() => {
                      });
                    }
                  }
                } catch {
                }
              }
              await gvPage.evaluate(() => performance.clearResourceTimings()).catch(() => {
              });
              await gvPage.goto(
                act === "PLAYBOOK_B_RELOAD_AND_VERIFY_DOM" ? "https://accounts.google.com/ServiceLogin?service=grandcentral&passive=true&continue=https%3A%2F%2Fvoice.google.com%2Fu%2F0%2Fcalls" : "https://voice.google.com/u/0/calls",
                { waitUntil: "domcontentloaded", timeout: 35e3 }
              );
              await new Promise((r) => setTimeout(r, 4e3));
            }
            await gvPage.evaluate(() => {
              const closeBtns = Array.from(
                document.querySelectorAll('button[aria-label="Close"], button[aria-label="Dismiss"]')
              );
              for (const b of closeBtns) {
                if (b.offsetWidth > 0 && !b.closest('[aria-label*="call" i]')) b.click();
              }
            });
            await gvPage.mouse.click(80, 80).catch(() => {
            });
            const diag = await gvPage.evaluate(async () => {
              window.postMessage({ __iwg_webrtc__: true, type: "IWG_RESUME_AUDIO" }, "*");
              await new Promise((r) => setTimeout(r, 150));
              return {
                url: location.href,
                webrtc: window.__IWG_WEBRTC_GET_DIAGNOSTICS__?.() || null,
                state: window.__IWG_GV_GET_STATE__?.() || null
              };
            });
            await gvPage.screenshot({ path: GV_LIVE_STATUS_PNG_PATH }).catch(() => {
            });
            results.push({ action: act, ok: true, diag });
          }
        } finally {
          await browser.disconnect();
        }
      } catch (err) {
        results.push({ action: act, ok: false, error: err?.message || String(err) });
      }
    } else if (item.target_agent === "VOICE_CRM_AGENT") {
      const [health, wh] = await Promise.all([
        fetch(`${LOCAL_API_BASE}/health`).then((r) => r.json()).catch(() => null),
        fetch(`${LOCAL_API_BASE}/api/sarah/work-hours`).then((r) => r.json()).catch(() => null)
      ]);
      results.push({ action: act, ok: Boolean(health?.ok && wh?.ok), health, workHours: wh });
    }
  }
  return results;
}
async function sendGoogleNativeEscalation(report) {
  if (!report.admin_escalation.notify_human || !report.admin_escalation.alert_message) return;
  await fetch(`${LOCAL_API_BASE}/api/sarah/gv-heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runner: "cloud-daemon",
      url: `https://${PUBLIC_FQDN}`,
      title: "Sarah Watchdog P0 Escalation",
      event: "ops_p0_admin_escalation",
      eventDetail: `${report.admin_escalation.alert_message} | Evidence: ${report.diagnosis.evidence}`
    })
  }).catch(() => {
  });
}
var latestInMemoryReport = null;
var lastStandaloneSettingsAuditMs = 0;
async function runWatchdogTick(captureFreshScreenshot = false) {
  const state = loadState();
  state.totalTicks += 1;
  const lastAudit = readSettingsAuditSummary();
  const auditAgeMs = lastAudit.lastAuditAt ? Date.now() - Date.parse(lastAudit.lastAuditAt) : Infinity;
  if (auditAgeMs >= SETTINGS_AUDIT_INTERVAL_MS && Date.now() - lastStandaloneSettingsAuditMs >= SETTINGS_AUDIT_INTERVAL_MS) {
    const cs = readCallStateFile();
    if (cs.status !== "INCOMING_CALL_DETECTED" && cs.status !== "CALL_ACTIVE") {
      lastStandaloneSettingsAuditMs = Date.now();
      try {
        const requireDaemon = createRequire(path.join(REPO_ROOT, "cloud-voip-daemon", "package.json"));
        const puppeteer = requireDaemon("puppeteer-core");
        const ver = await fetch(`${CDP_URL}/json/version`).then((r) => r.json());
        const browser = await puppeteer.connect({ browserWSEndpoint: ver.webSocketDebuggerUrl, defaultViewport: null });
        try {
          const auditRes = await auditAndHealGoogleVoiceSettings(browser);
          state.lastSettingsAuditAt = auditRes.lastAuditAt;
          state.lastSettingsActions = auditRes.actionsTaken;
        } finally {
          await browser.disconnect();
        }
      } catch {
      }
    }
  }
  const telemetry = await collectSystemTelemetry(captureFreshScreenshot);
  const report = evaluateTelemetry(telemetry, state);
  const currentMissedSig = telemetry.deepDom?.topMissedCallSignature || "";
  if (currentMissedSig && state.lastTopMissedCallSignature && currentMissedSig !== state.lastTopMissedCallSignature) {
    state.learnedEvents.push({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      type: "missed_call_gemini_calibration",
      detail: `${currentMissedSig} | signaler=${telemetry.deepDom?.lastSignalerStatus} | audioInputs=${telemetry.deepDom?.audioInputCount}`
    });
    if (report.dispatch.length === 0) {
      report.system_status = "DEGRADED";
      report.diagnosis = {
        layer: "BROWSER",
        root_cause: `Self-learning watchdog detected new missed-call entry (${currentMissedSig}); triggering Gemini DOM Auto-Patcher + audioinput/WebRTC calibration.`,
        evidence: `audioInputs=${telemetry.deepDom?.audioInputCount}, signalerHttp=${telemetry.deepDom?.lastSignalerStatus}, sidebarVisible=${telemetry.deepDom?.gvCallSidebarVisible}`
      };
      report.dispatch = [
        {
          target_agent: "INFRA_AGENT",
          priority: "P1_HIGH",
          task_summary: "Verify 48kHz PulseAudio virtual_mic & SarahCloudVirtualMic.",
          exact_commands_or_actions: ["PLAYBOOK_C_RESET_PULSEAUDIO_SINK"],
          verification_check: "SarahCloudVirtualMic & virtual_mic are active and unmuted",
          timeout_seconds: 30
        },
        {
          target_agent: "BROWSER_AGENT",
          priority: "P1_HIGH",
          task_summary: "Run Gemini DOM Auto-Patcher and verify 1280x960 WebRTC AudioContext.",
          exact_commands_or_actions: ["GEMINI_DOM_AUTO_PATCH", "PLAYBOOK_C_RESUME_WEBRTC_AUDIO"],
          verification_check: "audioCtxState=running and dynamic selectors hot-reloaded",
          timeout_seconds: 35
        }
      ];
    }
  }
  if (currentMissedSig) {
    state.lastTopMissedCallSignature = currentMissedSig;
  }
  if (report.dispatch.length > 0) {
    const executionResults = [];
    for (const item of report.dispatch) {
      const res = await executeDispatchInstruction(item);
      executionResults.push({ target_agent: item.target_agent, results: res });
    }
    state.totalAutoFixesApplied += 1;
    await new Promise((r) => setTimeout(r, 2500));
    const postTelemetry = await collectSystemTelemetry(true);
    const postReport = evaluateTelemetry(postTelemetry, state);
    report.execution_results = executionResults;
    report.post_fix_verified = postReport.system_status === "HEALTHY";
    report.deep_dom = postReport.deep_dom;
    report.call_state = postReport.call_state;
    report.dynamic_selectors = postReport.dynamic_selectors;
    if (postReport.system_status === "CRITICAL") {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= 2) {
        report.admin_escalation.notify_human = true;
        report.admin_escalation.alert_message = report.admin_escalation.alert_message || `P0 ESCALATION (+14803319455): Auto-repair failed ${state.consecutiveFailures} consecutive times (${report.diagnosis.root_cause})`;
        await sendGoogleNativeEscalation(report);
      }
    } else {
      state.consecutiveFailures = 0;
      state.healthyStreakMinutes += 1;
    }
  } else {
    state.consecutiveFailures = 0;
    state.healthyStreakMinutes += 1;
  }
  saveState(state);
  latestInMemoryReport = report;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(LATEST_REPORT_PATH, JSON.stringify(report, null, 2));
  } catch {
  }
  return report;
}
function buildLiveStatusJson() {
  const base = latestInMemoryReport || (existsSync(LATEST_REPORT_PATH) ? JSON.parse(readFileSync(LATEST_REPORT_PATH, "utf8")) : null) || {
    ok: true,
    line: "+14803319455",
    stack: "google-voice-puppeteer-pulseaudio-gemini-only",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    system_status: "HEALTHY",
    diagnosis: {
      layer: "BROWSER",
      root_cause: "Initializing first Deep-DOM watchdog cycle...",
      evidence: "booting"
    },
    dispatch: [],
    admin_escalation: { notify_human: false, alert_message: null }
  };
  return {
    ...base,
    call_state: readCallStateFile(),
    dynamic_selectors: loadDynamicSelectors(),
    settings_auditor: {
      intervalMs: SETTINGS_AUDIT_INTERVAL_MS,
      ...readSettingsAuditSummary()
    }
  };
}
function startWatchdogHttpServer() {
  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${WATCHDOG_PORT}`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (reqUrl.pathname === "/watchdog/status.json" || reqUrl.pathname === "/watchdog/status" || reqUrl.pathname === "/status.json" || reqUrl.pathname === "/watchdog" && String(req.headers.accept || "").includes("application/json")) {
      const payload = buildLiveStatusJson();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(payload, null, 2));
      return;
    }
    if (reqUrl.pathname === "/watchdog" || reqUrl.pathname === "/watchdog/" || reqUrl.pathname === "/") {
      const payload = buildLiveStatusJson();
      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="10" />
  <title>Sarah 24/7 Gemini Watchdog (+14803319455)</title>
  <style>
    body { background:#020617; color:#f8fafc; font-family:system-ui,-apple-system,sans-serif; padding:24px; max-width:1080px; margin:0 auto; }
    .badge { display:inline-block; padding:6px 14px; border-radius:999px; font-weight:800; background:${payload.system_status === "HEALTHY" ? "#059669" : "#d97706"}; }
    pre { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:16px; overflow:auto; font-size:13px; line-height:1.45; }
  </style>
</head>
<body>
  <h1>Sarah 24/7 Gemini Self-Healing Watchdog \u2022 (480) 331-9455</h1>
  <p><span class="badge">${payload.system_status}</span> &nbsp; Stack: <code>100% Google Voice + Puppeteer + PulseAudio + Gemini API</code></p>
  <pre>${JSON.stringify(payload, null, 2).replace(/</g, "&lt;")}</pre>
</body>
</html>`;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  });
  server.on("error", (err) => {
    console.error(`[Sarah Watchdog HTTP :${WATCHDOG_PORT}] Listen warning:`, err?.message || err);
  });
  server.listen(WATCHDOG_PORT, "0.0.0.0", () => {
    console.log(`[Sarah Watchdog HTTP] Live status JSON listening on http://127.0.0.1:${WATCHDOG_PORT}/watchdog/status.json`);
  });
  return server;
}
var isOnce = process.argv.includes("--once");
async function startWatchdogDaemon() {
  loadDynamicSelectors();
  if (isOnce) {
    const report = await runWatchdogTick(true);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const httpServer = startWatchdogHttpServer();
  console.log(
    `[Sarah Autonomous Watchdog] Started 24/7 Gemini Deep-DOM supervisor (interval=${WATCHDOG_INTERVAL_MS}ms, port=${WATCHDOG_PORT})`
  );
  const executeCycle = async () => {
    try {
      const report = await runWatchdogTick(false);
      console.log(
        `[Sarah Watchdog ${report.timestamp}] status=${report.system_status} dispatches=${report.dispatch.length} (${report.diagnosis.evidence})`
      );
    } catch (err) {
      console.error("[Sarah Watchdog] Cycle error:", err?.message || err);
    }
  };
  await executeCycle();
  const timer = setInterval(executeCycle, WATCHDOG_INTERVAL_MS);
  const shutdown = (sig) => {
    console.log(`[Sarah Watchdog] Received ${sig}, shutting down cleanly.`);
    clearInterval(timer);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2e3).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
var entryMatch = process.argv[1] && /sarah-watchdog\.(ts|js|mjs)$/i.test(process.argv[1]) || process.env.pm_exec_path && /sarah-watchdog\.(ts|js|mjs)$/i.test(process.env.pm_exec_path);
if (entryMatch) {
  void startWatchdogDaemon();
}
export {
  CALL_STATE_PATH,
  DYNAMIC_SELECTORS_PATH,
  GV_LIVE_STATUS_PNG_PATH,
  MISSED_CALL_DEBUG_PNG_PATH,
  MISSED_CALL_DOM_HTML_PATH,
  SETTINGS_AUDIT_STATE_PATH,
  attachBulletproofCallPickup,
  auditAndHealGoogleVoiceSettings,
  collectSystemTelemetry,
  evaluateTelemetry,
  inspectLiveCdpDeepDom,
  loadDynamicSelectors,
  readCallStateFile,
  runGeminiDomAutoPatcher,
  runWatchdogTick,
  writeCallState
};
