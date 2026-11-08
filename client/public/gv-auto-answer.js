(function () {
  if (typeof window.__IWG_GV_RECEPTIONIST_CLEANUP__ === 'function') {
    try {
      window.__IWG_GV_RECEPTIONIST_CLEANUP__();
    } catch {}
  }
  window.__IWG_GV_RECEPTIONIST_ACTIVE__ = true;

  const OPENING_GREETING =
    'Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?';

  let autoAnswerEnabled = true;
  let callActive = false;
  let isSpeaking = false;
  let turnInFlight = false;
  let lastAnswerClickTs = 0;
  let lastCallStartTs = 0;
  let lastAutoDialTs = 0;
  let callHistory = [];
  let activeAudio = null;
  let preloadedGreeting = null;
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

  // Web Audio mixer so Sarah's Vindemiatrix voice is injected directly into Google Voice's WebRTC call stream AND speakers!
  let sarahAudioCtx = null;
  let sarahStreamDest = null;
  const activePeerConnections = new Set();

  function ensureAudioMixer() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!sarahAudioCtx || sarahAudioCtx.state === 'closed') {
        sarahAudioCtx = new AudioCtx();
        sarahStreamDest = sarahAudioCtx.createMediaStreamDestination();
        // Keep-alive silent oscillator so Chrome NEVER throttles this Google Voice tab in the background
        const osc = sarahAudioCtx.createOscillator();
        const silentGain = sarahAudioCtx.createGain();
        silentGain.gain.value = 0.00001;
        osc.connect(silentGain);
        silentGain.connect(sarahAudioCtx.destination);
        osc.start();
      }
      if (sarahAudioCtx.state === 'suspended') {
        sarahAudioCtx.resume().catch(() => {});
      }
      return sarahAudioCtx;
    } catch {
      return null;
    }
  }

  // Hook RTCPeerConnection & getUserMedia so Sarah's voice feeds directly into the Google Voice phone line
  try {
    if (window.RTCPeerConnection && !window.__IWG_RTC_HOOKED__) {
      window.__IWG_RTC_HOOKED__ = true;
      const OrigPeerConnection = window.RTCPeerConnection;
      window.RTCPeerConnection = function (...args) {
        const pc = new OrigPeerConnection(...args);
        activePeerConnections.add(pc);
        pc.addEventListener('connectionstatechange', () => {
          if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
            activePeerConnections.delete(pc);
          }
        });
        return pc;
      };
      window.RTCPeerConnection.prototype = OrigPeerConnection.prototype;
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && !window.__IWG_GUM_HOOKED__) {
      window.__IWG_GUM_HOOKED__ = true;
      const origGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async function (constraints) {
        const stream = await origGum(constraints);
        if (constraints && constraints.audio && stream.getAudioTracks().length > 0) {
          try {
            const ctx = ensureAudioMixer();
            if (ctx && sarahStreamDest) {
              const micSource = ctx.createMediaStreamSource(stream);
              micSource.connect(sarahStreamDest);
              const mixedStream = new MediaStream();
              sarahStreamDest.stream.getAudioTracks().forEach((t) => mixedStream.addTrack(t));
              stream.getVideoTracks().forEach((t) => mixedStream.addTrack(t));
              return mixedStream;
            }
          } catch {}
        }
        return stream;
      };
    }
  } catch {}

  function queryAllDeep(root = document) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      const els = node.querySelectorAll
        ? node.querySelectorAll('button, [role="button"], a[role="button"], input, [aria-label], [gv-test-id], [mattooltip]')
        : [];
      for (const el of els) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
  }

  // Strict visibility check: NEVER click hidden pre-rendered buttons in Google Voice's DOM!
  function isElementVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    if (el.disabled || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden')) return false;
    if (el.closest && el.closest('[aria-hidden="true"], [hidden], #iwg-gv-receptionist-badge')) return false;
    try {
      const style = window.getComputedStyle(el);
      if (
        !style ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.pointerEvents === 'none' ||
        parseFloat(style.opacity || '1') < 0.05
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 14 || rect.height < 14) return false;
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function clickElement(el) {
    if (!el) return;
    try {
      ensureAudioMixer();
      el.focus?.();
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((evtName) => {
        el.dispatchEvent(
          new MouseEvent(evtName, {
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
    if (typeof document === 'undefined' || !document.body) return;
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

  // Pre-fetch Sarah's natural Vindemiatrix neural voice for the opening greeting so it plays in 0ms on answer!
  async function preloadSarahNaturalGreeting() {
    try {
      const turn = await callSarahBackend('/api/sarah/turn', {
        is_initial: true,
        context: { mode: 'inbound' },
      });
      if (turn && turn.audio_base64) {
        let restAudio = null;
        if (turn.rest_text) {
          const r2 = await callSarahBackend('/api/sarah/tts', { text: turn.rest_text });
          restAudio = r2?.audio_base64 || null;
        }
        preloadedGreeting = {
          audio_base64: turn.audio_base64,
          audio_mime: turn.audio_mime || 'audio/wav',
          rest_audio_base64: restAudio,
        };
      }
    } catch {}
  }
  preloadSarahNaturalGreeting();

  function base64ToArrayBuffer(base64) {
    const binary = window.atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function playSingleWavBase64(base64, mime = 'audio/wav', maxMs = 15000) {
    return new Promise((resolve) => {
      if (!base64) return resolve(false);
      try {
        if (activeAudio) {
          try {
            activeAudio.pause();
          } catch {}
          activeAudio = null;
        }

        // Also feed decoded audio into sarahStreamDest so the WebRTC phone line hears Sarah directly!
        const ctx = ensureAudioMixer();
        if (ctx && sarahStreamDest) {
          try {
            const bufCopy = base64ToArrayBuffer(base64);
            ctx.decodeAudioData(
              bufCopy,
              (audioBuffer) => {
                try {
                  const src = ctx.createBufferSource();
                  src.buffer = audioBuffer;
                  src.connect(sarahStreamDest);
                  src.start(0);
                } catch {}
              },
              () => {}
            );
          } catch {}
        }

        const audio = new Audio(`data:${mime};base64,${base64}`);
        activeAudio = audio;
        let settled = false;
        const done = (ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (activeAudio === audio) activeAudio = null;
          resolve(ok);
        };
        const timer = setTimeout(() => done(true), maxMs);
        audio.onended = () => done(true);
        audio.onerror = () => done(false);
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => done(false));
        }
      } catch {
        resolve(false);
      }
    });
  }

  function speakEmergencyFemaleFallback(text, onDone) {
    if (!text || !('speechSynthesis' in window)) {
      isSpeaking = false;
      setTimeout(startListening, 350);
      onDone?.();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const nonMaleVoices = voices.filter(
        (v) => /en/i.test(v.lang) && !/\b(david|mark|guy|james|richard|george|daniel|christopher|eric|roger|steffan|ryan|male)\b/i.test(v.name)
      );
      const femaleVoice =
        nonMaleVoices.find((v) => /natural|aria|jenny|ana|ava|samantha|sonia|michelle|google us english/i.test(v.name)) ||
        nonMaleVoices.find((v) => /zira|victoria|karen|moira|tessa|female/i.test(v.name)) ||
        nonMaleVoices[0] ||
        voices[0];
      if (femaleVoice) utter.voice = femaleVoice;
      utter.rate = 0.96;
      utter.pitch = 1.02;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        isSpeaking = false;
        setTimeout(startListening, 350);
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
      setTimeout(startListening, 350);
      onDone?.();
    }
  }

  async function speakSarahNaturalVoice(text, audioBase64, audioMime, restText, preloadedRestBase64, onDone) {
    isSpeaking = true;
    if (recognition && recRunning) {
      try {
        recognition.stop();
        recRunning = false;
      } catch {}
    }

    let primaryBase64 = audioBase64;
    let primaryMime = audioMime || 'audio/wav';
    if (!primaryBase64 && text) {
      const ttsRes = await callSarahBackend('/api/sarah/tts', { text });
      if (ttsRes?.audio_base64) {
        primaryBase64 = ttsRes.audio_base64;
        primaryMime = ttsRes.audio_mime || 'audio/wav';
      }
    }

    if (primaryBase64) {
      const restPromise =
        preloadedRestBase64
          ? Promise.resolve({ audio_base64: preloadedRestBase64, audio_mime: 'audio/wav' })
          : restText
          ? callSarahBackend('/api/sarah/tts', { text: restText })
          : Promise.resolve(null);

      const ok1 = await playSingleWavBase64(primaryBase64, primaryMime);
      if (ok1) {
        const restTts = await restPromise;
        if (restTts?.audio_base64) {
          await playSingleWavBase64(restTts.audio_base64, restTts.audio_mime || 'audio/wav');
        }
        isSpeaking = false;
        setTimeout(startListening, 350);
        onDone?.();
        return;
      }
    }

    speakEmergencyFemaleFallback(text, onDone);
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
        // Ignore echo if speaker output leaked into mic
        if (/thank you for calling iwg|100% free fiduciary|this is sarah speaking|how may i direct your call/i.test(clean)) {
          return;
        }

        turnInFlight = true;
        updateStatusBanner(`🎧 Caller: "${clean.slice(0, 42)}..." — Sarah Replying`, '#38bdf8');
        callHistory.push({ speaker: 'user', text: clean });

        const res = await callSarahBackend('/api/sarah/turn', {
          message: clean,
          skip_inline_tts: false,
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
        updateStatusBanner(`🎙️ Sarah Speaking (Vindemiatrix Natural Voice) • (480) 331-9455`, '#10b981');
        await speakSarahNaturalVoice(
          reply,
          res?.audio_base64 || null,
          res?.audio_mime || 'audio/wav',
          res?.rest_text || '',
          null,
          () => {
            if (res?.transfer?.success && res?.transfer?.recipient_phone) {
              const cleanDigits = String(res.transfer.recipient_phone).replace(/\D/g, '');
              const e164 = cleanDigits.length === 10 ? `+1${cleanDigits}` : `+${cleanDigits}`;
              window.open(`https://voice.google.com/u/0/calls?a=nc,${encodeURIComponent(e164)}`, '_blank');
            }
          }
        );
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

  function extractActiveCallerPhone() {
    // Look only inside the active incoming/ongoing call container on the right-hand call panel
    const callContainers = document.querySelectorAll(
      '[class*="incoming" i], [class*="active-call" i], [class*="call-panel" i], gv-call-sidebar, [aria-label*="Incoming call" i], [aria-label*="Call with" i]'
    );
    for (const c of callContainers) {
      if (!isElementVisible(c)) continue;
      const txt = c.innerText || '';
      const matches = txt.match(/(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g) || [];
      for (const m of matches) {
        const digits = m.replace(/\D/g, '').slice(-10);
        if (digits && digits !== '4803319455') {
          return m.trim();
        }
      }
    }
    return '';
  }

  function onIncomingCallAnswered() {
    callActive = true;
    lastCallStartTs = Date.now();
    callHistory = [];
    const callerPhone = extractActiveCallerPhone();
    sessionContext = {
      mode: 'inbound',
      lead_id: '',
      prospect_name: '',
      prospect_phone: callerPhone || '',
      address: '',
      state: 'AZ',
    };

    callHistory.push({ speaker: 'sarah', text: OPENING_GREETING });

    updateStatusBanner('🟢 Call Answered on 1st Ring (480) 331-9455 — Sarah Speaking', '#10b981');

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'IWG_GV_CALL_ANSWERED',
        callerPhone: callerPhone,
        callerName: '',
      });
    } else if (callerPhone) {
      callSarahBackend('/api/sarah/inbound', {
        from: callerPhone,
        caller_name: '',
      });
    }

    setTimeout(() => {
      speakSarahNaturalVoice(
        OPENING_GREETING,
        preloadedGreeting?.audio_base64 || null,
        preloadedGreeting?.audio_mime || 'audio/wav',
        '',
        preloadedGreeting?.rest_audio_base64 || null
      );
    }, 250);
  }

  function findVisibleAnswerButtons(elements) {
    const matched = [];
    for (const el of elements) {
      if (!isElementVisible(el)) continue;
      const aria = String(el.getAttribute?.('aria-label') || '').trim();
      const title = String(el.getAttribute?.('title') || el.getAttribute?.('mattooltip') || el.getAttribute?.('data-tooltip') || '').trim();
      const testId = String(el.getAttribute?.('gv-test-id') || el.getAttribute?.('data-e2e') || '').trim();
      const txt = String(el.textContent || '').trim();
      const combined = `${aria} ${title} ${testId}`;

      const isDeclineOrEnd =
        /decline|reject|ignore|hang\s*up|end\s*call|leave\s*call|dismiss|voicemail|settings|auto-answer|keypad|mute|hold|transfer/i.test(
          `${combined} ${txt}`
        );
      if (isDeclineOrEnd) continue;

      const isAnswerBtn =
        /\b(answer|answer call|accept|accept call)\b/i.test(aria) ||
        /\b(answer|answer call|accept|accept call)\b/i.test(title) ||
        /^(answer|answer call|accept|accept call)$/i.test(txt) ||
        /answer/i.test(testId);

      if (isAnswerBtn) {
        matched.push(el);
      }
    }
    return matched;
  }

  function hasVisibleHangupButton(elements) {
    for (const el of elements) {
      if (!isElementVisible(el)) continue;
      const aria = String(el.getAttribute?.('aria-label') || '').trim();
      const title = String(el.getAttribute?.('title') || el.getAttribute?.('mattooltip') || '').trim();
      const testId = String(el.getAttribute?.('gv-test-id') || '').trim();
      if (/\b(end\s*call|hang\s*up|leave\s*call|disconnect)\b/i.test(`${aria} ${title} ${testId}`)) {
        return true;
      }
    }
    return false;
  }

  function scanGoogleVoiceDom() {
    if (!autoAnswerEnabled) return;
    const now = Date.now();
    const elements = queryAllDeep(document);

    // 1. Check for VISIBLE Incoming Call "Answer" button in Google Voice
    const answerBtns = findVisibleAnswerButtons(elements);
    if (answerBtns.length > 0 && now - lastAnswerClickTs > 600) {
      lastAnswerClickTs = now;
      for (const btn of answerBtns) {
        clickElement(btn);
      }
      if (!callActive || now - lastCallStartTs > 4000) {
        onIncomingCallAnswered();
      }
      return;
    }

    // 2. Check if URL has ?a=nc,<number> outbound call request and auto-click visible Call button
    if (window.location.search.includes('a=nc,') && now - lastAutoDialTs > 4000) {
      for (const el of elements) {
        if (!isElementVisible(el)) continue;
        const aria = String(el.getAttribute?.('aria-label') || '').trim();
        if (/^call(\s+\+?[\d\s()-]+)?$/i.test(aria)) {
          lastAutoDialTs = now;
          clickElement(el);
          break;
        }
      }
    }

    // 3. Detect if an active call has ended (only checks VISIBLE End Call / Hang Up button!)
    if (callActive && now - lastCallStartTs > 4500) {
      if (!hasVisibleHangupButton(elements)) {
        callActive = false;
        if (activeAudio) {
          try {
            activeAudio.pause();
          } catch {}
          activeAudio = null;
        }
        if (recognition && recRunning) {
          try {
            recognition.stop();
          } catch {}
          recRunning = false;
        }
        updateStatusBanner('🟢 Sarah Natural Voice (Vindemiatrix) Auto-Answer ON • (480) 331-9455', '#10b981');
      }
    }
  }

  // Expose diagnostic helper for automated 5-call testing
  window.__IWG_GV_SCAN_NOW__ = scanGoogleVoiceDom;
  window.__IWG_GV_GET_STATE__ = () => ({
    callActive,
    isSpeaking,
    lastAnswerClickTs,
    lastCallStartTs,
    hasPreloadedGreeting: Boolean(preloadedGreeting?.audio_base64),
  });

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'IWG_GV_DIAL_NOW' && msg.phone) {
        const cleanDigits = String(msg.phone).replace(/\D/g, '');
        const e164 = cleanDigits.length === 10 ? `+1${cleanDigits}` : `+${cleanDigits}`;
        window.location.href = `https://voice.google.com/u/0/calls?a=nc,${encodeURIComponent(e164)}`;
      }
    });
  }

  updateStatusBanner('🟢 Sarah Natural Voice (Vindemiatrix) Auto-Answer ON • (480) 331-9455', '#10b981');
  const intervalId = setInterval(scanGoogleVoiceDom, 120);

  // Unthrottled Web Worker timer so Chrome NEVER throttles background call detection
  let worker = null;
  try {
    const blob = new Blob(
      ['const id = setInterval(() => postMessage("tick"), 120); onmessage = (e) => { if (e.data === "stop") clearInterval(id); };'],
      { type: 'application/javascript' }
    );
    worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = () => scanGoogleVoiceDom();
  } catch {}

  const observer = new MutationObserver(() => {
    scanGoogleVoiceDom();
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] });
  }

  window.__IWG_GV_RECEPTIONIST_CLEANUP__ = () => {
    clearInterval(intervalId);
    if (worker) {
      try {
        worker.postMessage('stop');
        worker.terminate();
      } catch {}
    }
    try {
      observer.disconnect();
    } catch {}
    if (activeAudio) {
      try {
        activeAudio.pause();
      } catch {}
      activeAudio = null;
    }
    if (recognition && recRunning) {
      try {
        recognition.stop();
      } catch {}
      recRunning = false;
    }
  };
})();
