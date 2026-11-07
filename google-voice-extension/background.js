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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'IWG_SARAH_API') {
    callSarahApi(msg.endpoint, msg.payload)
      .then((data) => sendResponse({ ok: Boolean(data), data }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'API error' }));
    return true;
  }

  if (msg.type === 'IWG_GV_CALL_ANSWERED') {
    // Notify backend & any open CRM tabs
    callSarahApi('/api/sarah/inbound', {
      from: msg.callerPhone || '',
      caller_name: msg.callerName || '',
      notes: 'Auto-answered immediately in Google Voice (480) 331-9455 by IWG Receptionist Extension',
    }).catch(() => {});

    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id && tab.url && (tab.url.includes('iwillglobal.com') || tab.url.includes('localhost'))) {
          chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
        }
      }
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'IWG_CRM_DIAL_NUMBER') {
    chrome.tabs.query({ url: 'https://voice.google.com/*' }, (tabs) => {
      if (tabs && tabs.length > 0 && tabs[0].id) {
        chrome.tabs.update(tabs[0].id, { active: true }).catch(() => {});
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'IWG_GV_DIAL_NOW',
          phone: msg.phone,
          mode: msg.mode || 'outbound',
          prospectName: msg.prospectName || '',
        }).catch(() => {});
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

