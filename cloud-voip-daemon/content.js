(function () {
  const IS_TOP_FRAME = typeof window === 'undefined' || !window.top || window === window.top;
  if (typeof window.__IWG_GV_RECEPTIONIST_CLEANUP__ === 'function') {
    try {
      window.__IWG_GV_RECEPTIONIST_CLEANUP__();
    } catch {}
  }
  window.__IWG_GV_RECEPTIONIST_ACTIVE__ = true;

  const EXTENSION_BUILD = '2026-11-10-v12';
  const SELECTORS = [
    'button[aria-label*="Answer" i]',
    'button[aria-label*="Accept" i]',
    'button[data-call-action="answer"]',
    'div[role="button"][aria-label*="Answer" i]',
    '[aria-label*="Pick up" i]',
  ];
  const cloudDaemonCfg =
    typeof window !== 'undefined' && window.__IWG_CLOUD_DAEMON_CONFIG__
      ? window.__IWG_CLOUD_DAEMON_CONFIG__
      : null;
  const RUNNER_MODE = cloudDaemonCfg ? 'cloud-daemon' : 'chrome-extension';
  const OPENING_GREETING =
    'Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?';
  const AFTER_HOURS_GREETING =
    'Thank you for calling I Will Global. Our office is currently closed. Our regular business hours are Monday through Friday, from 8 AM to 5 PM Arizona time. Please call us back during normal business hours. Have a wonderful day.';

  let autoAnswerEnabled = true;
  let standbyForCloud = false;
  let callActive = false;
  let pendingAnswerAttempt = false;
  let pendingAnswerStartedTs = 0;
  let pendingCallerPhone = '';
  let activeCallIsBusinessHours = true;
  let isSpeaking = false;
  let turnInFlight = false;
  let lastAnswerClickTs = 0;
  let lastCallStartTs = 0;
  let lastCallEndedTs = 0;
  let lastSpeechEndedAt = 0;
  let lastSarahSpokenText = '';
  let totalCallsAnswered = 0;
  let callHistory = [];
  let activeAudio = null;
  let preloadedGreeting = null;
  let preloadedAfterHoursGreeting = null;

  const phoenixFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  function nthWeekdayOfMonth(year, month1Based, targetDow, n) {
    const firstDow = new Date(Date.UTC(year, month1Based - 1, 1)).getUTCDay();
    return 1 + ((7 + targetDow - firstDow) % 7) + (n - 1) * 7;
  }

  function lastWeekdayOfMonth(year, month1Based, targetDow) {
    const lastDate = new Date(Date.UTC(year, month1Based, 0));
    const lastDom = lastDate.getUTCDate();
    const lastDow = lastDate.getUTCDay();
    return lastDom - ((7 + lastDow - targetDow) % 7);
  }

  function isObservedFixedHoliday(year, month, day, targetMonth, targetDay) {
    if (month === targetMonth && day === targetDay) return true;
    const actualDow = new Date(Date.UTC(year, targetMonth - 1, targetDay)).getUTCDay();
    if (actualDow === 6) {
      const obs = new Date(Date.UTC(year, targetMonth - 1, targetDay - 1));
      return obs.getUTCMonth() + 1 === month && obs.getUTCDate() === day;
    }
    if (actualDow === 0) {
      const obs = new Date(Date.UTC(year, targetMonth - 1, targetDay + 1));
      return obs.getUTCMonth() + 1 === month && obs.getUTCDate() === day;
    }
    return false;
  }

  function isArizonaHoliday(year, month, day) {
    if (isObservedFixedHoliday(year, month, day, 1, 1)) return true;   // New Year's Day
    if (isObservedFixedHoliday(year, month, day, 6, 19)) return true;  // Juneteenth
    if (isObservedFixedHoliday(year, month, day, 7, 4)) return true;   // Independence Day
    if (isObservedFixedHoliday(year, month, day, 11, 11)) return true; // Veterans Day
    if (isObservedFixedHoliday(year, month, day, 12, 25)) return true; // Christmas Day
    if (month === 1 && day === nthWeekdayOfMonth(year, 1, 1, 3)) return true;  // MLK Day (3rd Mon Jan)
    if (month === 2 && day === nthWeekdayOfMonth(year, 2, 1, 3)) return true;  // Presidents' Day (3rd Mon Feb)
    if (month === 5 && day === lastWeekdayOfMonth(year, 5, 1)) return true;    // Memorial Day (Last Mon May)
    if (month === 9 && day === nthWeekdayOfMonth(year, 9, 1, 1)) return true;  // Labor Day (1st Mon Sep)
    if (month === 11 && day === nthWeekdayOfMonth(year, 11, 4, 4)) return true; // Thanksgiving (4th Thu Nov)
    return false;
  }

  function isPhoenixBusinessHoursNow() {
    try {
      const parts = phoenixFmt.formatToParts(new Date());
      const year = Number(parts.find((p) => p.type === 'year')?.value || 2026);
      const month = Number(parts.find((p) => p.type === 'month')?.value || 1);
      const day = Number(parts.find((p) => p.type === 'day')?.value || 1);
      const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Monday';
      const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
      const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);

      const isWeekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(weekday);
      if (!isWeekday) return false;
      if (isArizonaHoliday(year, month, day)) return false;

      const mins = hour * 60 + minute;
      // Strict Business Hours: Monday–Friday, 8:00 AM (480) – 5:00 PM (1020) America/Phoenix (MST, no DST)
      return mins >= 8 * 60 && mins < 17 * 60;
    } catch {
      return false;
    }
  }
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

  function isElementVisible(el) {
    if (!el || el.disabled) return false;
    if (el.hasAttribute?.('hidden') || el.getAttribute?.('aria-hidden') === 'true') return false;
    if (el.closest?.('#iwg-gv-receptionist-badge, [hidden]')) return false;
    try {
      const style = window.getComputedStyle(el);
      if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false;
      }
      // Allow occluded/minimized tabs (visibilityState === 'hidden') where getBoundingClientRect may report small/zero bounds
      if (document.visibilityState === 'visible') {
        const rect = el.getBoundingClientRect?.();
        if (rect && (rect.width === 0 || rect.height === 0)) return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  function clickSingleTarget(targetBtn) {
    if (!targetBtn) return;
    try {
      targetBtn.focus?.();
      ['pointerdown', 'pointerup'].forEach((evtName) => {
        if (typeof PointerEvent === 'function') {
          targetBtn.dispatchEvent(
            new PointerEvent(evtName, {
              bubbles: true,
              cancelable: true,
              view: window,
            })
          );
        }
      });
      ['mousedown', 'mouseup'].forEach((evtName) => {
        targetBtn.dispatchEvent(
          new MouseEvent(evtName, {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
      });
      targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      targetBtn.click();
      targetBtn.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
      );
      targetBtn.dispatchEvent(
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

    const bases = cloudDaemonCfg?.apiBase
      ? [cloudDaemonCfg.apiBase, 'https://voice.iwillglobal.com', 'http://localhost:4000']
      : ['https://voice.iwillglobal.com', 'http://localhost:4000', 'https://iwillglobal.com'];
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
      const [openTurn, closedTurn] = await Promise.all([
        callSarahBackend('/api/sarah/turn', {
          is_initial: true,
          context: { mode: 'inbound', source_channel: 'call_in_lead', force_work_hours: true },
        }),
        callSarahBackend('/api/sarah/turn', {
          is_initial: true,
          context: { mode: 'inbound', source_channel: 'call_in_lead', force_work_hours: false },
        }),
      ]);
      if (openTurn && openTurn.audio_base64) {
        preloadedGreeting = {
          audio_base64: openTurn.audio_base64,
          audio_mime: openTurn.audio_mime || 'audio/wav',
          rest_audio_base64: null,
        };
      }
      if (closedTurn && closedTurn.audio_base64) {
        preloadedAfterHoursGreeting = {
          audio_base64: closedTurn.audio_base64,
          audio_mime: closedTurn.audio_mime || 'audio/wav',
          rest_audio_base64: null,
        };
      }
    } catch {}
  }
  if (IS_TOP_FRAME) {
    preloadSarahNaturalGreeting();
  }

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
    if (!callActive || !activeCallIsBusinessHours || isSpeaking || turnInFlight) return;
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

  // Listen for WebRTC audio & connection events from webrtc-bridge.js (MAIN world)
  window.addEventListener('message', (ev) => {
    const data = ev?.data;
    if (!data || !data.__iwg_webrtc__) return;
    if (data.type === 'IWG_SARAH_PLAY_DONE' && data.requestId) {
      const fn = pendingPlayResolvers.get(data.requestId);
      if (fn) fn(Boolean(data.ok));
    } else if (data.type === 'IWG_WEBRTC_CALL_CONNECTED' || data.type === 'IWG_SUBFRAME_CALL_ANSWERED') {
      if (IS_TOP_FRAME && !callActive) {
        pendingAnswerAttempt = false;
        onIncomingCallAnswered(data.callerPhone || pendingCallerPhone);
      }
    } else if (data.type === 'IWG_WEBRTC_CALL_ENDED') {
      if (callActive && Date.now() - lastCallStartTs > 1500) {
        callActive = false;
        pendingAnswerAttempt = false;
        lastCallEndedTs = Date.now();
      }
    } else if (data.type === 'IWG_CALLER_WEBRTC_AUDIO' && data.audioBase64) {
      processCallerTurn({
        caller_audio_base64: data.audioBase64,
        caller_audio_mime: data.mimeType || 'audio/webm',
      });
    }
  });

  function startListening() {
    if (!callActive || isSpeaking || recRunning) return;
    // When the MAIN-world WebRTC Direct Audio Bridge is active, incoming caller speech is captured
    // 100% digitally from the WebRTC MediaStreamTrack — NEVER open the PC's physical microphone (prevents room noise, hiss, and feedback)!
    if (
      typeof document !== 'undefined' &&
      document.documentElement?.getAttribute('data-iwg-webrtc-bridge') === 'ready'
    ) {
      return;
    }
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

  function hangupActiveGoogleVoiceCall() {
    window.postMessage({ __iwg_webrtc__: true, type: 'IWG_SARAH_STOP_WAV' }, '*');
    try {
      const elements = queryAllDeep(document);
      for (const el of elements) {
        if (!isElementVisible(el)) continue;
        const aria = String(el.getAttribute?.('aria-label') || '').trim();
        const title = String(el.getAttribute?.('title') || el.getAttribute?.('mattooltip') || '').trim();
        const testId = String(el.getAttribute?.('gv-test-id') || '').trim();
        const txt = String(el.textContent || '').trim();
        if (/\b(end\s*call|hang\s*up|leave\s*call|disconnect|call_end)\b/i.test(`${aria} ${title} ${testId} ${txt}`)) {
          clickElement(el);
        }
      }
    } catch {}
    callActive = false;
    pendingAnswerAttempt = false;
    lastCallEndedTs = Date.now();
  }

  function onIncomingCallAnswered(customCallerPhone, silentInternalOnly = false) {
    if (callActive && Date.now() - lastCallStartTs < 8000) {
      return;
    }
    pendingAnswerAttempt = false;
    callActive = true;
    lastCallStartTs = Date.now();
    totalCallsAnswered += 1;
    callHistory = [];
    const callerPhone = customCallerPhone || extractActiveCallerPhone();
    const isBusinessHours = isPhoenixBusinessHoursNow();
    activeCallIsBusinessHours = isBusinessHours;
    const selectedGreetingText = isBusinessHours ? OPENING_GREETING : AFTER_HOURS_GREETING;
    const selectedAudio = isBusinessHours ? preloadedGreeting : preloadedAfterHoursGreeting;

    sessionContext = {
      mode: 'inbound',
      source_channel: 'call_in_lead',
      lead_id: '',
      prospect_name: '',
      prospect_phone: callerPhone || '',
      address: '',
      state: 'AZ',
    };

    callHistory.push({ speaker: 'sarah', text: selectedGreetingText });
    updateStatusBanner(
      isBusinessHours
        ? '🟢 Call Answered on 1st Ring (Business Hours 8AM–5PM MST) • (480) 331-9455'
        : '🌙 Call Answered on 1st Ring (After-Hours Closed Greeting) • (480) 331-9455',
      '#10b981'
    );

    // 1. Begin speaking immediately over the open WebRTC stream (decoupled from any CRM/DB network calls)
    if (!silentInternalOnly) {
      window.postMessage({ __iwg_webrtc__: true, type: 'IWG_RESUME_AUDIO' }, '*');
      speakSarahNaturalVoice(
        selectedGreetingText,
        selectedAudio?.audio_base64 || null,
        selectedAudio?.audio_mime || 'audio/wav',
        '',
        null,
        () => {
          if (!isBusinessHours) {
            // After hours: cleanly terminate the call right after delivering the deterministic closed message
            setTimeout(hangupActiveGoogleVoiceCall, 350);
          }
        }
      );
    }

    // 2. Fire CRM logging and watchdog telemetry asynchronously in parallel AFTER line pickup
    setTimeout(() => {
      callSarahBackend('/api/sarah/inbound', {
        from: callerPhone || '',
        caller_name: '',
        internal_only: true,
        skip_inline_tts: true,
        notes: isBusinessHours
          ? 'Picked up immediately on 1st ring (Business Hours 8AM-5PM MST) on (480) 331-9455'
          : 'Picked up immediately on 1st ring (After Hours) on (480) 331-9455',
      }).catch(() => {});

      callSarahBackend('/api/sarah/gv-heartbeat', {
        runner: RUNNER_MODE,
        instanceId: cloudDaemonCfg?.instanceId || undefined,
        region: cloudDaemonCfg?.region || undefined,
        extensionBuild: EXTENSION_BUILD,
        url: window.location.href,
        title: document.title || '',
        callActive: true,
        totalCallsAnswered,
        lastAnswerClickTs,
        event: 'call_answered_on_first_ring',
        eventDetail: `Answered incoming call ${callerPhone || '(unknown caller)'} [${isBusinessHours ? 'business_hours' : 'after_hours'}]`,
      }).catch(() => {});
    }, 0);
  }

  // Match explicit Incoming Call Answer buttons using multi-selector strategy + deep shadow/iframe traversal
  function findVisibleAnswerButtons(elements) {
    const matched = [];
    const seen = new Set();
    const combinedSelector = SELECTORS.join(', ');

    try {
      const directMatches = document.querySelectorAll(combinedSelector);
      for (const el of directMatches) {
        if (!isElementVisible(el)) continue;
        const aria = String(el.getAttribute?.('aria-label') || '').trim();
        if (/decline|reject|ignore|hang\s*up|end\s*call|dismiss/i.test(aria)) continue;
        seen.add(el);
        matched.push(el);
      }
    } catch {}

    for (const el of elements) {
      if (seen.has(el) || !isElementVisible(el)) continue;
      let matchesSelector = false;
      try {
        matchesSelector = Boolean(el.matches?.(combinedSelector));
      } catch {}

      const aria = String(el.getAttribute?.('aria-label') || '').trim();
      const title = String(
        el.getAttribute?.('title') ||
          el.getAttribute?.('mattooltip') ||
          el.getAttribute?.('data-tooltip') ||
          ''
      ).trim();
      const testId = String(
        el.getAttribute?.('gv-test-id') ||
          el.getAttribute?.('data-call-action') ||
          el.getAttribute?.('data-e2e') ||
          el.id ||
          ''
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
        matchesSelector ||
        /(answer|accept\s*call|pick\s*up)/i.test(aria) ||
        /(answer|accept\s*call|pick\s*up)/i.test(title) ||
        /^(answer|answer\s*call|accept\s*call|call\s*answer|phone_in_talk\s*answer|callanswer|answercall|accept|pick\s*up)$/i.test(
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
        seen.add(el);
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

    // If a call is ALREADY confirmed active, monitor for call end
    if (callActive) {
      if (IS_TOP_FRAME && now - lastCallStartTs > 4500 && !hasVisibleHangupButton(elements) && !isSpeaking) {
        callActive = false;
        pendingAnswerAttempt = false;
        lastCallEndedTs = now;
        window.postMessage({ __iwg_webrtc__: true, type: 'IWG_SARAH_STOP_WAV' }, '*');
        if (recognition && recRunning) {
          try {
            recognition.stop();
            recRunning = false;
          } catch {}
        }
        callSarahBackend('/api/sarah/gv-heartbeat', {
          runner: RUNNER_MODE,
          instanceId: cloudDaemonCfg?.instanceId || undefined,
          region: cloudDaemonCfg?.region || undefined,
          extensionBuild: EXTENSION_BUILD,
          url: window.location.href,
          title: document.title || '',
          callActive: false,
          totalCallsAnswered,
          event: 'call_ended_ready_for_next',
        }).catch(() => {});
        updateStatusBanner('🟢 Sarah Natural Voice (Vindemiatrix) Auto-Answer ON • (480) 331-9455', '#10b981');
      }
      return;
    }

    const answerBtns = findVisibleAnswerButtons(elements);

    // Confirm pending click succeeded as soon as Answer button disappears or Hangup/WebRTC connects
    if (pendingAnswerAttempt && IS_TOP_FRAME) {
      const webrtcConnected = document.documentElement?.getAttribute('data-iwg-webrtc-connected') === 'true';
      if (webrtcConnected || hasVisibleHangupButton(elements) || answerBtns.length === 0) {
        pendingAnswerAttempt = false;
        onIncomingCallAnswered(pendingCallerPhone);
        return;
      }
      if (now - pendingAnswerStartedTs > 12000) {
        pendingAnswerAttempt = false;
      }
    }

    // Immediately click Answer on the 1st ring (<50ms — decoupled from Gemini session/audio buffers)
    if (answerBtns.length > 0 && now - lastAnswerClickTs > 200 && now - lastCallEndedTs > 1200) {
      lastAnswerClickTs = now;
      const detectedCaller = extractActiveCallerPhone();
      if (!pendingAnswerAttempt) {
        pendingAnswerAttempt = true;
        pendingAnswerStartedTs = now;
        pendingCallerPhone = detectedCaller;
        window.postMessage({ __iwg_webrtc__: true, type: 'IWG_RESUME_AUDIO' }, '*');
      }
      for (const targetBtn of answerBtns) {
        clickElement(targetBtn);
      }
      if (!IS_TOP_FRAME) {
        try {
          window.top?.postMessage(
            { __iwg_webrtc__: true, type: 'IWG_SUBFRAME_CALL_ANSWERED', callerPhone: detectedCaller },
            '*'
          );
        } catch {}
        return;
      }
      // Open the audio/Gemini session immediately upon clicking Answer (while continuing retry clicks if button lingers)
      if (!callActive) {
        onIncomingCallAnswered(pendingCallerPhone);
      }
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
        runner: RUNNER_MODE,
        instanceId: cloudDaemonCfg?.instanceId || undefined,
        region: cloudDaemonCfg?.region || undefined,
        extensionBuild: EXTENSION_BUILD,
        url: window.location.href,
        title: document.title || '',
        visibilityState: document.visibilityState || 'visible',
        receivingCallsText:
          document.documentElement?.getAttribute('data-iwg-webrtc-bridge') === 'ready'
            ? 'Zero-Echo Pure Digital WebRTC Isolation ACTIVE'
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

      if (RUNNER_MODE === 'chrome-extension') {
        const nextStandby = Boolean(res?.standbyForCloud);
        if (nextStandby !== standbyForCloud) {
          standbyForCloud = nextStandby;
          if (standbyForCloud) {
            updateStatusBanner('☁️ 24/7 Cloud Daemon Answering (480) 331-9455 • Laptop Standby', '#38bdf8');
          } else {
            updateStatusBanner('🟢 Sarah Natural Voice (Vindemiatrix) Auto-Answer ON • (480) 331-9455', '#10b981');
          }
        }
        if (res?.needsCookieSync && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'IWG_SYNC_COOKIES_NOW' }, () => {
            void chrome.runtime.lastError;
          });
        }
      }

      if (res?.reloadExtension && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'IWG_RELOAD_EXTENSION' }, () => {
          void chrome.runtime.lastError;
        });
      }
      if (res?.reloadTab) {
        window.location.reload();
      }
      if (res?.simulateIncomingCall) {
        const prevStandby = standbyForCloud;
        standbyForCloud = false;
        triggerSimulatedIncomingCallInDom(res.callerPhone || '(602) 456-9681');
        setTimeout(() => {
          standbyForCloud = prevStandby;
        }, 2000);
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

  // Attach MutationObserver immediately at document_start (on documentElement) so observers attach before elements render
  const observer = new MutationObserver(() => {
    scanGoogleVoiceDom();
  });
  const attachRootObserver = () => {
    const targetNode = document.documentElement || document.body || document;
    if (targetNode) {
      try {
        observer.observe(targetNode, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['aria-label', 'class', 'style', 'hidden', 'disabled', 'data-call-action'],
        });
      } catch {}
    }
  };
  attachRootObserver();
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        attachRootObserver();
        if (IS_TOP_FRAME) {
          updateStatusBanner('🟢 Sarah Natural Voice (Vindemiatrix) Auto-Answer ON • (480) 331-9455', '#10b981');
        }
        scanGoogleVoiceDom();
      },
      { once: true }
    );
  } else if (IS_TOP_FRAME) {
    updateStatusBanner('🟢 Sarah Natural Voice (Vindemiatrix) Auto-Answer ON • (480) 331-9455', '#10b981');
  }

  const intervalId = setInterval(scanGoogleVoiceDom, 50);
  const heartbeatIntervalId = IS_TOP_FRAME ? setInterval(sendWatchdogHeartbeat, 4000) : null;
  if (IS_TOP_FRAME) {
    setTimeout(sendWatchdogHeartbeat, 400);
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
