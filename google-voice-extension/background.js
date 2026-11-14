const EXTENSION_BUILD = '2026-11-14-v13';
// Cloud-first pointing strictly to Google Cloud VM (https://voice.iwillglobal.com) + IPv4 local fallback
const API_BASES = ['https://voice.iwillglobal.com', 'http://127.0.0.1:4000'];
const BRIDGE_TOKEN = 'iwg-sarah-cloud-bridge-v10-9455';
let hasAutoOpenedGvTab = false;
let lastCookieSyncTs = 0;
let cookieChangeDebounceTimer = null;
const tabReloadTimestamps = new Map();

async function callSarahApi(endpoint, payload, extraHeaders = {}) {
  for (const base of API_BASES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify(payload || {}),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // try next base
    }
  }
  return null;
}

function syncGoogleVoiceCookiesToCloud(force = false) {
  const now = Date.now();
  if (!force && now - lastCookieSyncTs < 4 * 60 * 1000) return;
  if (!chrome.cookies || typeof chrome.cookies.getAll !== 'function') return;

  try {
    chrome.cookies.getAll({}, async (allCookies) => {
      void chrome.runtime.lastError;
      if (!Array.isArray(allCookies) || allCookies.length === 0) return;
      const googleCookies = allCookies.filter((c) => {
        const d = String(c.domain || '').toLowerCase();
        return d.endsWith('google.com') || d === 'google.com';
      });
      const hasAuth = googleCookies.some((c) =>
        ['SID', '__Secure-1PSID', '__Secure-3PSID'].includes(String(c.name))
      );
      if (!hasAuth) return;

      lastCookieSyncTs = now;
      for (const base of API_BASES) {
        try {
          const res = await fetch(`${base}/api/sarah/gv-session-sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-iwg-bridge-token': BRIDGE_TOKEN,
            },
            body: JSON.stringify({
              cookies: googleCookies,
              source: `chrome-extension-${EXTENSION_BUILD}`,
            }),
          });
          if (res.ok) {
            console.log(`[IWG Cloud Cookie Sync] Synced ${googleCookies.length} Google Voice cookies -> ${base}`);
          }
        } catch { }
      }
    });
  } catch { }
}

// Auto-push rotated Google auth cookies (__Secure-1PSIDTS, SID, etc.) within 15s of rotation
if (chrome.cookies && chrome.cookies.onChanged) {
  chrome.cookies.onChanged.addListener((changeInfo) => {
    if (changeInfo?.removed) return;
    const c = changeInfo?.cookie;
    if (!c) return;
    const dom = String(c.domain || '').toLowerCase();
    if (!dom.endsWith('google.com')) return;
    if (!['SID', '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PSIDTS', '__Secure-3PSIDTS'].includes(String(c.name))) {
      return;
    }
    if (cookieChangeDebounceTimer) clearTimeout(cookieChangeDebounceTimer);
    cookieChangeDebounceTimer = setTimeout(() => {
      cookieChangeDebounceTimer = null;
      syncGoogleVoiceCookiesToCloud(true);
    }, 15000);
  });
}

function ensureGoogleVoiceTabsHealthy() {
  try {
    chrome.tabs.query({ url: 'https://voice.google.com/*' }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        if (!hasAutoOpenedGvTab) {
          hasAutoOpenedGvTab = true;
          try {
            chrome.tabs.create(
              {
                url: 'https://voice.google.com/u/0/calls',
                active: true,
                pinned: true,
              },
              (newTab) => {
                void chrome.runtime.lastError;
                if (newTab?.id) {
                  chrome.tabs.update(newTab.id, { autoDiscardable: false, muted: true }, () => {
                    void chrome.runtime.lastError;
                  });
                }
              }
            );
          } catch { }
        }
        return;
      }

      for (const tab of tabs) {
        if (!tab.id) continue;
        try {
          chrome.tabs.update(tab.id, { autoDiscardable: false, muted: true }, () => {
            void chrome.runtime.lastError;
          });
        } catch { }

        if (tab.status === 'complete') {
          try {
            chrome.tabs.sendMessage(tab.id, { type: 'IWG_GV_PING' }, (res) => {
              const err = chrome.runtime.lastError;
              if (err || !res || !res.alive || res.build !== EXTENSION_BUILD) {
                const lastReload = tabReloadTimestamps.get(tab.id) || 0;
                if (Date.now() - lastReload > 15000) {
                  tabReloadTimestamps.set(tab.id, Date.now());
                  chrome.tabs.reload(tab.id, {}, () => {
                    void chrome.runtime.lastError;
                  });
                }
              }
            });
          } catch { }
        }
      }
    });
  } catch { }
}

ensureGoogleVoiceTabsHealthy();
syncGoogleVoiceCookiesToCloud(true);
setInterval(ensureGoogleVoiceTabsHealthy, 3000);
setInterval(() => syncGoogleVoiceCookiesToCloud(false), 60000);

chrome.runtime.onInstalled.addListener(() => {
  ensureGoogleVoiceTabsHealthy();
  syncGoogleVoiceCookiesToCloud(true);
});

chrome.runtime.onStartup.addListener(() => {
  ensureGoogleVoiceTabsHealthy();
  syncGoogleVoiceCookiesToCloud(true);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'IWG_SARAH_API') {
    callSarahApi(msg.endpoint, msg.payload)
      .then((data) => sendResponse({ ok: Boolean(data), data }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'API error' }));
    return true;
  }

  if (msg.type === 'IWG_SYNC_COOKIES_NOW') {
    syncGoogleVoiceCookiesToCloud(true);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'IWG_RELOAD_EXTENSION') {
    sendResponse({ ok: true });
    setTimeout(() => {
      try {
        chrome.runtime.reload();
      } catch { }
    }, 100);
    return false;
  }

  if (msg.type === 'IWG_GV_CALL_ANSWERED') {
    callSarahApi('/api/sarah/inbound', {
      from: msg.callerPhone || '',
      caller_name: msg.callerName || '',
      internal_only: true,
      notes: 'Picked up internally by IWG Cloud Receptionist on (480) 331-9455',
    }).catch(() => { });
    sendResponse({ ok: true, internal_only: true });
    return false;
  }

  return false;
});
