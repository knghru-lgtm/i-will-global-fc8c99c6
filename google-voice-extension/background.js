const EXTENSION_BUILD = '2026-11-08-v6';
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

// Ensure every open Google Voice tab is un-muted, non-discardable, and has the active content.js injected
function ensureGoogleVoiceTabsHealthy() {
  try {
    chrome.tabs.query({ url: 'https://voice.google.com/*' }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      for (const tab of tabs) {
        if (!tab.id) continue;
        // Prevent Chrome Memory Saver from EVER freezing/discarding or muting Google Voice
        try {
          chrome.tabs.update(tab.id, { autoDiscardable: false, muted: false }, () => {
            void chrome.runtime.lastError;
          });
        } catch {}

        // Ping content.js inside the tab; if it was opened before the extension loaded/reloaded, reload the tab so content.js injects!
        try {
          chrome.tabs.sendMessage(tab.id, { type: 'IWG_GV_PING' }, (res) => {
            const err = chrome.runtime.lastError;
            if (err || !res || !res.alive || res.build !== EXTENSION_BUILD) {
              chrome.tabs.reload(tab.id, {}, () => {
                void chrome.runtime.lastError;
              });
            }
          });
        } catch {}
      }
    });
  } catch {}
}

// Run immediately on service worker startup and every 5 seconds
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
      notes: 'Auto-answered immediately in Google Voice (480) 331-9455 by IWG Receptionist Extension',
    }).catch(() => {});

    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id && tab.url && (tab.url.includes('iwillglobal.com') || tab.url.includes('localhost'))) {
          chrome.tabs.sendMessage(tab.id, msg, () => {
            void chrome.runtime.lastError;
          });
        }
      }
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'IWG_CRM_DIAL_NUMBER') {
    chrome.tabs.query({ url: 'https://voice.google.com/*' }, (tabs) => {
      if (tabs && tabs.length > 0 && tabs[0].id) {
        chrome.tabs.update(tabs[0].id, { active: true, autoDiscardable: false, muted: false }, () => {
          void chrome.runtime.lastError;
        });
        chrome.tabs.sendMessage(
          tabs[0].id,
          {
            type: 'IWG_GV_DIAL_NOW',
            phone: msg.phone,
            mode: msg.mode || 'outbound',
            prospectName: msg.prospectName || '',
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
        sendResponse({ ok: true, reusedTab: true });
      } else {
        const cleanDigits = String(msg.phone || '').replace(/\D/g, '');
        const e164 = cleanDigits.length === 10 ? `+1${cleanDigits}` : `+${cleanDigits}`;
        chrome.tabs.create({
          url: `https://voice.google.com/u/0/calls?a=nc,${encodeURIComponent(e164)}`,
          active: true,
        });
        sendResponse({ ok: true, reusedTab: false });
      }
    });
    return true;
  }

  return false;
});
