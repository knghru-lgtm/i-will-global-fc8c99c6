(function () {
  if (window.__IWG_GV_RECEPTIONIST_ACTIVE__) return;
  window.__IWG_GV_RECEPTIONIST_ACTIVE__ = true;

  let autoAnswerEnabled = true;
  let callActive = false;
  let isSpeaking = false;
  let turnInFlight = false;
  let lastAnswerClickTs = 0;
  let lastAutoDialTs = 0;
  let callHistory = [];
  let sessionContext = {
    mode: 'inbound',
    lead_id: '',
    prospect_name: '',
    prospect_phone: '',
    address: '',
    state: 'AZ',
  };
  let recognition = null;
  let recRunning = false;

  function queryAllDeep(root = document) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      const els = node.querySelectorAll ? node.querySelectorAll('button, [role="button"], input, [aria-label]') : [];
      for (const el of els) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
  }

  function clickElement(el) {
    if (!el) return;
    try {
      el.focus?.();
      [' pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((evtName) => {
        el.dispatchEvent(
          new MouseEvent(evtName.trim(), {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
      });
      el.click?.();
    } catch {}
  }

  function updateStatusBanner(text, color = '#10b981') {
    let badge = document.getElementById('iwg-gv-receptionist-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'iwg-gv-receptionist-badge';
      badge.style.cssText =
        'position:fixed;bottom:14px;left:14px;z-index:2147483647;background:rgba(15,23,42,0.95);border:2px solid #10b981;border-radius:12px;padding:8px 14px;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;font-size:12px;font-weight:700;box-shadow:0 8px 25px rgba(0,0,0,0.45);display:flex;align-items:center;gap:8px;';
      document.body.appendChild(badge);
    }
    badge.style.borderColor = color;
    badge.innerHTML = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color};"></span><span>${text}</span>`;
  }

  function callSarahBackend(endpoint, payload) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'IWG_SARAH_API', endpoint, payload }, (res) => {
          resolve(res?.data || null);
        });
      } else {
        fetch(`https://iwillglobal.com${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
        })
          .then((r) => r.json())
          .then(resolve)
          .catch(() =>
            fetch(`http://localhost:4000${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload || {}),
            })
              .then((r) => r.json())
              .then(resolve)
              .catch(() => resolve(null))
          );
      }
    });
  }

  function speakOutLoud(text, onDone) {
    if (!text || !('speechSynthesis' in window)) {
      isSpeaking = false;
      onDone?.();
      return;
    }
    isSpeaking = true;
    if (recognition && recRunning) {
      try {
        recognition.stop();
        recRunning = false;
      } catch {}
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => /natural|aria|jenny|ana|ava|samantha|google us english/i.test(v.name) && /en/i.test(v.lang)) ||
        voices.find((v) => /en-US/i.test(v.lang)) ||
        voices[0];
      if (preferred) utter.voice = preferred;
      utter.rate = 0.97;
      utter.pitch = 0.99;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        isSpeaking = false;
        startListening();
        onDone?.();
      };
      const watchdog = setTimeout(finish, Math.min(14000, Math.max(3500, text.length * 65)));
      utter.onend = () => {
        clearTimeout(watchdog);
        finish();
      };
      utter.onerror = () => {
        clearTimeout(watchdog);
        finish();
      };
      window.speechSynthesis.speak(utter);
    } catch {
      isSpeaking = false;
      startListening();
      onDone?.();
    }
  }

  function startListening() {
    if (!callActive || isSpeaking || recRunning) return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;
    if (!recognition) {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onstart = () => {
        recRunning = true;
      };
      rec.onresult = async (ev) => {
        if (isSpeaking || turnInFlight) return;
        let finalTranscript = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) {
            finalTranscript += ' ' + (ev.results[i][0]?.transcript || '');
          }
        }
        const clean = finalTranscript.trim();
        if (!clean || clean.length < 2) return;

        turnInFlight = true;
        updateStatusBanner(`🎧 Caller: "${clean.slice(0, 42)}..." — Receptionist Replying`, '#38bdf8');
        callHistory.push({ speaker: 'user', text: clean });

        const res = await callSarahBackend('/api/sarah/turn', {
          message: clean,
          skip_inline_tts: true,
          history: callHistory.slice(-12),
          context: sessionContext,
        });
        turnInFlight = false;

        if (res?.lead_id) sessionContext.lead_id = res.lead_id;
        if (res?.prospect_name) sessionContext.prospect_name = res.prospect_name;
        if (res?.prospect_phone) sessionContext.prospect_phone = res.prospect_phone;
        if (res?.prospect_address) sessionContext.address = res.prospect_address;

        const reply =
          res?.reply ||
          'I would be happy to help you schedule an appointment with Principal Broker King Amen Ra. May I get your full name, phone number, and street address?';
        callHistory.push({ speaker: 'sarah', text: reply });
        updateStatusBanner(`🎙️ Receptionist Speaking on (480) 331-9455`, '#10b981');
        speakOutLoud(reply, () => {
          if (res?.transfer?.success && res?.transfer?.recipient_phone) {
            const cleanDigits = String(res.transfer.recipient_phone).replace(/\D/g, '');
            const e164 = cleanDigits.length === 10 ? `+1${cleanDigits}` : `+${cleanDigits}`;
            window.open(`https://voice.google.com/u/0/calls?a=nc,${encodeURIComponent(e164)}`, '_blank');
          }
        });
      };
      rec.onend = () => {
        recRunning = false;
        if (callActive && !isSpeaking && !turnInFlight) {
          setTimeout(() => {
            if (callActive && !isSpeaking && !recRunning) {
              try {
                rec.start();
                recRunning = true;
              } catch {}
            }
          }, 200);
        }
      };
      rec.onerror = () => {
        recRunning = false;
      };
      recognition = rec;
    }
    try {
      recognition.start();
      recRunning = true;
    } catch {}
  }

  function extractCallerInfoFromDom() {
    const bodyText = document.body?.innerText || '';
    const matches = bodyText.match(/(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g) || [];
    let phone = '';
    for (const m of matches) {
      const digits = m.replace(/\D/g, '').slice(-10);
      if (digits && digits !== '4803319455') {
        phone = m.trim();
        break;
      }
    }
    return { phone, name: '' };
  }

  function onIncomingCallAnswered() {
    if (callActive) return;
    callActive = true;
    callHistory = [];
    const info = extractCallerInfoFromDom();
    sessionContext = {
      mode: 'inbound',
      lead_id: '',
      prospect_name: info.name || '',
      prospect_phone: info.phone || '',
      address: '',
      state: 'AZ',
    };

    const greeting =
      'Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is your Receptionist speaking. How may I direct your call today?';
    callHistory.push({ speaker: 'sarah', text: greeting });

    updateStatusBanner('🟢 Call Answered Immediately on (480) 331-9455 — Receptionist Speaking', '#10b981');

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'IWG_GV_CALL_ANSWERED',
        callerPhone: info.phone,
        callerName: info.name,
      });
    } else {
      callSarahBackend('/api/sarah/inbound', {
        from: info.phone,
        caller_name: info.name,
      });
    }

    setTimeout(() => {
      speakOutLoud(greeting);
    }, 350);
  }

  function scanGoogleVoiceDom() {
    if (!autoAnswerEnabled) return;
    const now = Date.now();
    const elements = queryAllDeep(document);

    // 1. Check for Incoming Call "Answer" button in Google Voice
    for (const el of elements) {
      if (el.disabled) continue;
      const aria = String(el.getAttribute?.('aria-label') || '').trim();
      const testId = String(el.getAttribute?.('gv-test-id') || el.getAttribute?.('data-e2e') || '').trim();
      const txt = String(el.textContent || '').trim();

      const isAnswerBtn =
        /^(answer|answer call|accept|accept call)$/i.test(aria) ||
        /^(answer|answer call|accept)$/i.test(txt) ||
        /answer.*call|incoming.*answer/i.test(aria) ||
        /answer/i.test(testId);

      const isDeclineOrEnd = /decline|reject|ignore|hang\s*up|end\s*call|dismiss/i.test(aria + ' ' + txt + ' ' + testId);

      if (isAnswerBtn && !isDeclineOrEnd && now - lastAnswerClickTs > 2500) {
        lastAnswerClickTs = now;
        clickElement(el);
        onIncomingCallAnswered();
        return;
      }
    }

    // 2. Check if URL has ?a=nc,<number> outbound call request and auto-click Call button
    if (window.location.search.includes('a=nc,') && now - lastAutoDialTs > 5000) {
      for (const el of elements) {
        if (el.disabled) continue;
        const aria = String(el.getAttribute?.('aria-label') || '').trim();
        if (/^call(\s+\+?[\d\s()-]+)?$/i.test(aria)) {
          lastAutoDialTs = now;
          clickElement(el);
          break;
        }
      }
    }

    // 3. Detect if an active call has ended
    if (callActive && now - lastAnswerClickTs > 5000) {
      const hasHangupBtn = elements.some((el) => {
        const aria = String(el.getAttribute?.('aria-label') || '').trim();
        return /end\s*call|hang\s*up|disconnect/i.test(aria);
      });
      if (!hasHangupBtn) {
        callActive = false;
        if (recognition && recRunning) {
          try {
            recognition.stop();
          } catch {}
          recRunning = false;
        }
        updateStatusBanner('🟢 IWG Receptionist Auto-Answer ON • (480) 331-9455', '#10b981');
      }
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'IWG_GV_DIAL_NOW' && msg.phone) {
        const cleanDigits = String(msg.phone).replace(/\D/g, '');
        const e164 = cleanDigits.length === 10 ? `+1${cleanDigits}` : `+${cleanDigits}`;
        window.location.href = `https://voice.google.com/u/0/calls?a=nc,${encodeURIComponent(e164)}`;
      }
    });
  }

  updateStatusBanner('🟢 IWG Receptionist Auto-Answer ON • (480) 331-9455', '#10b981');
  setInterval(scanGoogleVoiceDom, 150);

  const observer = new MutationObserver(() => {
    scanGoogleVoiceDom();
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
