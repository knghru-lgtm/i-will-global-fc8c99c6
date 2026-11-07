(function () {
  try {
    document.documentElement.setAttribute('data-iwg-gv-extension', 'active');
    window.postMessage({ type: 'IWG_GV_EXTENSION_READY', version: '2.0.0' }, '*');
  } catch {}

  window.addEventListener('message', (ev) => {
    if (!ev.data || typeof ev.data !== 'object') return;
    if (ev.data.type === 'IWG_CRM_DIAL_REQUEST') {
      chrome.runtime.sendMessage({
        type: 'IWG_CRM_DIAL_NUMBER',
        phone: ev.data.phone,
        mode: ev.data.mode || 'outbound',
        prospectName: ev.data.prospectName || '',
      });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'IWG_GV_CALL_ANSWERED') {
      window.postMessage(msg, '*');
    }
  });
})();
