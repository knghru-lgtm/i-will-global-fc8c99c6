const EXTENSION_BUILD = '2026-11-09-v8';
const API_BASES = ['http://localhost:4000', 'https://iwillglobal.com'];
let hasAutoOpenedGvTab = false;
const tabReloadTimestamps = new Map();

async function callSarahApi(endpoint, payload) {
  for (const base of API_BASES) {
    try {
      const res = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // try next base
    }
  }
  return null;
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
                active: false,
                pinned: true,
              },
              () => {
                void chrome.runtime.lastError;
              }
            );
          } catch {}
        }
        return;
      }

      for (const tab of tabs) {
        if (!tab.id) continue;
        try {
          chrome.tabs.update(tab.id, { autoDiscardable: false, muted: false }, () => {
            void chrome.runtime.lastError;
          });
        } catch {}

        // Verify content.js is alive and on the latest EXTENSION_BUILD
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
          } catch {}
        }
      }
    });
  } catch {}
}

ensureGoogleVoiceTabsHealthy();
setInterval(ensureGoogleVoiceTabsHealthy, 5000);

chrome.runtime.onInstalled.addListener(() => {
  ensureGoogleVoiceTabsHealthy();
});

chrome.runtime.onStartup.addListener(() => {
  ensureGoogleVoiceTabsHealthy();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'IWG_SARAH_API') {
    callSarahApi(msg.endpoint, msg.payload)
      .then((data) => sendResponse({ ok: Boolean(data), data }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'API error' }));
    return true;
  }

  if (msg.type === 'IWG_RELOAD_EXTENSION') {
    sendResponse({ ok: true });
    setTimeout(() => {
      try {
        chrome.runtime.reload();
      } catch {}
    }, 100);
    return false;
  }

  if (msg.type === 'IWG_GV_CALL_ANSWERED') {
    callSarahApi('/api/sarah/inbound', {
      from: msg.callerPhone || '',
      caller_name: msg.callerName || '',
      internal_only: true,
      notes: 'Picked up internally by IWG Cloned App Receptionist on (480) 331-9455',
    }).catch(() => {});
    sendResponse({ ok: true, internal_only: true });
    return false;
  }

  return false;
});
