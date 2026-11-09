(function () {
  if (typeof window !== 'undefined' && window.top && window !== window.top) {
    return;
  }
  if (typeof window.__IWG_GV_RECEPTIONIST_CLEANUP__ === 'function') {
    try {
      window.__IWG_GV_RECEPTIONIST_CLEANUP__();
    } catch {}
  }
  window.__IWG_GV_RECEPTIONIST_ACTIVE__ = true;

  const EXTENSION_BUILD = '2026-11-09-v8';
  const OPENING_GREETING =
    'Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?';

  let autoAnswerEnabled = true;
  let callActive = false;
  let isSpeaking = false;
  let turnInFlight = false;
  let lastAnswerClickTs = 0;
  let lastCallStartTs = 0;
  let lastSpeechEndedAt = 0;
  let lastSarahSpokenText = '';
  let totalCallsAnswered = 0;
  let callHistory = [];
  let activeAudio = null;
  let preloadedGreeting = null;
  let playReqCounter = 0;
  const pendingPlayResolvers = new Map();

  let sessionContext = {
    mode: 'inbound',
    source_channel: 'call_in_lead',
    lead_id: '',
    prospect_name: '',
    prospect_phone: '',
    address: '',
    state: 'AZ',
  };
  let recognition = null;
  let recRunning = false;
  let sarahAudioCtx = null;

  function isEchoOfSarah(spokenText) {
    const clean = String(spokenText || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean || clean.length < 2) return true;
    if (
      /thank you for calling iwg|100 free fiduciary|representing over 104 premier carriers|zero broker fees|this is sarah speaking|how may i direct your call|42 member team directory|six core divisions|please reply yes to that confirmation|i have scheduled your .* appointment|principal broker king amen ra/i.test(
        clean
      )
    ) {
      return true;
    }
    const cleanLastSarah = String(lastSarahSpokenText || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanLastSarah && clean.length >= 14 && cleanLastSarah.includes(clean)) {
      return true;
    }
    return false;
  }

  function ensureKeepAliveAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!sarahAudioCtx || sarahAudioCtx.state === 'closed') {
        sarahAudioCtx = new AudioCtx();
      }
      if (sarahAudioCtx.state === 'suspended') {
        sarahAudioCtx.resume().catch(() => {});
      }
      return sarahAudioCtx;
    } catch {
      return null;
    }
  }

  function queryAllDeep(root = document) {
    const out = [];
    const visited = new Set();
    const walk = (node) => {
      if (!node || visited.has(node)) return;
      visited.add(node);
      let all = [];
      try {
        all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      } catch {
        all = [];
      }
      for (const el of all) {
        const tag = el.tagName;
        if (
          tag === 'BUTTON' ||
          el.hasAttribute?.('role') ||
          el.hasAttribute?.('aria-label') ||
          el.hasAttribute?.('gv-test-id') ||
          el.hasAttribute?.('data-e2e') ||
          el.hasAttribute?.('mattooltip') ||
          el.hasAttribute?.('data-tooltip') ||
          el.hasAttribute?.('title')
        ) {
          out.push(el);
        }
        if (el.shadowRoot) {
          walk(el.shadowRoot);
        }
      }
    };
    walk(root);
    return out;
  }

  function isElementVisible(el) {
    if (!el || el.disabled) return false;
    if (el.hasAttribute?.('hidden') || el.getAttribute?.('aria-hidden') === 'true') return false;
    if (el.closest?.('#iwg-gv-receptionist-badge, [hidden]')) return false;
    try {
      const style = window.getComputedStyle(el);
      if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false;
      }
      const rect = el.getBoundingClientRect?.();
      if (!rect || rect.width < 8 || rect.height < 8) return false;
      return true;
    } catch {
      return true;
    }
  }

  function clickSingleTarget(target) {
    if (!target) return;
    try {
      target.focus?.();
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((evtName) => {
        target.dispatchEvent(
          new MouseEvent(evtName, {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
      });
      target.click?.();
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
      );
      target.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
      );
    } catch {}
  }

  function clickElement(el) {
    if (!el) return;
    const parentBtn = el.closest?.('button, [role="button"]');
    if (parentBtn && parentBtn !== el) {
      clickSingleTarget(parentBtn);
    }
    clickSingleTarget(el);
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

  async function callSarahBackend(endpoint, payload) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
      const viaBg = await new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            resolve(null);
          }
        }, 6500);
        try {
          chrome.runtime.sendMessage({ type: 'IWG_SARAH_API', endpoint, payload }, (res) => {
            void chrome.runtime.lastError;
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve(res?.data || null);
            }
          });
        } catch {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(null);
          }
        }
      });
      if (viaBg) return viaBg;
    }

    const bases = ['http://localhost:4000', 'https://iwillglobal.com'];
    for (const base of bases) {
      try {
        const res = await fetch(`${base}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
        });
        if (res.ok) {
          return await res.json();
        }
      } catch {}
    }
    return null;
  }

  async function preloadSarahNaturalGreeting() {
    try {
      const turn = await callSarahBackend('/api/sarah/turn', {
        is_initial: true,
        context: { mode: 'inbound', source_channel: 'call_in_lead' },
      });
      if (turn && turn.audio_base64) {
        preloadedGreeting = {
          audio_base64: turn.audio_base64,
          audio_mime: turn.audio_mime || 'audio/wav',
          rest_audio_base64: null,
        };
      }
    } catch {}
  }
  preloadSarahNaturalGreeting();

  function playSingleWavBase64(base64, mime = 'audio/wav', maxMs = 18000) {
    return new Promise((resolve) => {
      if (!base64) return resolve(false);

      // First route through the MAIN-world WebRTC Virtual Audio Bridge so the phone caller hears Sarah directly over WebRTC
      const hasWebRtcBridge =
        typeof document !== 'undefined' &&
        document.documentElement?.getAttribute('data-iwg-webrtc-bridge') === 'ready';

      if (hasWebRtcBridge) {
        const requestId = `wav-${++playReqCounter}-${Date.now()}`;
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            pendingPlayResolvers.delete(requestId);
            resolve(true);
          }
        }, maxMs);

        pendingPlayResolvers.set(requestId, (ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pendingPlayResolvers.delete(requestId);
          if (ok) {
            resolve(true);
          } else {
            playViaHtmlAudioFallback(base64, mime, maxMs).then(resolve);
          }
        });

        window.postMessage(
          {
            __iwg_webrtc__: true,
            type: 'IWG_SARAH_PLAY_WAV',
            base64,
            mime,
            requestId,
          },
          '*'
        );
        return;
      }

      playViaHtmlAudioFallback(base64, mime, maxMs).then(resolve);
    });
  }

  function playViaHtmlAudioFallback(base64, mime = 'audio/wav', maxMs = 18000) {
    return new Promise((resolve) => {
      try {
        if (activeAudio) {
          try {
            activeAudio.pause();
            activeAudio.src = '';
          } catch {}
          activeAudio = null;
        }
        ensureKeepAliveAudio();
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

  async function speakSarahNaturalVoice(text, audioBase64, audioMime, restText, preloadedRestBase64, onDone) {
    if (!text) {
      isSpeaking = false;
      onDone?.();
      return;
    }
    lastSarahSpokenText = text;
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
      if (text === OPENING_GREETING && preloadedGreeting?.audio_base64) {
        primaryBase64 = preloadedGreeting.audio_base64;
        primaryMime = preloadedGreeting.audio_mime || 'audio/wav';
      } else {
        const ttsRes = await callSarahBackend('/api/sarah/tts', { text });
        if (ttsRes?.audio_base64) {
          primaryBase64 = ttsRes.audio_base64;
          primaryMime = ttsRes.audio_mime || 'audio/wav';
        }
      }
    }

    if (primaryBase64) {
      const cleanRest = text === OPENING_GREETING ? '' : String(restText || '').trim();
      const restPromise =
        cleanRest && preloadedRestBase64
          ? Promise.resolve({ audio_base64: preloadedRestBase64, audio_mime: 'audio/wav' })
          : cleanRest
          ? callSarahBackend('/api/sarah/tts', { text: cleanRest })
          : Promise.resolve(null);

      await playSingleWavBase64(primaryBase64, primaryMime);
      if (cleanRest) {
        const restTts = await restPromise;
        if (restTts?.audio_base64) {
          await playSingleWavBase64(restTts.audio_base64, restTts.audio_mime || 'audio/wav');
        }
      }
    }

    isSpeaking = false;
    lastSpeechEndedAt = Date.now();
    setTimeout(startListening, 550);
    onDone?.();
  }

  async function processCallerTurn(turnPayload) {
    if (!callActive || isSpeaking || turnInFlight) return;
    if (Date.now() - lastSpeechEndedAt < 500) return;

    const spokenText = String(turnPayload?.message || '').trim();
    const callerAudioBase64 = turnPayload?.caller_audio_base64 || null;
    const callerAudioMime = turnPayload?.caller_audio_mime || 'audio/webm';

    if (spokenText && isEchoOfSarah(spokenText)) return;
    if (!spokenText && !callerAudioBase64) return;

    turnInFlight = true;
    if (spokenText) {
      updateStatusBanner(`🎧 Caller: "${spokenText.slice(0, 42)}..." — Sarah Replying`, '#38bdf8');
      callHistory.push({ speaker: 'user', text: spokenText });
    } else {
      updateStatusBanner(`🎧 Processing Caller WebRTC Audio — Sarah Replying`, '#38bdf8');
    }

    const res = await callSarahBackend('/api/sarah/turn', {
      message: spokenText,
      caller_audio_base64: callerAudioBase64,
      caller_audio_mime: callerAudioMime,
      skip_inline_tts: false,
      history: callHistory.slice(-12),
      context: sessionContext,
    });
    turnInFlight = false;

    if (!res || res.is_echo || res.is_silence || !res.reply) {
      return;
    }

    if (!spokenText && res.transcribed_user_text) {
      callHistory.push({ speaker: 'user', text: res.transcribed_user_text });
    }

    if (res.lead_id) sessionContext.lead_id = res.lead_id;
    if (res.prospect_name) sessionContext.prospect_name = res.prospect_name;
    if (res.prospect_phone) sessionContext.prospect_phone = res.prospect_phone;
    if (res.prospect_address) sessionContext.address = res.prospect_address;
    if (res.prospect_state) sessionContext.state = res.prospect_state;
    if (res.how_heard) sessionContext.how_heard = res.how_heard;

    const reply = res.reply;
    callHistory.push({ speaker: 'sarah', text: reply });
    updateStatusBanner(`🎙️ Sarah Speaking (Vindemiatrix Natural Voice) • (480) 331-9455`, '#10b981');
    await speakSarahNaturalVoice(
      reply,
      res.audio_base64 || null,
      res.audio_mime || 'audio/wav',
      res.rest_text || '',
      null
    );
  }

  // Listen for WebRTC audio events from webrtc-bridge.js (MAIN world)
  window.addEventListener('message', (ev) => {
    const data = ev?.data;
    if (!data || !data.__iwg_webrtc__) return;
    if (data.type === 'IWG_SARAH_PLAY_DONE' && data.requestId) {
      const fn = pendingPlayResolvers.get(data.requestId);
      if (fn) fn(Boolean(data.ok));
    } else if (data.type === 'IWG_CALLER_WEBRTC_AUDIO' && data.audioBase64) {
      processCallerTurn({
        caller_audio_base64: data.audioBase64,
        caller_audio_mime: data.mimeType || 'audio/webm',
      });
    }
  });

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
        if (!callActive || isSpeaking || turnInFlight) return;
        if (Date.now() - lastSpeechEndedAt < 500) return;

        let finalTranscript = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) {
            finalTranscript += ' ' + (ev.results[i][0]?.transcript || '');
          }
        }
        const clean = finalTranscript.trim();
        if (!clean || isEchoOfSarah(clean)) return;
        await processCallerTurn({ message: clean });
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
          }, 300);
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
    const callContainers = document.querySelectorAll(
      '[class*="incoming" i], [class*="active-call" i], [aria-label*="Incoming call" i], [aria-label*="Call with" i], [role="alertdialog"]'
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

  function onIncomingCallAnswered(customCallerPhone, silentInternalOnly = false) {
    if (callActive && Date.now() - lastCallStartTs < 15000) {
      return;
    }
    callActive = true;
    lastCallStartTs = Date.now();
    totalCallsAnswered += 1;
    callHistory = [];
    const callerPhone = customCallerPhone || extractActiveCallerPhone();
    sessionContext = {
      mode: 'inbound',
      source_channel: 'call_in_lead',
      lead_id: '',
      prospect_name: '',
      prospect_phone: callerPhone || '',
      address: '',
      state: 'AZ',
    };

    callHistory.push({ speaker: 'sarah', text: OPENING_GREETING });
    updateStatusBanner('🟢 Call Picked Up Internally on 1st Ring • (480) 331-9455', '#10b981');

    callSarahBackend('/api/sarah/inbound', {
      from: callerPhone || '',
      caller_name: '',
      internal_only: true,
      notes: 'Picked up immediately on 1st ring internally on (480) 331-9455',
    }).catch(() => {});

    callSarahBackend('/api/sarah/gv-heartbeat', {
      extensionBuild: EXTENSION_BUILD,
      url: window.location.href,
      callActive: true,
      totalCallsAnswered,
      lastAnswerClickTs,
      event: 'call_answered_on_first_ring',
      eventDetail: `Answered incoming call ${callerPhone || '(unknown caller)'}`,
    }).catch(() => {});

    if (!silentInternalOnly) {
      setTimeout(() => {
        speakSarahNaturalVoice(
          OPENING_GREETING,
          preloadedGreeting?.audio_base64 || null,
          preloadedGreeting?.audio_mime || 'audio/wav',
          '',
          null
        );
      }, 120);
    }
  }

  // Match explicit Incoming Call Answer buttons and buttons inside an active Incoming Call alert banner
  function findVisibleAnswerButtons(elements) {
    const matched = [];
    for (const el of elements) {
      if (!isElementVisible(el)) continue;
      const aria = String(el.getAttribute?.('aria-label') || '').trim();
      const title = String(
        el.getAttribute?.('title') ||
          el.getAttribute?.('mattooltip') ||
          el.getAttribute?.('data-tooltip') ||
          ''
      ).trim();
      const testId = String(
        el.getAttribute?.('gv-test-id') || el.getAttribute?.('data-e2e') || el.id || ''
      ).trim();
      const classes = String(el.className || '').trim();
      const txt = String(el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const combined = `${aria} ${title} ${testId} ${classes}`;

      // Never click Decline, End Call, Hang Up, Keypad, or the normal Outbound dialpad "Call" button
      const isExcluded =
        /decline|reject|ignore|hang\s*up|end\s*call|leave\s*call|dismiss|voicemail|settings|auto-answer|keypad|mute|hold|transfer|screen|call_end|make\s*a\s*call|dialpad/i.test(
          `${combined} ${txt}`
        ) || /^call(\s+\+?[\d\s()-]+)?$/i.test(aria);
      if (isExcluded) continue;

      const isExplicitAnswerBtn =
        /(answer|accept\s*call|pick\s*up)/i.test(aria) ||
        /(answer|accept\s*call|pick\s*up)/i.test(title) ||
        /^(answer|answer\s*call|accept\s*call|call\s*answer|answer\s*call|phone_in_talk\s*answer|callanswer|answercall|accept)$/i.test(
          txt
        ) ||
        /(answer|accept[-_]?call|incoming[-_]?answer)/i.test(testId);

      // Also check if this button is inside an explicit Incoming Call alert/banner/toast
      const incomingContainer = el.closest?.(
        '[class*="incoming-call" i], [class*="incomingCall" i], [id*="incoming-call" i], [gv-test-id*="incoming" i], [aria-label*="Incoming call" i], [role="alertdialog"]'
      );
      const isButtonInIncomingBanner =
        Boolean(incomingContainer) &&
        (el.tagName === 'BUTTON' || el.getAttribute?.('role') === 'button') &&
        /(answer|accept|call|phone)/i.test(`${combined} ${txt}`);

      if (isExplicitAnswerBtn || isButtonInIncomingBanner) {
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
      const txt = String(el.textContent || '').trim();
      if (/\b(end\s*call|hang\s*up|leave\s*call|disconnect|call_end)\b/i.test(`${aria} ${title} ${testId} ${txt}`)) {
        return true;
      }
    }
    return false;
  }

  function scanGoogleVoiceDom() {
    if (!autoAnswerEnabled) return;
    const now = Date.now();
    const elements = queryAllDeep(document);

    // If a call is ALREADY active, NEVER scan for or click Answer buttons again! Only check if the call has ended.
    if (callActive) {
      if (now - lastCallStartTs > 5000 && !hasVisibleHangupButton(elements) && !isSpeaking) {
        callActive = false;
        window.postMessage({ __iwg_webrtc__: true, type: 'IWG_SARAH_STOP_WAV' }, '*');
        if (recognition && recRunning) {
          try {
            recognition.stop();
            recRunning = false;
          } catch {}
        }
        updateStatusBanner('🟢 Sarah Natural Voice (Vindemiatrix) Auto-Answer ON • (480) 331-9455', '#10b981');
      }
      return;
    }

    // Check for VISIBLE Incoming Call "Answer" button ONLY when no call is active
    const answerBtns = findVisibleAnswerButtons(elements);
    if (answerBtns.length > 0 && now - lastAnswerClickTs > 1500 && now - lastCallStartTs > 8000) {
      lastAnswerClickTs = now;
      for (const btn of answerBtns) {
        clickElement(btn);
      }
      onIncomingCallAnswered();
    }
  }

  function triggerSimulatedIncomingCallInDom(callerPhone = '(602) 456-9681') {
    const existing = document.getElementById('iwg-simulated-gv-incoming-toast');
    if (existing) existing.remove();
    callActive = false;
    lastCallStartTs = 0;
    lastAnswerClickTs = 0;

    const toast = document.createElement('div');
    toast.id = 'iwg-simulated-gv-incoming-toast';
    toast.setAttribute('class', 'gv-incoming-call-panel');
    toast.setAttribute('aria-label', `Incoming call from ${callerPhone}`);
    toast.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:2147483646;background:#0f172a;border:2px solid #22c55e;border-radius:12px;padding:12px 16px;color:#fff;font-family:system-ui,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,0.5);';
    toast.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:#4ade80;margin-bottom:6px;">Incoming call • ${callerPhone}</div>
      <div style="display:flex;gap:8px;">
        <button id="iwg-sim-answer-btn" aria-label="Answer call" gv-test-id="incoming-answer-button" style="background:#16a34a;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-weight:700;cursor:pointer;">Answer</button>
        <button id="iwg-sim-decline-btn" aria-label="Decline call" style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-weight:700;cursor:pointer;">Decline</button>
      </div>
    `;
    document.body.appendChild(toast);

    const ansBtn = toast.querySelector('#iwg-sim-answer-btn');
    let answered = false;
    if (ansBtn) {
      ansBtn.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        toast.remove();
      });
    }

    scanGoogleVoiceDom();
    return { ok: true, answered, callerPhone };
  }

  function collectButtonTelemetry() {
    const elements = queryAllDeep(document);
    const buttons = [];
    for (const el of elements) {
      if (!isElementVisible(el)) continue;
      if (el.tagName !== 'BUTTON' && el.getAttribute?.('role') !== 'button') continue;
      const aria = String(el.getAttribute?.('aria-label') || '').trim();
      const title = String(el.getAttribute?.('title') || el.getAttribute?.('mattooltip') || '').trim();
      const testId = String(el.getAttribute?.('gv-test-id') || el.id || '').trim();
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!aria && !title && !testId && !text) continue;
      buttons.push({
        tag: el.tagName,
        aria,
        title,
        testId,
        text,
        classes: String(el.className || '').slice(0, 80),
        visible: true,
        rect: '',
      });
      if (buttons.length >= 25) break;
    }
    return buttons;
  }

  async function sendWatchdogHeartbeat() {
    try {
      const incomingEl = document.querySelector(
        '[class*="incoming" i], [aria-label*="Incoming call" i], [role="alertdialog"]'
      );
      const res = await callSarahBackend('/api/sarah/gv-heartbeat', {
        extensionBuild: EXTENSION_BUILD,
        url: window.location.href,
        title: document.title || '',
        visibilityState: document.visibilityState || 'visible',
        receivingCallsText:
          document.documentElement?.getAttribute('data-iwg-webrtc-bridge') === 'ready'
            ? 'WebRTC Direct Audio Bridge READY'
            : 'HTML5 Audio Fallback',
        incomingBannerText: incomingEl ? String(incomingEl.innerText || '').slice(0, 200) : '',
        callActive,
        isSpeaking,
        hasPreloadedGreeting: Boolean(preloadedGreeting?.audio_base64),
        audioCtxState: sarahAudioCtx?.state || 'ready',
        lastAnswerClickTs,
        totalCallsAnswered,
        visibleButtons: collectButtonTelemetry(),
      });

      if (res?.reloadExtension && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'IWG_RELOAD_EXTENSION' }, () => {
          void chrome.runtime.lastError;
        });
      }
      if (res?.reloadTab) {
        window.location.reload();
      }
      if (res?.simulateIncomingCall) {
        triggerSimulatedIncomingCallInDom(res.callerPhone || '(602) 456-9681');
      }
    } catch {}
  }

  window.__IWG_GV_SCAN_NOW__ = scanGoogleVoiceDom;
  window.__IWG_GV_SIMULATE_CALL__ = triggerSimulatedIncomingCallInDom;
  window.__IWG_GV_GET_STATE__ = () => ({
    build: EXTENSION_BUILD,
    callActive,
    isSpeaking,
    lastAnswerClickTs,
    lastCallStartTs,
    totalCallsAnswered,
    hasPreloadedGreeting: Boolean(preloadedGreeting?.audio_base64),
  });

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'IWG_GV_PING') {
        sendResponse({ alive: true, build: EXTENSION_BUILD, callActive });
        return false;
      }
      return false;
    });
  }

  updateStatusBanner('🟢 Sarah Natural Voice (Vindemiatrix) Auto-Answer ON • (480) 331-9455', '#10b981');
  const intervalId = setInterval(scanGoogleVoiceDom, 80);
  const heartbeatIntervalId = setInterval(sendWatchdogHeartbeat, 4000);
  setTimeout(sendWatchdogHeartbeat, 400);

  const observer = new MutationObserver(() => {
    if (!callActive) {
      scanGoogleVoiceDom();
    }
  });
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  }

  window.__IWG_GV_RECEPTIONIST_CLEANUP__ = () => {
    clearInterval(intervalId);
    clearInterval(heartbeatIntervalId);
    try {
      observer.disconnect();
    } catch {}
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.src = '';
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
