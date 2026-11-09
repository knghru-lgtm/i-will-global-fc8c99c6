const EXTENSION_BUILD = '2026-11-09-v7';
const API_BASES = ['http://localhost:4000', 'https://iwillglobal.com'];

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
      if (!tabs || tabs.length === 0) return;
      for (const tab of tabs) {
        if (!tab.id) continue;
        try {
          chrome.tabs.update(tab.id, { autoDiscardable: false }, () => {
            void chrome.runtime.lastError;
          });
        } catch {}
      }
    });
  } catch {}
}

ensureGoogleVoiceTabsHealthy();
setInterval(ensureGoogleVoiceTabsHealthy, 30000);

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
    // Route internally to the cloned Sarah app backend ONLY — never trigger external tabs or cell phone speaker
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
