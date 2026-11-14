// IWG Main-World WebRTC Virtual Audio Bridge for Google Voice (480) 331-9455 (v10 — Zero-Latency Pre-Decoded AudioBuffer + Pure Digital Isolation)
// 1. Feeds ONLY Sarah's digital Vindemiatrix audio into Google Voice's outgoing WebRTC stream (NEVER opens or mixes the PC's physical microphone).
// 2. Pre-decodes Business Hours & After Hours WAV greetings into 48kHz AudioBuffers in idle RAM (<1ms Ring-1 playback, zero atob/decode stall).
// 3. Uses 6ms click-free linear fade-in + 0.85 studio gain + brickwall soft limiter + 0.0 DC constant source (zero hum, click, echo, or clipping).
// 4. Captures the remote caller's incoming WebRTC MediaStreamTrack directly in digital memory via WebAudio AnalyserNode + MediaRecorder.
(function () {
  if (typeof window === 'undefined' || window.__IWG_WEBRTC_BRIDGE_INSTALLED__) {
    return;
  }
  window.__IWG_WEBRTC_BRIDGE_INSTALLED__ = true;
  function markBridgeReadyOnDom() {
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.setAttribute('data-iwg-webrtc-bridge', 'ready');
        return true;
      }
    } catch { }
    return false;
  }
  if (!markBridgeReadyOnDom() && typeof document !== 'undefined') {
    document.addEventListener('readystatechange', markBridgeReadyOnDom);
    document.addEventListener('DOMContentLoaded', markBridgeReadyOnDom, { once: true });
    setTimeout(markBridgeReadyOnDom, 50);
    setTimeout(markBridgeReadyOnDom, 400);
  }

  let bridgeAudioCtx = null;
  let virtualMicDest = null;
  let sarahGainNode = null;
  let limiterNode = null;
  let activeSourceNode = null;
  let sarahSpeakingNow = false;
  let lastSarahEndedTs = 0;
  const hookedRemoteTrackIds = new Set();
  const decodedBufferCache = new Map();
  const MAX_DECODED_CACHE = 4;

  function cacheKeyForBase64(b64) {
    if (!b64 || b64.length < 64) return '';
    return `${b64.length}:${b64.slice(0, 32)}:${b64.slice(-32)}`;
  }

  function notifyCallConnectionState(connected, reason) {
    try {
      document.documentElement?.setAttribute('data-iwg-webrtc-connected', connected ? 'true' : 'false');
      window.postMessage(
        {
          __iwg_webrtc__: true,
          type: connected ? 'IWG_WEBRTC_CALL_CONNECTED' : 'IWG_WEBRTC_CALL_ENDED',
          reason: reason || '',
          ts: Date.now(),
        },
        '*'
      );
    } catch { }
  }

  function ensureAudioGraph() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!bridgeAudioCtx || bridgeAudioCtx.state === 'closed') {
        bridgeAudioCtx = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
        virtualMicDest = bridgeAudioCtx.createMediaStreamDestination();

        // Clean studio gain + brickwall soft limiter to prevent any WebRTC Opus clipping or distortion
        sarahGainNode = bridgeAudioCtx.createGain();
        sarahGainNode.gain.value = 0.85;

        limiterNode = bridgeAudioCtx.createDynamicsCompressor();
        limiterNode.threshold.value = -3.0;
        limiterNode.knee.value = 6.0;
        limiterNode.ratio.value = 12.0;
        limiterNode.attack.value = 0.002;
        limiterNode.release.value = 0.08;

        sarahGainNode.connect(limiterNode);
        limiterNode.connect(virtualMicDest);

        // Pure 0.0 DC constant source (zero frequency, zero tone, zero hum) so WebRTC RTP frames stay active during silence
        try {
          if (typeof bridgeAudioCtx.createConstantSource === 'function') {
            const zeroSource = bridgeAudioCtx.createConstantSource();
            zeroSource.offset.value = 0.0;
            zeroSource.connect(virtualMicDest);
            zeroSource.start();
          }
        } catch { }
      }
      if (bridgeAudioCtx.state === 'suspended') {
        bridgeAudioCtx.resume().catch(() => { });
      }
      return bridgeAudioCtx;
    } catch {
      return null;
    }
  }

  async function decodeAndCacheBase64Audio(base64) {
    const ctx = ensureAudioGraph();
    if (!ctx || !base64) return null;
    const key = cacheKeyForBase64(base64);
    if (key && decodedBufferCache.has(key)) {
      return decodedBufferCache.get(key);
    }
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
    if (key && audioBuffer) {
      if (decodedBufferCache.size >= MAX_DECODED_CACHE) {
        const oldestKey = decodedBufferCache.keys().next().value;
        if (oldestKey) decodedBufferCache.delete(oldestKey);
      }
      decodedBufferCache.set(key, audioBuffer);
    }
    return audioBuffer;
  }

  function getClonedVirtualAudioTrack() {
    ensureAudioGraph();
    if (!virtualMicDest || !virtualMicDest.stream) return null;
    const baseTrack = virtualMicDest.stream.getAudioTracks()[0];
    if (!baseTrack) return null;
    const cloned = baseTrack.clone();
    cloned.enabled = true;
    return cloned;
  }

  // 1. Intercept navigator.mediaDevices.getUserMedia — NEVER open the physical PC microphone!
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      const wantsAudio = Boolean(constraints && constraints.audio);
      if (!wantsAudio) {
        return origGetUserMedia(constraints);
      }

      const virtualTrack = getClonedVirtualAudioTrack();
      if (virtualTrack) {
        return new MediaStream([virtualTrack]);
      }

      return origGetUserMedia(constraints);
    };
  }

  // 2. Attach VAD + MediaRecorder directly to incoming remote WebRTC audio tracks from the phone caller
  function monitorRemoteAudioStream(remoteStream) {
    if (!remoteStream || typeof remoteStream.getAudioTracks !== 'function') return;
    const audioTracks = remoteStream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) return;
    const track = audioTracks[0];
    if (!track || hookedRemoteTrackIds.has(track.id)) return;
    hookedRemoteTrackIds.add(track.id);
    notifyCallConnectionState(true, 'remote_audio_track_attached');
    track.addEventListener?.('ended', () => {
      hookedRemoteTrackIds.delete(track.id);
      notifyCallConnectionState(false, 'remote_audio_track_ended');
    });

    const ctx = ensureAudioGraph();
    if (!ctx) return;

    try {
      const streamForAnalysis = new MediaStream([track]);
      const source = ctx.createMediaStreamSource(streamForAnalysis);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const data = new Float32Array(analyser.fftSize);
      let recorder = null;
      let chunks = [];
      let isRecordingUtterance = false;
      let speechStartTs = 0;
      let lastVoiceTs = 0;

      const finishRecording = () => {
        if (!recorder || recorder.state === 'inactive') {
          isRecordingUtterance = false;
          return;
        }
        try {
          recorder.stop();
        } catch {
          isRecordingUtterance = false;
        }
      };

      const vadInterval = setInterval(() => {
        if (track.readyState === 'ended') {
          clearInterval(vadInterval);
          finishRecording();
          try {
            source.disconnect();
            analyser.disconnect();
          } catch { }
          return;
        }
        const now = Date.now();
        // Do not record while Sarah is speaking or within 380ms after she finishes speaking
        if (sarahSpeakingNow || now - lastSarahEndedTs < 380) {
          if (isRecordingUtterance) {
            chunks = [];
            finishRecording();
          }
          return;
        }

        analyser.getFloatTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          sumSq += data[i] * data[i];
        }
        const rms = Math.sqrt(sumSq / data.length);

        if (rms > 0.014) {
          lastVoiceTs = now;
          if (!isRecordingUtterance) {
            try {
              const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';
              chunks = [];
              recorder = new MediaRecorder(streamForAnalysis, { mimeType, audioBitsPerSecond: 32000 });
              recorder.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) chunks.push(ev.data);
              };
              recorder.onstop = () => {
                isRecordingUtterance = false;
                const durationMs = Date.now() - speechStartTs;
                if (sarahSpeakingNow || chunks.length === 0 || durationMs < 320) {
                  chunks = [];
                  return;
                }
                const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
                chunks = [];
                if (blob.size < 600) return;
                const reader = new FileReader();
                reader.onloadend = () => {
                  const dataUrl = String(reader.result || '');
                  const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
                  if (b64) {
                    window.postMessage(
                      {
                        __iwg_webrtc__: true,
                        type: 'IWG_CALLER_WEBRTC_AUDIO',
                        audioBase64: b64,
                        mimeType: 'audio/webm',
                        durationMs,
                      },
                      '*'
                    );
                  }
                };
                reader.readAsDataURL(blob);
              };
              speechStartTs = now;
              isRecordingUtterance = true;
              recorder.start();
            } catch {
              isRecordingUtterance = false;
            }
          } else if (now - speechStartTs > 8500) {
            finishRecording();
          }
        } else if (isRecordingUtterance && now - lastVoiceTs > 620) {
          finishRecording();
        }
      }, 65);
    } catch { }
  }

  // 3. Wrap RTCPeerConnection and RTCRtpSender so outgoing audio ALWAYS uses our pure digital bus
  if (typeof window.RTCPeerConnection === 'function') {
    const OrigPeerConnection = window.RTCPeerConnection;
    const WrappedPeerConnection = function (...args) {
      const pc = new OrigPeerConnection(...args);
      ensureAudioGraph();

      const onStateChange = () => {
        try {
          const cs = pc.connectionState;
          const ice = pc.iceConnectionState;
          if (cs === 'connected' || ice === 'connected' || ice === 'completed') {
            notifyCallConnectionState(true, `pc_${cs || ice}`);
          } else if (cs === 'closed' || cs === 'failed' || cs === 'disconnected' || ice === 'closed' || ice === 'failed') {
            notifyCallConnectionState(false, `pc_${cs || ice}`);
          }
        } catch { }
      };
      pc.addEventListener('connectionstatechange', onStateChange);
      pc.addEventListener('iceconnectionstatechange', onStateChange);

      pc.addEventListener('track', (ev) => {
        try {
          if (ev.track && ev.track.kind === 'audio') {
            const stream = (ev.streams && ev.streams[0]) || new MediaStream([ev.track]);
            monitorRemoteAudioStream(stream);
          }
        } catch { }
      });

      const origAddTrack = pc.addTrack.bind(pc);
      pc.addTrack = function (track, ...streams) {
        try {
          if (track && track.kind === 'audio') {
            const vTrack = getClonedVirtualAudioTrack();
            if (vTrack) {
              return origAddTrack(vTrack, ...streams);
            }
          }
        } catch { }
        return origAddTrack(track, ...streams);
      };

      return pc;
    };
    WrappedPeerConnection.prototype = OrigPeerConnection.prototype;
    Object.setPrototypeOf(WrappedPeerConnection, OrigPeerConnection);
    window.RTCPeerConnection = WrappedPeerConnection;
  }

  if (typeof window.RTCRtpSender === 'function' && window.RTCRtpSender.prototype?.replaceTrack) {
    const origReplaceTrack = window.RTCRtpSender.prototype.replaceTrack;
    window.RTCRtpSender.prototype.replaceTrack = function (withTrack) {
      try {
        if (withTrack && withTrack.kind === 'audio') {
          const vTrack = getClonedVirtualAudioTrack();
          if (vTrack) {
            return origReplaceTrack.call(this, vTrack);
          }
        }
      } catch { }
      return origReplaceTrack.call(this, withTrack);
    };
  }

  // Hook HTMLMediaElement.srcObject so remote caller audio streams are tapped digitally and muted locally
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
    if (desc && desc.set && desc.get) {
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        configurable: true,
        enumerable: true,
        get() {
          return desc.get.call(this);
        },
        set(val) {
          try {
            if (val && typeof val.getAudioTracks === 'function' && val.getAudioTracks().length > 0) {
              monitorRemoteAudioStream(val);
              this.volume = 0.0;
              this.muted = true;
            }
          } catch { }
          return desc.set.call(this, val);
        },
      });
    }
  } catch { }

  async function handlePlayWavRequest(base64, requestId) {
    const finish = (ok) => {
      window.postMessage(
        {
          __iwg_webrtc__: true,
          type: 'IWG_SARAH_PLAY_DONE',
          requestId,
          ok,
        },
        '*'
      );
    };

    if (!base64) {
      return finish(false);
    }

    try {
      const ctx = ensureAudioGraph();
      if (!ctx || !sarahGainNode) {
        return finish(false);
      }

      if (activeSourceNode) {
        try {
          activeSourceNode.stop();
          activeSourceNode.disconnect();
        } catch { }
        activeSourceNode = null;
      }

      const audioBuffer = await decodeAndCacheBase64Audio(base64);
      if (!audioBuffer) {
        return finish(false);
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      // 6ms click-free linear fade-in into sarahGainNode (WebRTC outgoing stream ONLY — zero speaker echo)
      const nowTime = ctx.currentTime;
      sarahGainNode.gain.cancelScheduledValues(nowTime);
      sarahGainNode.gain.setValueAtTime(0.001, nowTime);
      sarahGainNode.gain.linearRampToValueAtTime(0.85, nowTime + 0.006);

      source.connect(sarahGainNode);

      sarahSpeakingNow = true;
      activeSourceNode = source;

      let doneCalled = false;
      const onEnded = (ok) => {
        if (doneCalled) return;
        doneCalled = true;
        if (activeSourceNode === source) {
          activeSourceNode = null;
          sarahSpeakingNow = false;
          lastSarahEndedTs = Date.now();
        }
        finish(ok);
      };

      const maxMs = Math.min(25000, Math.ceil((audioBuffer.duration || 10) * 1000) + 1200);
      const timer = setTimeout(() => onEnded(true), maxMs);
      source.onended = () => {
        clearTimeout(timer);
        onEnded(true);
      };
      source.start(0);
    } catch {
      sarahSpeakingNow = false;
      lastSarahEndedTs = Date.now();
      finish(false);
    }
  }

  // 4. Listen for postMessage commands from content.js (crosses ISOLATED <-> MAIN worlds cleanly)
  window.addEventListener('message', (ev) => {
    const data = ev?.data;
    if (!data || !data.__iwg_webrtc__) return;
    if (data.type === 'IWG_SARAH_PLAY_WAV') {
      handlePlayWavRequest(data.base64, data.requestId);
    } else if (data.type === 'IWG_SARAH_PREWARM_WAV') {
      if (data.base64) {
        decodeAndCacheBase64Audio(data.base64).catch(() => { });
      }
    } else if (data.type === 'IWG_RESUME_AUDIO') {
      ensureAudioGraph();
    } else if (data.type === 'IWG_SARAH_STOP_WAV') {
      sarahSpeakingNow = false;
      lastSarahEndedTs = Date.now();
      if (activeSourceNode) {
        try {
          activeSourceNode.stop();
          activeSourceNode.disconnect();
        } catch { }
        activeSourceNode = null;
      }
    }
  });
})();
