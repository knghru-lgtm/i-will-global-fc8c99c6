(function () {
  if (typeof window.__IWG_GV_RECEPTIONIST_CLEANUP__ === 'function') {
    try {
      window.__IWG_GV_RECEPTIONIST_CLEANUP__();
    } catch {}
  }
  window.__IWG_GV_RECEPTIONIST_ACTIVE__ = true;

  const EXTENSION_BUILD = '2026-11-08-v6';
  const OPENING_GREETING =
    'Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?';

  let autoAnswerEnabled = true;
  let callActive = false;
  let isSpeaking = false;
  let turnInFlight = false;
  let lastAnswerClickTs = 0;
  let lastCallStartTs = 0;
  let lastAutoDialTs = 0;
  let totalCallsAnswered = 0;
  let callHistory = [];
  let activeAudio = null;
  let preloadedGreeting = null;
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

  // Keep-alive Web Audio context so Chrome NEVER throttles or suspends this Google Voice window in the background
  function ensureKeepAliveAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!sarahAudioCtx || sarahAudioCtx.state === 'closed') {
        sarahAudioCtx = new AudioCtx();
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

  // Deep DOM + Shadow DOM + Same-Origin Frame scanner so custom <gv-*> / <mat-*> elements are ALWAYS traversed
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
          tag === 'INPUT' ||
          tag === 'A' ||
          tag === 'MAT-ICON' ||
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
        if (tag === 'IFRAME') {
          try {
            if (el.contentDocument) walk(el.contentDocument);
          } catch {}
        }
      }
    };
    walk(root);
    return out;
  }

  // Reliable visibility check that never gets tripped up by Angular Material aria-hidden wrappers or fade-in opacity
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
    } catch {}
  }

  function clickElement(el) {
    if (!el) return;
    ensureKeepAliveAudio();
    const parentBtn = el.closest?.('button, [role="button"]');
    if (parentBtn && parentBtn !== el) {
      clickSingleTarget(parentBtn);
    }
    clickSingleTarget(el);
    const childBtn = el.querySelector?.('button, [role="button"]');
    if (childBtn && childBtn !== el) {
      clickSingleTarget(childBtn);
    }
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

  // Use extension service worker (background.js) FIRST so voice.google.com CSP/PNA never blocks localhost or iwillglobal.com;
  // automatically fall back to direct fetch() if outside extension context or if service worker is reloading.
  async function callSarahBackend(endpoint, payload) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
      const viaBg = await new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            resolve(null);
          }
        }, 6000);
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

  // Pre-fetch Sarah's natural Vindemiatrix neural voice for the opening greeting so it plays in 0ms on answer!
  async function preloadSarahNaturalGreeting() {
    try {
      const turn = await callSarahBackend('/api/sarah/turn', {
        is_initial: true,
        context: { mode: 'inbound', source_channel: 'call_in_lead' },
      });
      if (turn && turn.audio_base64) {
        // Set preloadedGreeting IMMEDIATELY so 1st-ring answer has 0ms audio ready right away!
        preloadedGreeting = {
          audio_base64: turn.audio_base64,
          audio_mime: turn.audio_mime || 'audio/wav',
          rest_audio_base64: null,
        };
        if (turn.rest_text) {
          const r2 = await callSarahBackend('/api/sarah/tts', { text: turn.rest_text });
          if (r2?.audio_base64 && preloadedGreeting) {
            preloadedGreeting.rest_audio_base64 = r2.audio_base64;
          }
        }
      }
    } catch {}
  }
  preloadSarahNaturalGreeting();

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
      if (text === OPENING_GREETING) {
        const initTurn = await callSarahBackend('/api/sarah/turn', {
          is_initial: true,
          context: { mode: 'inbound', source_channel: 'call_in_lead' },
        });
        if (initTurn?.audio_base64) {
          primaryBase64 = initTurn.audio_base64;
          primaryMime = initTurn.audio_mime || 'audio/wav';
        }
      }
      if (!primaryBase64) {
        const ttsRes = await callSarahBackend('/api/sarah/tts', { text });
        if (ttsRes?.audio_base64) {
          primaryBase64 = ttsRes.audio_base64;
          primaryMime = ttsRes.audio_mime || 'audio/wav';
        }
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
        if (res?.prospect_state) sessionContext.state = res.prospect_state;
        if (res?.how_heard) sessionContext.how_heard = res.how_heard;

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

  function onIncomingCallAnswered(customCallerPhone) {
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
    updateStatusBanner('🟢 Call Answered on 1st Ring (480) 331-9455 — Sarah Speaking', '#10b981');

    callSarahBackend('/api/sarah/inbound', {
      from: callerPhone || '',
      caller_name: '',
      notes: 'Auto-answered immediately on 1st ring in Google Voice (480) 331-9455',
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

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: 'IWG_GV_CALL_ANSWERED',
            callerPhone: callerPhone,
            callerName: '',
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
      }
    } catch {}

    setTimeout(() => {
      speakSarahNaturalVoice(
        OPENING_GREETING,
        preloadedGreeting?.audio_base64 || null,
        preloadedGreeting?.audio_mime || 'audio/wav',
        '',
        preloadedGreeting?.rest_audio_base64 || null
      );
    }, 200);
  }

  function findVisibleAnswerButtons(elements) {
    const matched = [];
    const bodyText = (document.body?.innerText || '') + ' ' + (document.title || '');
    const hasIncomingCallBanner = /\bincoming\s+call\b|\bis\s+calling\b/i.test(bodyText);

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
      const txt = String(el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const combined = `${aria} ${title} ${testId}`;

      const isDeclineOrEnd =
        /decline|reject|ignore|hang\s*up|end\s*call|leave\s*call|dismiss|voicemail|settings|auto-answer|keypad|mute|hold|transfer|screen\s*call|call_end/i.test(
          `${combined} ${txt}`
        );
      if (isDeclineOrEnd) continue;

      let isGreenIncomingBtn = false;
      if (
        hasIncomingCallBanner &&
        Boolean(
          el.closest?.(
            '[class*="incoming" i], [gv-test-id*="incoming" i], gv-call-sidebar, [class*="call-sidebar" i], [class*="call-panel" i], [class*="ringing" i]'
          )
        )
      ) {
        if (/^(call|phone_in_talk)$/i.test(txt)) {
          isGreenIncomingBtn = true;
        } else {
          try {
            const bg = window.getComputedStyle(el).backgroundColor || '';
            const rgbMatch = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
            if (rgbMatch) {
              const r = Number(rgbMatch[1]);
              const g = Number(rgbMatch[2]);
              const b = Number(rgbMatch[3]);
              // Google Voice Answer button is always green (G significantly greater than R and B; never red)
              if (g > r + 30 && g > b + 20 && g >= 100) {
                isGreenIncomingBtn = true;
              }
            }
          } catch {}
        }
      }

      const isAnswerBtn =
        /\b(answer|answer\s*call|accept|accept\s*call|pick\s*up)\b/i.test(aria) ||
        /\b(answer|answer\s*call|accept|accept\s*call|pick\s*up)\b/i.test(title) ||
        /^(answer|answer\s*call|accept|accept\s*call|call\s*answer|phone_in_talk\s*answer)$/i.test(txt) ||
        /answer|accept[-_]?call/i.test(testId) ||
        isGreenIncomingBtn;

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
    if (answerBtns.length > 0 && now - lastAnswerClickTs > 500) {
      lastAnswerClickTs = now;
      for (const btn of answerBtns) {
        clickElement(btn);
      }
      if (!callActive || now - lastCallStartTs > 3500) {
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

  // Simulate an incoming call banner inside the real Google Voice DOM for end-to-end verification
  function triggerSimulatedIncomingCallInDom(callerPhone = '(602) 456-9681') {
    const existing = document.getElementById('iwg-simulated-gv-incoming');
    if (existing) existing.remove();

    const simBanner = document.createElement('div');
    simBanner.id = 'iwg-simulated-gv-incoming';
    simBanner.className = 'gv-incoming-call-panel';
    simBanner.style.cssText =
      'position:fixed;top:20px;right:20px;z-index:2147483646;background:#1e293b;color:#fff;padding:14px 18px;border-radius:12px;border:2px solid #22c55e;display:flex;align-items:center;gap:12px;box-shadow:0 10px 25px rgba(0,0,0,0.5);font-family:system-ui,sans-serif;';
    simBanner.innerHTML = `
      <div>
        <div style="font-weight:700;font-size:13px;">Incoming call</div>
        <div style="font-size:12px;color:#94a3b8;">${callerPhone}</div>
      </div>
      <button aria-label="Answer call" gv-test-id="incoming-call-answer" style="background:#22c55e;color:#fff;border:none;border-radius:999px;padding:8px 16px;font-weight:700;cursor:pointer;">Answer</button>
    `;
    const btn = simBanner.querySelector('button');
    if (btn) {
      btn.addEventListener('click', () => {
        simBanner.remove();
      });
    }
    document.body.appendChild(simBanner);
    scanGoogleVoiceDom();
  }

  // Send 2-second live heartbeat & DOM telemetry to the IWG Server Watchdog
  async function sendWatchdogHeartbeat() {
    try {
      const elements = queryAllDeep(document);
      const visibleButtons = [];
      for (const el of elements) {
        const aria = String(el.getAttribute?.('aria-label') || '').trim();
        const title = String(el.getAttribute?.('title') || el.getAttribute?.('mattooltip') || '').trim();
        const testId = String(el.getAttribute?.('gv-test-id') || '').trim();
        const text = String(el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 45);
        const combined = `${aria} ${title} ${testId} ${text}`;
        if (/call|answer|accept|decline|incoming|ring|hang|end|receiving/i.test(combined)) {
          const rect = el.getBoundingClientRect?.() || { width: 0, height: 0 };
          visibleButtons.push({
            tag: el.tagName,
            aria,
            title,
            testId,
            text,
            classes: String(el.className || '').slice(0, 50),
            visible: isElementVisible(el),
            rect: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          });
        }
      }

      const bodyTxt = document.body?.innerText || '';
      const receivingCallsText = /receiving\s+calls/i.test(bodyTxt) ? 'Receiving calls' : '';
      const incomingMatch = bodyTxt.match(/incoming\s+call[^\n]*/i);
      const incomingBannerText = incomingMatch ? incomingMatch[0].slice(0, 80) : '';

      const res = await callSarahBackend('/api/sarah/gv-heartbeat', {
        extensionBuild: EXTENSION_BUILD,
        url: window.location.href,
        title: document.title,
        visibilityState: document.visibilityState,
        receivingCallsText,
        incomingBannerText,
        callActive,
        isSpeaking,
        hasPreloadedGreeting: Boolean(preloadedGreeting?.audio_base64),
        audioCtxState: sarahAudioCtx?.state || 'uninitialized',
        lastAnswerClickTs,
        totalCallsAnswered,
        visibleButtons: visibleButtons.slice(0, 25),
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
      if (msg && msg.type === 'IWG_GV_DIAL_NOW' && msg.phone) {
        const cleanDigits = String(msg.phone).replace(/\D/g, '');
        const e164 = cleanDigits.length === 10 ? `+1${cleanDigits}` : `+${cleanDigits}`;
        window.location.href = `https://voice.google.com/u/0/calls?a=nc,${encodeURIComponent(e164)}`;
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });
  }

  updateStatusBanner('🟢 Sarah Natural Voice (Vindemiatrix) Auto-Answer ON • (480) 331-9455', '#10b981');
  const intervalId = setInterval(scanGoogleVoiceDom, 50);
  const heartbeatIntervalId = setInterval(sendWatchdogHeartbeat, 2000);
  setTimeout(sendWatchdogHeartbeat, 300);

  // Unthrottled Web Worker timer so Chrome NEVER throttles background call detection
  let worker = null;
  try {
    const blob = new Blob(
      ['const id = setInterval(() => postMessage("tick"), 50); onmessage = (e) => { if (e.data === "stop") clearInterval(id); };'],
      { type: 'application/javascript' }
    );
    worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = () => scanGoogleVoiceDom();
  } catch {}

  const observer = new MutationObserver(() => {
    scanGoogleVoiceDom();
  });
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'aria-label'],
    });
  }

  window.__IWG_GV_RECEPTIONIST_CLEANUP__ = () => {
    clearInterval(intervalId);
    clearInterval(heartbeatIntervalId);
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
